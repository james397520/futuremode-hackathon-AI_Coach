# syntax=docker/dockerfile:1.7
# =============================================================================
# apps/web — Next.js App Router frontend (spec §48.1).
#
# Build from the repository root:
#   docker build -f infra/docker/web.Dockerfile -t ai-coach/web:local .
#
# Four stages:
#   base    pinned node + corepack-activated pnpm
#   fetch   `pnpm fetch` — populates the store from the lockfile ALONE, so this
#           layer is only invalidated when the lockfile changes, not when a
#           source file does. This is the single biggest build-time win in a
#           pnpm monorepo.
#   builder installs the @ai-coach/web dependency closure offline, then builds
#   runner  the standalone server only. No pnpm, no source, no dev deps.
# =============================================================================

# Keep in sync with .nvmrc and .github/workflows/ci.yml.
ARG NODE_VERSION=20.18.0
# Keep in sync with the `packageManager` field in the root package.json.
ARG PNPM_VERSION=9.12.0

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
# libc6-compat: several transitive native deps (sharp, swc fallbacks) are built
# against glibc and need the shim on musl.
RUN apk add --no-cache libc6-compat \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# -----------------------------------------------------------------------------
FROM base AS fetch
# `pnpm fetch` reads only the lockfile. Copy nothing else here.
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch

# -----------------------------------------------------------------------------
FROM base AS builder
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ARG NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8000
ARG NEXT_PUBLIC_ENABLE_WEBGPU=auto

# NEXT_PUBLIC_* are inlined into the client bundle at build time, so they have
# to be present *here* rather than at container start. Only non-secret values
# are ever NEXT_PUBLIC_ — provider API keys live server-side only (§56/§70/§71)
# and must never appear as a build arg.
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    NEXT_PUBLIC_WS_BASE_URL=${NEXT_PUBLIC_WS_BASE_URL} \
    NEXT_PUBLIC_ENABLE_WEBGPU=${NEXT_PUBLIC_ENABLE_WEBGPU} \
    NEXT_TELEMETRY_DISABLED=1

# Warm store from the fetch stage.
COPY --from=fetch /pnpm/store /pnpm/store

# Manifests first, so a source-only edit does not re-resolve the graph.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json               apps/web/package.json
COPY packages/shared/package.json  packages/shared/package.json
COPY packages/design-tokens/package.json packages/design-tokens/package.json
COPY packages/ui/package.json            packages/ui/package.json
COPY packages/ai-runtime/package.json    packages/ai-runtime/package.json

# `@ai-coach/web...` = the web app plus everything it depends on, and nothing
# else. --offline proves the fetch layer was complete.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter "@ai-coach/web..."

# Now the sources.
COPY packages packages
COPY apps/web apps/web

# --- standalone output --------------------------------------------------------
# `output: 'standalone'` is a deployment concern, and apps/web/next.config.mjs
# is owned by the web team (see docs/PROJECT_STRUCTURE.md), so we do not edit it
# in the repo. Instead we shim it *inside the image*: the shim re-exports their
# config and adds the two deployment-only fields. If the web team later sets
# `output: 'standalone'` themselves, this becomes a harmless no-op override.
#
# outputFileTracingRoot must point at the workspace root or Next will trace only
# apps/web and omit the linked packages/* from the standalone bundle.
RUN mv apps/web/next.config.mjs apps/web/next.config.base.mjs \
 && printf '%s\n' \
      "import base from './next.config.base.mjs';" \
      "export default { ...base, output: 'standalone', outputFileTracingRoot: '/repo' };" \
      > apps/web/next.config.mjs

# `public/` is optional in Next; create it so the COPY in the runner is stable.
RUN mkdir -p apps/web/public

RUN pnpm --filter "@ai-coach/web" build

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Overridable: apps/web owns its own route tree, so we probe `/` by default and
# only require a non-5xx answer. Point this at a real `/api/health` route once
# apps/web ships one.
ENV WEB_HEALTH_PATH=/

RUN apk add --no-cache libc6-compat \
 && apk upgrade --no-cache

WORKDIR /app

# node:alpine already ships an unprivileged `node` user (uid/gid 1000). Reuse it
# rather than minting another one.
# The standalone tree bundles only the traced runtime files — no pnpm, no
# devDependencies, no TypeScript.
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

# Next's standalone server has no health route of its own; a non-5xx response
# from the app root is the honest liveness signal for the process.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+process.env.WEB_HEALTH_PATH).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

# Direct `node`, not a shell wrapper: PID 1 must receive SIGTERM so in-flight
# requests drain on `docker stop`.
CMD ["node", "apps/web/server.js"]
