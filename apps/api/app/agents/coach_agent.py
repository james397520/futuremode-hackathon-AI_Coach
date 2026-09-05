"""Coach Agent — real-time hints, missed signals, strategy, post-session (§19.4).

Assessment-mode gating happens **at the source** (spec §8.4 / §24): in assessment mode
the during-session path does not call a model at all, so there is no coaching text in
the process that a bug downstream could leak. `allowed_in_assessment` is then recomputed
from the insight kind — the model's own claim about it is never trusted.
"""

from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import Agent
from app.agents.llm_client import ModelPurpose
from app.agents.prompts.coach import coach_system_prompt
from app.agents.prompts.common import data_block, schema_block, untrusted_block

log = structlog.get_logger(__name__)


class InsightKind(StrEnum):
    HINT = "hint"
    MISSED_SIGNAL = "missed_signal"
    NEXT_STRATEGY = "next_strategy"
    POST_SESSION = "post_session"


#: Spec §8.4: Assessment Mode 預設禁止 Suggested Reply / Real-time Coach /
#: Direct Answer / Knowledge Peek. Only retrospective kinds survive.
ALLOWED_IN_ASSESSMENT: frozenset[InsightKind] = frozenset(
    {InsightKind.MISSED_SIGNAL, InsightKind.POST_SESSION}
)
#: ...and even `missed_signal` is withheld *during* an assessment; it is only shown in
#: the post-session review, so the live path filters to nothing at all.
LIVE_ALLOWED_IN_ASSESSMENT: frozenset[InsightKind] = frozenset()


class CoachInsightDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: InsightKind = InsightKind.HINT
    title: str = ""
    body: str = ""
    #: recomputed server-side from `kind`; the model's value is discarded
    allowed_in_assessment: bool = False
    priority: int = Field(default=1, ge=1, le=3)
    #: quote from the customer that the trainee missed (missed_signal only)
    evidence_quote: str | None = None


class CoachOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    insights: list[CoachInsightDraft] = Field(default_factory=list)
    suppressed_by_mode: int = 0


class CoachRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str = "training"
    locale: str = "zh-TW"
    session_id: str = ""
    timestamp_ms: int = 0
    trainee_text: str = ""
    persona_text: str = ""
    persona_state: dict[str, Any] = Field(default_factory=dict)
    director_signals: list[str] = Field(default_factory=list)
    learning_objectives: list[str] = Field(default_factory=list)
    required_talking_points: list[str] = Field(default_factory=list)
    recent_turns: list[tuple[str, str]] = Field(default_factory=list)
    #: only true for the end-of-session pass
    post_session: bool = False
    #: trainee pressed "request hint" (§19 quick actions) — still refused in assessment
    explicit_request: bool = False


class CoachAgent(Agent[CoachRequest, CoachOutput]):
    name = "coach"
    purpose = ModelPurpose.COACH
    output_model = CoachOutput
    optional = True
    default_temperature = 0.3
    default_max_tokens = 600

    def system_prompt(self) -> str:
        return coach_system_prompt(self.locale, self._mode)

    def build_user_prompt(self, request: CoachRequest) -> str:
        history = "\n".join(f"{s}: {t}" for s, t in request.recent_turns[-8:])
        return "\n\n".join(
            [
                data_block(
                    "objectives",
                    {
                        "learning_objectives": request.learning_objectives,
                        "required_talking_points": request.required_talking_points,
                    },
                ),
                data_block("persona_state", request.persona_state),
                data_block("director_signals", request.director_signals),
                data_block(
                    "task",
                    "post_session_summary" if request.post_session else "single_turn_coaching",
                ),
                untrusted_block("recent_transcript", history),
                untrusted_block("customer_last_said", request.persona_text),
                untrusted_block("trainee_last_said", request.trainee_text),
                schema_block(self._schema(), name=self.output_model.__name__),
            ]
        )

    async def run(self, request: CoachRequest) -> CoachOutput:
        self._mode = request.mode
        # --- gate at the source (spec §8.4) --------------------------------
        if request.mode == "assessment" and not request.post_session:
            log.info("coach.suppressed", reason="assessment_mode_live", session=request.session_id)
            return CoachOutput(insights=[], suppressed_by_mode=1)

        output = await self._invoke_structured(self._messages(request))
        return self._enforce(output, request)

    def _enforce(self, output: CoachOutput, request: CoachRequest) -> CoachOutput:
        allowed = (
            ALLOWED_IN_ASSESSMENT if request.mode == "assessment" else frozenset(InsightKind)
        )
        if request.mode == "assessment" and not request.post_session:
            allowed = LIVE_ALLOWED_IN_ASSESSMENT

        kept: list[CoachInsightDraft] = []
        suppressed = 0
        for insight in output.insights[:3]:
            if request.post_session and insight.kind is not InsightKind.POST_SESSION:
                insight = insight.model_copy(update={"kind": InsightKind.POST_SESSION})
            if insight.kind not in allowed:
                suppressed += 1
                continue
            kept.append(
                insight.model_copy(
                    update={"allowed_in_assessment": insight.kind in ALLOWED_IN_ASSESSMENT}
                )
            )
        kept.sort(key=lambda i: i.priority)
        return CoachOutput(insights=kept[:2], suppressed_by_mode=suppressed)

    _mode: str = "training"


def to_domain_insight(
    draft: CoachInsightDraft, *, session_id: str, timestamp_ms: int, insight_id: str | None = None
) -> dict[str, Any]:
    """Shape a draft as the `CoachInsight` entity from shared (§53).

    Returned as a dict so the caller can hand it to whichever Pydantic mirror
    `app.domain` exposes without this module guessing the class name.
    """
    return {
        "id": insight_id or f"ci_{uuid.uuid4().hex[:12]}",
        "session_id": session_id,
        "timestamp_ms": timestamp_ms,
        "kind": str(draft.kind),
        "title": draft.title,
        "body": draft.body,
        "allowed_in_assessment": draft.kind in ALLOWED_IN_ASSESSMENT,
    }


__all__ = [
    "ALLOWED_IN_ASSESSMENT",
    "LIVE_ALLOWED_IN_ASSESSMENT",
    "CoachAgent",
    "CoachInsightDraft",
    "CoachOutput",
    "CoachRequest",
    "InsightKind",
    "to_domain_insight",
]
