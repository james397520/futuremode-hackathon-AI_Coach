#!/bin/bash
# =============================================================================
# Postgres first-boot initialisation.
#
# Runs once, via the official image's /docker-entrypoint-initdb.d hook, on an
# empty data directory. `infra/scripts/reset.sh` removes the volume, which is
# the only way to make edits here take effect again.
#
# Everything below is written to be idempotent anyway, so it is also safe to
# run by hand:
#   docker compose -f infra/docker-compose.yml exec -T postgres \
#     bash /docker-entrypoint-initdb.d/01-init-db.sh
#
# Creates:
#   * the application role and database named by DATABASE_URL in the root .env
#   * a second, identically-shaped database for the pytest suite
#   * the extensions the schema depends on
# =============================================================================
set -euo pipefail

APP_DB_NAME="${APP_DB_NAME:-aicoach}"
APP_DB_USER="${APP_DB_USER:-aicoach}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-aicoach}"
APP_DB_TEST_NAME="${APP_DB_TEST_NAME:-aicoach_test}"
SUPERUSER="${POSTGRES_USER:-postgres}"

echo "init-db: ensuring role '${APP_DB_USER}' and databases '${APP_DB_NAME}', '${APP_DB_TEST_NAME}'"

psql_super() {
  psql -v ON_ERROR_STOP=1 --username "${SUPERUSER}" --dbname postgres "$@"
}

# --- role ---------------------------------------------------------------------
# CREATE ROLE has no IF NOT EXISTS, hence the DO block.
psql_super <<-SQL
	DO \$do\$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${APP_DB_USER}') THEN
	    CREATE ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}';
	  ELSE
	    ALTER ROLE ${APP_DB_USER} LOGIN PASSWORD '${APP_DB_PASSWORD}';
	  END IF;
	END
	\$do\$;

	-- The application owns its own schema so Alembic can create/drop freely,
	-- but it is deliberately NOT a superuser: nothing in the app needs to read
	-- another tenant's data through a back door (spec §74).
	ALTER ROLE ${APP_DB_USER} SET search_path = public;
	ALTER ROLE ${APP_DB_USER} SET timezone = 'UTC';
	-- Every timestamp in the schema is UTC; the UI localises on read (§50).
SQL

# --- databases ----------------------------------------------------------------
# CREATE DATABASE cannot run inside a transaction block, so each is a separate
# invocation guarded by a catalogue check.
for db in "${APP_DB_NAME}" "${APP_DB_TEST_NAME}"; do
  exists="$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'")"
  if [ "${exists}" != "1" ]; then
    psql_super -c "CREATE DATABASE ${db} OWNER ${APP_DB_USER} ENCODING 'UTF8' TEMPLATE template0"
    echo "init-db: created database ${db}"
  else
    echo "init-db: database ${db} already present"
  fi
done

# --- extensions ---------------------------------------------------------------
for db in "${APP_DB_NAME}" "${APP_DB_TEST_NAME}"; do
  psql -v ON_ERROR_STOP=1 --username "${SUPERUSER}" --dbname "${db}" <<-SQL
		-- gen_random_uuid() for entity ids (§53). Every id in shared-types is a
		-- string, so UUIDv4 text is the wire format.
		CREATE EXTENSION IF NOT EXISTS pgcrypto;
		-- Trigram indexes back keyword search and the hybrid-retrieval keyword
		-- leg (§12.3) and the global search palette (§80). Semantic search is
		-- Qdrant's job; Postgres never stores embeddings (§74).
		CREATE EXTENSION IF NOT EXISTS pg_trgm;
		-- Accent/case-insensitive ordering for member and knowledge-base lists.
		CREATE EXTENSION IF NOT EXISTS unaccent;
		-- btree_gin lets one index mix a tenant_id equality key with a trigram
		-- key, which is the shape of nearly every tenant-scoped search here.
		CREATE EXTENSION IF NOT EXISTS btree_gin;

		GRANT ALL ON SCHEMA public TO ${APP_DB_USER};
		ALTER SCHEMA public OWNER TO ${APP_DB_USER};
	SQL
  echo "init-db: extensions ready on ${db}"
done

echo "init-db: done"
