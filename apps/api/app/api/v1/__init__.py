"""``/api/v1`` router assembly.

Order matters only where a literal path could be shadowed by a path parameter; each
router keeps its own literal-before-parameter ordering internally.

The §69 examples are written unversioned (``POST /api/sessions``). This deployment
mounts the same shapes under an explicit version prefix — ``POST /api/v1/sessions`` —
so the contract can evolve without breaking a deployed web client.
"""

from fastapi import APIRouter

from app.api.v1.routers import (
    assignments,
    audit,
    auth,
    chunks,
    documents,
    integrations,
    knowledge_bases,
    personas,
    questions,
    reports,
    retrieval,
    runtime,
    scenarios,
    security,
    sessions,
    teams,
    users,
    workspaces,
)

api_router = APIRouter()

# Identity and tenancy first: everything below assumes a resolved workspace scope.
api_router.include_router(auth.router)
api_router.include_router(workspaces.router)
api_router.include_router(users.router)
api_router.include_router(teams.router)

# Knowledge (§11 / §12 / §30 / §31). ``documents`` declares full paths because it spans
# both ``/knowledge-bases/{id}/documents`` and ``/documents/{id}``.
api_router.include_router(knowledge_bases.router)
api_router.include_router(documents.router)
api_router.include_router(chunks.router)
api_router.include_router(retrieval.router)

# Authoring (§14–§17 / §26 / §36).
api_router.include_router(questions.router)
api_router.include_router(personas.router)
api_router.include_router(scenarios.router)
api_router.include_router(assignments.router)

# Runtime training + results (§23–§35 / §47).
api_router.include_router(sessions.router)
api_router.include_router(reports.router)

# Governance and platform settings (§41–§44 / §61).
api_router.include_router(security.router)
api_router.include_router(audit.router)
api_router.include_router(integrations.router)
api_router.include_router(runtime.router)

__all__ = ["api_router"]
