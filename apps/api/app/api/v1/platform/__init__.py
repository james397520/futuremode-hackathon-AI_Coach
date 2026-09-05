"""Platform-layer services owned by the **API Platform** layer.

These are *not* the AI domain services in ``app/services/**`` (owned by the Agents & RAG
layer). They implement identity, directory and platform-settings persistence — pure
tenancy/RBAC/CRUD work with no LLM involvement — so that the routers in
``app/api/v1/routers`` stay thin (validate → authorise → call → shape) exactly as the
layering rule in ``docs/PROJECT_STRUCTURE.md`` requires.

They follow the same construction convention as the domain services:
``Service(db_session, ctx: RequestContext)``.
"""

from app.api.v1.platform.directory import DirectoryService
from app.api.v1.platform.identity import IdentityService, LoginOutcome
from app.api.v1.platform.settings_store import AuditReader, PlatformSettingsService

__all__ = [
    "AuditReader",
    "DirectoryService",
    "IdentityService",
    "LoginOutcome",
    "PlatformSettingsService",
]
