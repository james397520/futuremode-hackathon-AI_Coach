"""Agent-layer error taxonomy.

Deliberately defined inside `app/agents` rather than imported from `app.core.errors`:
the agent layer must stay usable (and unit-testable) without the HTTP error mapping
owned by the API-platform module. `app.core.errors` may wrap these at the router edge.
"""

from __future__ import annotations


class AgentError(Exception):
    """Base class for every failure raised by the multi-agent layer."""

    #: When False the orchestrator may drop this agent's contribution and still
    #: complete the turn (spec §49.4 graceful degradation).
    critical: bool = False


class LlmTransportError(AgentError):
    """Network/5xx/timeout style failure talking to a model provider. Retryable."""

    critical = False


class LlmRateLimitError(LlmTransportError):
    """429 / provider throttling. Retryable with backoff."""


class LlmQuotaExceededError(AgentError):
    """Tenant or workspace token quota exhausted (spec §46/§70). Not retryable."""

    critical = True


class LlmTimeoutError(LlmTransportError):
    """The provider did not answer inside the agent's timeout budget."""


class NoModelAvailableError(AgentError):
    """Every model in the route (primary + fallbacks) failed."""

    critical = True


class OutputValidationError(AgentError):
    """The model produced output that does not satisfy the agent's Pydantic schema.

    Raised only after the single bounded repair attempt has also failed (spec §66:
    agents must emit structured data, never free text).
    """

    critical = True

    def __init__(self, agent: str, detail: str, raw: str | None = None) -> None:
        super().__init__(f"{agent}: structured output invalid: {detail}")
        self.agent = agent
        self.detail = detail
        self.raw = raw


class PersonaBreachError(AgentError):
    """The customer agent output leaked meta/system content or forbidden knowledge."""

    critical = False


class KnowledgeBoundaryError(AgentError):
    """Retrieval evidence was insufficient and no safe fallback could be produced."""

    critical = False
