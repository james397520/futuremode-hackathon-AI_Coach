#!/usr/bin/env bash
# Native development bootstrap. This repository intentionally does not use Docker.
#
#   scripts/bootstrap.sh                     install project deps + migrate + seed
#   scripts/bootstrap.sh --check-services    check the services configured in .env
#   scripts/bootstrap.sh --no-seed           skip demo data
#
# PostgreSQL and Redis run as native services (for example Homebrew services on macOS),
# or may be supplied as managed endpoints through .env. Qdrant and object storage are
# optional in local mode: VECTOR_BACKEND=memory and OBJECT_STORAGE_ENABLED=false.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
EXAMPLE_FILE="${REPO_ROOT}/.env.example"
API_DIR="${REPO_ROOT}/apps/api"
AVATAR_DIR="${REPO_ROOT}/services/avatar-runtime"
INFERENCE_DIR="${REPO_ROOT}/services/inference"
NO_SEED=0
CHECK_SERVICES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-seed) NO_SEED=1 ;;
    --check-services) CHECK_SERVICES=1 ;;
    -h|--help)
      sed -n '2,10p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
ok() { printf '✓ %s\n' "$*"; }
require() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

require node
require python3
if ! command -v pnpm >/dev/null 2>&1; then
  require corepack
  corepack enable
fi
require pnpm

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  ok "created .env from .env.example"
fi

# .env is developer-controlled and never committed. It is read only for local
# process configuration; no value in it is passed to a browser process.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

check_services() {
  require psql
  require redis-cli
  local psql_url="${DATABASE_URL/postgresql+asyncpg/postgresql}"
  psql "$psql_url" -c 'SELECT 1' >/dev/null || die "PostgreSQL is unreachable: $DATABASE_URL"
  redis-cli -u "$REDIS_URL" ping >/dev/null || die "Redis is unreachable: $REDIS_URL"
  ok "PostgreSQL and Redis reachable"

  if [ "${VECTOR_BACKEND:-memory}" = "qdrant" ]; then
    require curl
    curl --fail --silent "${QDRANT_URL%/}/readyz" >/dev/null || die "Qdrant is unreachable: $QDRANT_URL"
    ok "Qdrant reachable"
  fi
  if [ "${OBJECT_STORAGE_ENABLED:-false}" = "true" ]; then
    ok "Object storage is enabled; bucket access is verified by /readyz after API startup"
  fi
}

if [ "$CHECK_SERVICES" = "1" ]; then
  check_services
  exit 0
fi

pnpm install
if [ ! -x "${API_DIR}/.venv/bin/python" ]; then
  python3 -m venv "${API_DIR}/.venv"
fi
"${API_DIR}/.venv/bin/pip" install -e "${API_DIR}[dev]"
check_services
(cd "$API_DIR" && .venv/bin/alembic -c app/db/alembic.ini upgrade head)
ok "database migrations applied"

if [ "$NO_SEED" = "0" ]; then
  "${API_DIR}/.venv/bin/python" "${REPO_ROOT}/database/seeds/seed.py"
  ok "demo data seeded"
fi

# --- optional local runtimes ------------------------------------------------
# Both are loopback-only side services. Neither is required for a training
# session: the avatar degrades to a static portrait (avatar spec §53) and the
# API falls back to its configured embedding provider when inference is absent.
# So a failure here warns and continues rather than aborting the bootstrap.
setup_service_venv() {
  local dir="$1" name="$2"
  [ -d "$dir" ] || return 0
  if [ ! -x "${dir}/.venv/bin/python" ]; then
    python3 -m venv "${dir}/.venv" || { printf 'warning: could not create venv for %s\n' "$name" >&2; return 0; }
  fi
  if "${dir}/.venv/bin/pip" install -e "${dir}[dev]" >/dev/null 2>&1; then
    ok "$name ready"
  else
    printf 'warning: %s dependencies did not install; the service will be skipped\n' "$name" >&2
  fi
}

setup_service_venv "$AVATAR_DIR" "avatar runtime"
setup_service_venv "$INFERENCE_DIR" "inference service"

printf '\nStart the API:     pnpm api:dev\n'
printf 'Start the web:     pnpm dev\n'
printf 'Start the avatar:  pnpm avatar:dev      (optional, loopback :8765)\n'
printf 'Verify the avatar: pnpm avatar:verify\n'
