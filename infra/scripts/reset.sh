#!/usr/bin/env bash
# =============================================================================
# DESTRUCTIVE. Tears the local stack down, deletes its volumes, and re-runs
# bootstrap from scratch.
#
#   infra/scripts/reset.sh                 confirm interactively, then reset
#   infra/scripts/reset.sh --yes           skip the prompt (for a Makefile/CI)
#   infra/scripts/reset.sh --no-bootstrap  destroy only; do not rebuild
#   infra/scripts/reset.sh --keep-env      do not touch .env (default anyway)
#
# What is destroyed
#   * every row in Postgres — organisations, users, sessions, transcripts,
#     evaluations, audit log
#   * every Qdrant collection, i.e. all embeddings; re-embedding a large
#     knowledge base costs real money if EMBEDDING_MODEL is an API model (§2.1)
#   * every object in MinIO — uploaded source documents included
#   * the Redis append-only file, so any queued Celery job is lost
#
# What is NOT touched
#   * your .env
#   * infra/certs/
#   * anything in git
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker-compose.yml"
ENV_FILE="${REPO_ROOT}/.env"

ASSUME_YES=0
RUN_BOOTSTRAP=1
BOOTSTRAP_ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes)       ASSUME_YES=1 ;;
    --no-bootstrap) RUN_BOOTSTRAP=0 ;;
    --keep-env)     : ;;  # accepted for symmetry; .env is never touched
    --with-app|--with-proxy|--no-seed) BOOTSTRAP_ARGS+=("$1") ;;
    -h|--help)      sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GRN=''; YEL=''; BLD=''; DIM=''; OFF=''
fi

COMPOSE=(docker compose -f "$COMPOSE_FILE")
[ -f "$ENV_FILE" ] && COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

# -----------------------------------------------------------------------------
# Show what is about to be destroyed. A confirmation prompt that does not tell
# you what you are losing is theatre.
# -----------------------------------------------------------------------------
printf '\n%s%sThis will DESTROY your local AI Coach data.%s\n\n' "$BLD" "$RED" "$OFF"

VOLUMES="$(docker volume ls --format '{{.Name}}' | grep -E '^ai-coach_' || true)"
if [ -n "$VOLUMES" ]; then
  printf '  Volumes to be removed:\n'
  while IFS= read -r v; do
    [ -z "$v" ] && continue
    SIZE="$(docker system df -v --format '{{range .Volumes}}{{if eq .Name "'"$v"'"}}{{.Size}}{{end}}{{end}}' 2>/dev/null || true)"
    printf '    %-28s %s\n' "$v" "${SIZE:-?}"
  done <<< "$VOLUMES"
else
  printf '  %s(no ai-coach volumes currently exist — nothing to lose)%s\n' "$DIM" "$OFF"
fi

printf '\n  Gone for good: users, sessions, transcripts, evaluations, audit log,\n'
printf '  all embeddings, and every uploaded document in object storage.\n'
printf '  %sYour .env, infra/certs/ and git working tree are untouched.%s\n\n' "$DIM" "$OFF"

# -----------------------------------------------------------------------------
# Confirmation. Requires typing the word, not pressing y — this is the kind of
# command people run at the end of a long day.
# -----------------------------------------------------------------------------
if [ "$ASSUME_YES" != "1" ]; then
  if [ ! -t 0 ]; then
    printf '%s✗%s stdin is not a terminal and --yes was not given; refusing to guess.\n' "$RED" "$OFF" >&2
    exit 1
  fi
  printf '  Type %sreset%s to continue (anything else aborts): ' "$BLD" "$OFF"
  read -r REPLY
  if [ "$REPLY" != "reset" ]; then
    printf '\n%s  aborted — nothing was changed%s\n\n' "$YEL" "$OFF"
    exit 130
  fi
fi

# -----------------------------------------------------------------------------
printf '\n%s▸%s Stopping the stack and removing volumes\n' "$YEL" "$OFF"
# --profile app/proxy so profile-gated containers are removed too; without them
# `down` leaves the api/worker/web containers behind.
"${COMPOSE[@]}" --profile app --profile proxy down --volumes --remove-orphans

# `down --volumes` only removes volumes declared in this compose file. Sweep any
# orphan left behind by an older revision of the file.
LEFTOVER="$(docker volume ls --format '{{.Name}}' | grep -E '^ai-coach_' || true)"
if [ -n "$LEFTOVER" ]; then
  printf '%s▸%s Removing leftover volumes from an earlier compose revision\n' "$YEL" "$OFF"
  # shellcheck disable=SC2086 # deliberate word splitting over the volume list
  docker volume rm $LEFTOVER >/dev/null
fi

printf '%s  ✓%s teardown complete\n' "$GRN" "$OFF"

# -----------------------------------------------------------------------------
if [ "$RUN_BOOTSTRAP" = "1" ]; then
  printf '\n%s▸%s Re-bootstrapping\n' "$YEL" "$OFF"
  # Postgres re-runs docker-entrypoint-initdb.d only on an empty data
  # directory — which is exactly what we just created. This is the point of a
  # reset: it is how an edit to infra/docker/postgres/init/ takes effect.
  # ${arr[@]+...} keeps this safe under `set -u` on bash 3.2 (macOS /bin/bash).
  exec "${REPO_ROOT}/infra/scripts/bootstrap.sh" ${BOOTSTRAP_ARGS[@]+"${BOOTSTRAP_ARGS[@]}"}
fi

printf '\n%s  ✓%s destroyed. Run infra/scripts/bootstrap.sh when you want it back.\n\n' "$GRN" "$OFF"
