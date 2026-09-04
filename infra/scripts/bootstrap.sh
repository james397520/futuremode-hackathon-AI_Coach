#!/usr/bin/env bash
# =============================================================================
# Local development bootstrap — idempotent.
#
#   infra/scripts/bootstrap.sh                 full setup
#   infra/scripts/bootstrap.sh --no-seed       stack + migrations, no demo data
#   infra/scripts/bootstrap.sh --with-proxy    also start nginx (+ self-signed certs)
#   infra/scripts/bootstrap.sh --with-app      also build/run api, worker, web images
#   infra/scripts/bootstrap.sh --check-only    verify tooling and exit
#
# Safe to re-run at any time: it never drops data. To start clean, use
# infra/scripts/reset.sh (which is destructive and asks first).
#
# Order matters. Migrations before seed, seed after MinIO's bucket exists,
# and every step waits for real health rather than sleeping.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/infra/docker-compose.yml"
ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"

DO_SEED=1
WITH_PROXY=0
WITH_APP=0
CHECK_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-seed)    DO_SEED=0 ;;
    --with-proxy) WITH_PROXY=1 ;;
    --with-app)   WITH_APP=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    -h|--help)    sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

# --- output -------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; BLU=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GRN=''; YEL=''; BLU=''; DIM=''; OFF=''
fi
step() { printf '\n%s▸ %s%s\n' "$BLU" "$*" "$OFF"; }
ok()   { printf '%s  ✓%s %s\n' "$GRN" "$OFF" "$*"; }
warn() { printf '%s  !%s %s\n' "$YEL" "$OFF" "$*"; }
die()  { printf '%s  ✗%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }
note() { printf '%s    %s%s\n' "$DIM" "$*" "$OFF"; }

# -----------------------------------------------------------------------------
# 1. Tooling
#
# Versions are checked, not just presence — every one of these minimums exists
# because of a feature actually used in this repo, noted inline.
# -----------------------------------------------------------------------------
step "Checking tooling"

# Compare dotted versions without relying on sort -V (absent on some BSD/macOS).
version_ge() {
  local have="$1" want="$2" i h w
  local -a H W
  IFS=. read -r -a H <<< "${have%%-*}"
  IFS=. read -r -a W <<< "${want%%-*}"
  for i in 0 1 2; do
    h="${H[$i]:-0}"; w="${W[$i]:-0}"
    h="${h//[^0-9]/}"; w="${w//[^0-9]/}"
    (( 10#${h:-0} > 10#${w:-0} )) && return 0
    (( 10#${h:-0} < 10#${w:-0} )) && return 1
  done
  return 0
}

require_tool() { command -v "$1" >/dev/null 2>&1 || die "$1 not found — $2"; }

require_tool docker "install Docker Desktop or the Docker Engine"
require_tool node   "install Node 20 (see .nvmrc); nvm users: \`nvm use\`"
require_tool python3 "install Python 3.11 (apps/api requires >=3.11)"

# Docker Compose v2 — `env_file: {path, required}` and
# `depends_on: service_completed_successfully` both need a modern v2.
COMPOSE_VER="$(docker compose version --short 2>/dev/null | tr -d 'v' || true)"
[ -n "$COMPOSE_VER" ] || die "\`docker compose\` (v2 plugin) not available. Compose v1 (\`docker-compose\`) is not supported."
version_ge "$COMPOSE_VER" 2.24.0 \
  || die "Docker Compose ${COMPOSE_VER} is too old; need >= 2.24.0 for the optional env_file syntax in infra/docker-compose.yml"
ok "docker compose ${COMPOSE_VER}"

docker info >/dev/null 2>&1 || die "the Docker daemon is not running"
ok "docker daemon reachable"

NODE_VER="$(node --version | tr -d 'v')"
version_ge "$NODE_VER" 20.0.0 \
  || die "Node ${NODE_VER} is too old; this repo pins Node 20 (.nvmrc). Node 18 lacks the stable global fetch/File the web healthcheck and tooling use."
case "$NODE_VER" in
  2[2-9].*|3*) warn "Node ${NODE_VER} is newer than the pinned 20.x — CI builds on 20, so a local-only failure here may not reproduce" ;;
  *)           ok   "node ${NODE_VER}" ;;
esac

# pnpm arrives via corepack (root package.json pins packageManager).
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    warn "pnpm not on PATH; enabling corepack"
    corepack enable >/dev/null 2>&1 || die "corepack enable failed — install pnpm 9 manually"
  else
    die "neither pnpm nor corepack found. Node 20 ships corepack; try \`corepack enable\`."
  fi
fi
PNPM_VER="$(pnpm --version)"
version_ge "$PNPM_VER" 9.0.0 || die "pnpm ${PNPM_VER} is too old; the workspace pins pnpm 9"
ok "pnpm ${PNPM_VER}"

PY_VER="$(python3 -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')"
version_ge "$PY_VER" 3.11.0 \
  || die "Python ${PY_VER} is too old; apps/api sets requires-python >= 3.11 (it uses PEP 604 unions and StrEnum)"
ok "python ${PY_VER}"

if [ "$CHECK_ONLY" = "1" ]; then
  step "Tooling OK (--check-only)"
  exit 0
fi

# -----------------------------------------------------------------------------
# 2. .env
# -----------------------------------------------------------------------------
step "Preparing .env"
if [ -f "$ENV_FILE" ]; then
  ok ".env already present — left untouched"
  # Surface newly-added keys instead of letting a stale .env fail obscurely.
  if [ -f "$ENV_EXAMPLE" ]; then
    ENV_TMP="$(mktemp -d)"
    grep -oE '^[A-Z0-9_]+=' "$ENV_EXAMPLE" | tr -d '=' | sort -u > "${ENV_TMP}/example"
    grep -oE '^[A-Z0-9_]+=' "$ENV_FILE"    | tr -d '=' | sort -u > "${ENV_TMP}/current"
    MISSING="$(comm -23 "${ENV_TMP}/example" "${ENV_TMP}/current")"
    rm -rf "$ENV_TMP"
    if [ -n "$MISSING" ]; then
      warn "keys in .env.example that your .env lacks:"
      printf '%s\n' "$MISSING" | sed 's/^/      /'
    fi
  fi
else
  [ -f "$ENV_EXAMPLE" ] || die ".env.example is missing; cannot bootstrap"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  ok "copied .env.example → .env"
  warn "OPENAI_API_KEY / ELEVENLABS_API_KEY are blank. The stack boots and the"
  note "mock event stream works, but live LLM turns and TTS will not (§70/§71)."
  warn "JWT_SECRET is still 'change-me'. Fine for APP_ENV=local; the API refuses"
  note "to boot with it in staging/production (apps/api/app/core/config.py)."
fi

# The compose project directory is infra/, so pass the root env file explicitly
# for ${VAR} interpolation. Every interpolation also has a default, so this is
# belt-and-braces rather than load-bearing.
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

# -----------------------------------------------------------------------------
# 3. Self-signed certificates for the optional proxy
# -----------------------------------------------------------------------------
if [ "$WITH_PROXY" = "1" ]; then
  step "Local TLS certificate"
  CERT_DIR="${REPO_ROOT}/infra/certs"
  mkdir -p "$CERT_DIR"
  if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
    ok "certificate already present"
  else
    command -v openssl >/dev/null 2>&1 || die "openssl not found; cannot mint a local certificate"
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout "${CERT_DIR}/privkey.pem" \
      -out    "${CERT_DIR}/fullchain.pem" \
      -subj "/CN=localhost/O=AI Coach local dev" \
      -addext "subjectAltName=DNS:localhost,DNS:ai-coach.localhost,IP:127.0.0.1" \
      >/dev/null 2>&1
    chmod 600 "${CERT_DIR}/privkey.pem"
    ok "minted a self-signed certificate in infra/certs/ (365 days)"
    note "Your browser will warn. Cross-origin isolation (COOP/COEP) requires a"
    note "secure context, so accept the exception if you are testing WASM threads."
  fi
fi

# -----------------------------------------------------------------------------
# 4. Bring the stack up
# -----------------------------------------------------------------------------
step "Starting the data plane"
PROFILES=()
[ "$WITH_APP"   = "1" ] && PROFILES+=(--profile app)
[ "$WITH_PROXY" = "1" ] && PROFILES+=(--profile app --profile proxy)

if [ "$WITH_APP" = "1" ] || [ "$WITH_PROXY" = "1" ]; then
  # ${arr[@]+...} is `set -u`-safe with an empty array on bash 3.2.
  "${COMPOSE[@]}" ${PROFILES[@]+"${PROFILES[@]}"} up -d --build --remove-orphans
else
  "${COMPOSE[@]}" up -d --remove-orphans
fi
ok "compose up issued"

# -----------------------------------------------------------------------------
# 5. Wait for real health, not a sleep
# -----------------------------------------------------------------------------
step "Waiting for services to report healthy"

wait_healthy() {
  local svc="$1" timeout="${2:-120}" waited=0 cid state
  while :; do
    cid="$("${COMPOSE[@]}" ps -q "$svc" 2>/dev/null || true)"
    if [ -z "$cid" ]; then
      [ "$waited" -ge 15 ] && die "service '$svc' never started (no container)"
    else
      state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)"
      case "$state" in
        healthy)  ok "$svc healthy"; return 0 ;;
        exited)   ok "$svc completed"; return 0 ;;
        unhealthy)
          warn "$svc reported unhealthy; last probe output:"
          docker inspect -f '{{range .State.Health.Log}}{{.Output}}{{end}}' "$cid" 2>/dev/null | tail -5 | sed 's/^/      /'
          ;;
      esac
    fi
    if [ "$waited" -ge "$timeout" ]; then
      printf '\n'
      warn "logs for $svc:"
      "${COMPOSE[@]}" logs --tail 40 "$svc" 2>&1 | sed 's/^/      /'
      die "timed out after ${timeout}s waiting for '$svc'"
    fi
    printf '.'
    sleep 2
    waited=$(( waited + 2 ))
  done
}

for svc in postgres redis qdrant minio; do
  printf '  %-10s' "$svc"
  wait_healthy "$svc" 120
done

# minio-init is one-shot: assert it actually succeeded rather than just exited.
INIT_CID="$("${COMPOSE[@]}" ps -aq minio-init 2>/dev/null || true)"
if [ -n "$INIT_CID" ]; then
  INIT_RC="$(docker inspect -f '{{.State.ExitCode}}' "$INIT_CID")"
  if [ "$INIT_RC" = "0" ]; then
    ok "minio bucket ready"
  else
    "${COMPOSE[@]}" logs --tail 30 minio-init | sed 's/^/      /'
    die "minio-init exited ${INIT_RC}; the object store bucket was not created"
  fi
fi

if [ "$WITH_APP" = "1" ] || [ "$WITH_PROXY" = "1" ]; then
  for svc in api worker web; do
    printf '  %-10s' "$svc"
    wait_healthy "$svc" 180
  done
  [ "$WITH_PROXY" = "1" ] && { printf '  %-10s' proxy; wait_healthy proxy 60; }
fi

# -----------------------------------------------------------------------------
# 6. Migrations
#
# Run on the host against the published port, so this works whether or not the
# `app` profile is up. Uses apps/api's own virtualenv if one exists.
# -----------------------------------------------------------------------------
step "Applying database migrations"

API_DIR="${REPO_ROOT}/apps/api"
if [ ! -f "${API_DIR}/alembic.ini" ]; then
  warn "apps/api/alembic.ini not found — the API Platform team has not landed"
  note "migrations yet. Skipping. Re-run this script once it exists."
elif [ "$WITH_APP" = "1" ]; then
  # Inside the container: correct interpreter, correct network names.
  "${COMPOSE[@]}" exec -T api alembic upgrade head \
    || die "alembic upgrade failed inside the api container"
  ok "migrations applied (in-container)"
else
  PY_BIN="python3"
  for candidate in "${API_DIR}/.venv/bin/python" "${REPO_ROOT}/.venv/bin/python"; do
    [ -x "$candidate" ] && { PY_BIN="$candidate"; break; }
  done
  if ! "$PY_BIN" -c 'import alembic' >/dev/null 2>&1; then
    warn "alembic is not importable with ${PY_BIN}."
    note "Install the API deps first:"
    note "  python3 -m venv apps/api/.venv"
    note "  apps/api/.venv/bin/pip install -e 'apps/api[dev]'"
    note "Then re-run this script, or pass --with-app to migrate in-container."
  else
    ( cd "$API_DIR" && "$PY_BIN" -m alembic upgrade head ) \
      || die "alembic upgrade failed"
    ok "migrations applied (host, ${PY_BIN})"
  fi
fi

# -----------------------------------------------------------------------------
# 7. Seed the demo (§59)
# -----------------------------------------------------------------------------
if [ "$DO_SEED" = "1" ]; then
  step "Seeding the demo dataset (spec §59)"
  SEED="${REPO_ROOT}/infra/scripts/seed.py"
  if [ "$WITH_APP" = "1" ]; then
    "${COMPOSE[@]}" exec -T api python - < "$SEED" \
      || warn "seed reported a problem; see its output above"
  else
    PY_BIN="python3"
    for candidate in "${API_DIR}/.venv/bin/python" "${REPO_ROOT}/.venv/bin/python"; do
      [ -x "$candidate" ] && { PY_BIN="$candidate"; break; }
    done
    ( cd "$API_DIR" && "$PY_BIN" "$SEED" ) \
      || warn "seed reported a problem; see its output above"
  fi
else
  warn "seed skipped (--no-seed)"
fi

# -----------------------------------------------------------------------------
# 8. Contract drift guard — cheap, and catches the worst class of local breakage
# -----------------------------------------------------------------------------
step "Checking cross-language contracts"
"${REPO_ROOT}/infra/scripts/check-contracts.sh" || warn "contract drift — see above"

# -----------------------------------------------------------------------------
step "Ready"
cat <<EOF

  Data plane
    postgres   localhost:${POSTGRES_PORT:-5432}
    redis      localhost:${REDIS_PORT:-6379}
    qdrant     localhost:${QDRANT_PORT:-6333}       dashboard: http://localhost:${QDRANT_PORT:-6333}/dashboard
    minio      localhost:${MINIO_PORT:-9000}        console:   http://localhost:${MINIO_CONSOLE_PORT:-9001}

  Next
    pnpm install          # first time only — also commits pnpm-lock.yaml
    pnpm dev              # web  → http://localhost:3000
    pnpm api:dev          # api  → http://localhost:8000  (docs at /docs)

  Demo walkthrough: see the "Demo walkthrough" section of README.md.
  Honest status:    docs/ROADMAP.md
EOF
