"""Multi-Agent layer (spec §19, §66).

    Conversation Orchestrator
    ├── Scenario Director   (deterministic, no LLM)
    ├── Customer Agent      (in persona, streamed)
    ├── Knowledge Agent     (RAG + citations + knowledge boundary)
    ├── Coach Agent         (Training Mode only, live)
    ├── Compliance Agent    (rule tier + model tier)
    └── Evaluator Agent     (evidence-based scoring)

**Every agent returns a validated Pydantic model, never free text** (§66). See
`app/agents/README.md` for the turn loop, the event-timing diagram and the safety
layering.
"""

from app.agents.base import Agent, AgentTelemetry, TelemetrySink
from app.agents.errors import (
    AgentError,
    LlmQuotaExceededError,
    LlmTimeoutError,
    LlmTransportError,
    OutputValidationError,
)
from app.agents.llm_client import LlmPort, ModelPurpose

__all__ = [
    "Agent",
    "AgentError",
    "AgentTelemetry",
    "LlmPort",
    "LlmQuotaExceededError",
    "LlmTimeoutError",
    "LlmTransportError",
    "ModelPurpose",
    "OutputValidationError",
    "TelemetrySink",
]
