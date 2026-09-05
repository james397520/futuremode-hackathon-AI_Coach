"""Trainee text-affect agent.

Extracted from the team's `backend/app/service.py::analyze_emotion` and rebuilt
on our `Agent` base so it shares the MiniMax client, the retry/timeout policy
and the telemetry sink with every other agent.

What was worth extracting is not the prompt — it is the **validation**. A model
asked "how does this person feel" will always answer, confidently, about
whatever text is in front of it. Their four server-side checks are what stop
that, and all four are kept:

1. the quote must appear verbatim in *this turn's* trainee text;
2. a definite label needs both a quote and a real intensity;
3. `不明確` may not carry an intensity;
4. anything failing the above is rejected rather than repaired.

Rejection here means `不明確`, not an exception: affect is a nice-to-have signal
and must never fail a turn (`optional = True`).
"""

from __future__ import annotations

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import Agent
from app.agents.llm_client import ModelPurpose
from app.agents.prompts.affect import affect_system_prompt
from app.agents.prompts.common import data_block, schema_block, untrusted_block
from app.domain.affect import AffectIntensity, AffectLabel, TextAffect

log = structlog.get_logger(__name__)


class AffectOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: AffectLabel = "不明確"
    intensity: AffectIntensity = "unknown"
    evidence_quote: str = ""
    reason: str = ""
    suggestion: str = ""


class AffectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = ""
    locale: str = "zh-TW"
    #: This turn's trainee utterance — the only text a reading may describe.
    trainee_text: str = ""
    #: Recent turns for disambiguation only. Never attributable to the trainee.
    recent_turns: list[tuple[str, str]] = Field(default_factory=list)


UNCLEAR = TextAffect(label="不明確", intensity="unknown")


class AffectAgent(Agent[AffectRequest, AffectOutput]):
    name = "coach"
    purpose = ModelPurpose.COACH
    output_model = AffectOutput
    optional = True
    #: Deterministic: this is a reading, not a creative task.
    default_temperature = 0.0
    default_max_tokens = 400

    def system_prompt(self) -> str:
        return affect_system_prompt(self.locale)

    def build_user_prompt(self, request: AffectRequest) -> str:
        context = "\n".join(f"{s}: {t}" for s, t in request.recent_turns[-6:])
        return "\n\n".join(
            [
                data_block("task", "single_turn_text_affect"),
                # Context is labelled as context in the data itself, not only in
                # the system prompt — the model has to see that these are other
                # people's words at the point it reads them.
                untrusted_block("context_only_not_the_subject", context),
                untrusted_block("current_message_trainee_this_turn", request.trainee_text),
                schema_block(self._schema(), name=self.output_model.__name__),
            ]
        )

    async def run(self, request: AffectRequest) -> AffectOutput:
        output = await self._invoke_structured(self._messages(request))
        return output

    async def read(self, request: AffectRequest) -> TextAffect:
        """Run and validate. Never raises — an unusable reading becomes 不明確."""
        try:
            output = await self.run(request)
        except Exception as exc:
            log.info("affect.failed", session=request.session_id, error=repr(exc))
            return UNCLEAR
        return self._enforce(output, request)

    def _enforce(self, output: AffectOutput, request: AffectRequest) -> TextAffect:
        quote = (output.evidence_quote or "").strip()

        # 1. The quote must come from this turn's trainee text. A model that
        #    quotes the customer is describing the wrong person entirely.
        if quote and quote not in request.trainee_text:
            log.info("affect.rejected", reason="quote_not_in_turn", session=request.session_id)
            return UNCLEAR

        # 3. 不明確 carries no intensity — otherwise "unclear, high" gets rendered
        #    as a strong reading of nothing.
        if output.label == "不明確":
            return TextAffect(
                label="不明確",
                intensity="unknown",
                reason=output.reason,
                suggestion=output.suggestion,
            )

        # 2. A definite label needs evidence *and* a real intensity.
        if not quote or output.intensity == "unknown":
            log.info("affect.rejected", reason="no_evidence", session=request.session_id)
            return UNCLEAR

        return TextAffect(
            label=output.label,
            intensity=output.intensity,
            evidence_quote=quote,
            reason=output.reason,
            suggestion=output.suggestion,
        )
