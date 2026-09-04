# ADR-0009 — Deploy as host-native systemd units behind nginx, not as Docker containers

- **Status:** accepted
- **Date:** repository restructure (`0fa2af6`), refined by `9d5d772`
- **Spec:** Part II §64 (backend stack and deployment), §63 (topology), §72 (AMD AUP private deployment), §73 (edge security headers); avatar runtime spec §25 (Mac / MLX worker packaging), §29–§34 (RTX path)

## Context

Part II §64 lists the deployment target plainly:

```text
Deployment:
Docker
Kubernetes when required
AMD AUP cloud environment
```

And the repository initially followed it. There was a `docker-compose.yml` at the
root, three Dockerfiles under `infra/docker/` (`api`, `web`, `worker`), a PostgreSQL
init script at `infra/docker/postgres/init/01-init-db.sh`, and a `scripts/reset.sh`
that tore the stack down and back up. That is the conventional shape, and for the
API, the worker and the web app it works fine.

**The avatar runtime is what broke it.**

The platform's virtual persona is driven by two local models — LivePortrait for
expression and pose, MuseTalk for the mouth region. On Apple Silicon those run through
MLX against Metal. The LivePortrait/MuseTalk implementation spec addresses container
packaging directly, in §25, and does not hedge:

> **Mac 不建議用 Docker 跑 MLX Worker**
>
> ```text
> macOS host
> ├── avatar-api
> ├── fasterliveportrait-mlx
> └── musetalk-mlx
> ```
>
> Docker 可放：Redis、PostgreSQL、Web backend
>
> 但 MLX / Metal worker 用 host-native。

Read that carefully, because it is more specific than "don't use Docker". It splits
the stack: Redis, PostgreSQL and web backends *may* be containerised; the MLX/Metal
workers must be **host-native**. Docker Desktop on macOS runs a Linux VM, and a Linux
VM does not get Metal. There is no configuration that fixes this — the accelerator is
simply not present inside the container.

That left a genuine tension, and it is worth being honest about both sides:

- **Honouring §64 fully** means containers everywhere, and then the avatar runtime
  either does not work on the primary development platform or has to be run outside
  the stack anyway — at which point the deployment story is "Docker, plus a
  host-native process nobody's compose file describes", which is worse than either
  pure option.
- **Going host-native everywhere** costs the reproducible image build that is the
  actual reason to use containers, and defers the Kubernetes path that §64 names.

A secondary consideration pointed the same way. §72's AMD AUP private deployment puts
a private LLM, a local embedder, a reranker and an evaluation model inside the
customer's environment, on ROCm. GPU access from a container is possible but is
per-vendor plumbing — device passthrough, driver-version matching between host and
image, a different recipe for CUDA, ROCm and Metal. Every one of those is a support
burden on a deployment that has a competent sysadmin and a single host.

Two contributing facts, neither decisive on its own: the dependency services
(PostgreSQL, Redis, Qdrant, object storage) are all better run managed or as OS
services than in a compose file, and the development machines here are macOS, where
Docker Desktop's licensing and resource footprint are a real friction on every
contributor.

## Decision

**The platform deploys as host-native processes supervised by systemd, behind nginx.
Docker is not used, and `docker-compose.yml`, the three Dockerfiles and the PostgreSQL
init script have been deleted from the repository.**

What replaced them:

| Gone | Replacement |
|---|---|
| `docker-compose.yml` | `infra/systemd/*.service` + managed or OS-level data services |
| `infra/docker/api.Dockerfile` | `ai-coach-api.service` → `.venv/bin/uvicorn app.main:app` |
| `infra/docker/worker.Dockerfile` | `ai-coach-worker.service` → `.venv/bin/celery -A app.workers.queue:get_celery worker` |
| `infra/docker/web.Dockerfile` | `ai-coach-web.service` → `pnpm --filter @ai-coach/web start` |
| `infra/docker/postgres/init/01-init-db.sh` | `scripts/bootstrap.sh` + Alembic |
| `scripts/reset.sh` (compose teardown) | removed; there is no stack to reset |

The three units are deliberately plain — `Type=exec`, a dedicated `ai-coach` user,
`Restart=always`, `EnvironmentFile=/etc/ai-coach/*.env`, `NoNewPrivileges=true`,
`PrivateTmp=true`. The API and web app bind `127.0.0.1`; nginx terminates TLS and is
the only public listener, and it is also where the §73 edge policy lives — the COOP
and COEP pair, rate limits, and WebSocket connection caps.

Supporting rules:

- **Data services are managed or OS-level.** PostgreSQL, Redis, Qdrant and
  S3-compatible storage are not the application's problem to package.
  `scripts/bootstrap.sh --check-services` probes whichever of them `.env` enables, and
  `/readyz` probes only the enabled ones.
- **`scripts/bootstrap.sh` is the host-state manager**, and it is idempotent: install
  dependencies, verify services, `alembic upgrade head`, seed. It installs and starts
  no system services — that is the operator's step, deliberately.
- **The `services/*` accelerator processes are host-native by construction.**
  `services/inference` (ONNX; CPU, CUDA or ROCm) and `services/avatar-runtime`
  (MLX on Mac, CUDA/TensorRT on RTX) each carry their own venv and their own
  `pyproject.toml`, and both bind loopback. They are reached from `apps/api` on the
  same host and never from the edge.
- **Kubernetes is deferred, not rejected.** `infra/nginx/nginx.conf` is written so its
  policy ports to ingress-nginx annotations, and [`roadmap.md`](../roadmap.md) Phase 3
  still lists a Helm chart.

## Consequences

### Good

- **The accelerator is reachable, on every platform.** Metal on Apple Silicon, CUDA on
  an RTX host, ROCm inside AMD AUP — all through the ordinary driver on the ordinary
  host, with no device passthrough, no driver-version matching between host and image,
  and no per-vendor container recipe.
- **One packaging story instead of two.** The alternative was containers for the web
  tier and host-native for the avatar workers, which is the shape §25 explicitly
  describes as acceptable but which leaves the deployment documented in two
  incompatible ways. One mechanism is easier to operate and much easier to write down.
- **The dev machine matches the deployment.** `pnpm dev`, `pnpm api:dev`,
  `pnpm inference:dev` and `pnpm avatar:dev` run the same commands the service units
  run. A bug that only appears in the container is a category that no longer exists.
- **No Docker Desktop.** Removes a licensing question, several gigabytes of resident
  VM, and a class of macOS filesystem-performance problems, from every contributor's
  machine.
- **A smaller repository surface.** Four fewer packaging artefacts that had to be kept
  in step with the dependency lists they duplicated.

### Bad, and what we do about it

- **We lose reproducible image builds.** This is the real cost and it should not be
  minimised. A container image is a pinned, content-addressed artefact you can roll
  back to byte-for-byte; a host is a mutable thing with a package manager. What we do
  instead: `pnpm install --frozen-lockfile`, an editable install from a pinned
  `pyproject.toml`, a rollback procedure defined as "check out the previous built git
  revision, run the compatible migration, restart" ([`deployment.md`](../deployment.md)),
  and `scripts/bootstrap.sh` as the single idempotent description of host state. It is
  weaker than an image digest. It is weaker on purpose, and it is the item most likely
  to bite during an incident.
- **Host state can drift.** Two hosts bootstrapped six months apart will not have
  identical system libraries. Mitigation is that `bootstrap.sh` is the only sanctioned
  path and any manual step performed on a host is a bug in it. Configuration
  management (Ansible or equivalent) is the proper answer and is not written yet.
- **Interpreter and toolchain versions become the operator's responsibility.** An
  image pins Python; a host does not. This already bit — the dev machine's `python3`
  is 3.14 while the spec assumes 3.11, which affects wheel availability for exactly
  the native-extension packages the accelerator services need. Documented in
  [`troubleshooting.md`](../troubleshooting.md#python-314-on-the-dev-machine-311-in-the-spec).
- **Onboarding is longer.** `docker compose up` was one command. Now a contributor
  installs PostgreSQL and Redis themselves before `bootstrap.sh` will finish.
  Mitigation: `installation.md` gives the exact Homebrew commands, and
  `bootstrap.sh --check-services` tells you which endpoint is not answering.
- **The §64 Kubernetes path is deferred.** A customer who requires Kubernetes gets a
  system with no Helm chart today. Partly mitigated by keeping the edge policy
  portable, but a K8s deployment would also have to answer the avatar question — see
  the reversal condition below.
- **No process isolation from containers.** systemd gives `NoNewPrivileges` and
  `PrivateTmp`, and a dedicated unprivileged user; it does not give a namespace
  boundary. The units are deliberately minimal today, and hardening them further
  (`ProtectSystem`, `ProtectHome`, `RestrictAddressFamilies`, a `SystemCallFilter`) is
  cheap, unwritten, and worth doing before a production deployment.

### Rejected alternatives

- **Containers everywhere, per §64 as written** — rejected because it does not survive
  contact with the avatar runtime. MLX/Metal is unreachable from a Linux VM, so the
  headline local-avatar capability would not work on the primary development platform.
- **Hybrid: containers for web/API/worker, host-native for the accelerators** — the
  arrangement §25 actually sanctions, and the closest call here. Rejected because it
  gives up most of the container benefit (the deployment as a whole is still not
  reproducible from images, since the part that matters most is outside them) while
  keeping all of the container cost, and it requires documenting and supporting two
  mechanisms at once.
- **Kubernetes now** — rejected as premature. The system has one node's worth of load,
  no horizontal-scaling requirement yet, and a GPU/Metal story that K8s makes harder
  rather than easier. Still on the roadmap for Phase 3.
- **Nix or a similar reproducible host builder** — genuinely addresses the "lost
  reproducibility" consequence above, and was rejected only on team-familiarity
  grounds. If host drift becomes a real operational problem, this is the first thing
  to reconsider.

### What would reverse this decision

**A deployment with no local avatar runtime.** The whole argument rests on MLX/Metal
and local GPU inference being on the same host as the application. Strip that out —
a cloud deployment that uses a hosted avatar service, or ships without the avatar
feature, or runs the avatar workers as a separately-managed GPU fleet — and every
remaining component (Next.js, FastAPI, Celery) containerises cleanly, §64 applies
as written, and a Helm chart becomes the obvious next step.

Secondarily: a customer contract that requires Kubernetes, or a support burden from
host drift that outgrows `bootstrap.sh`, would each force the hybrid alternative back
onto the table for the non-accelerator tiers.
