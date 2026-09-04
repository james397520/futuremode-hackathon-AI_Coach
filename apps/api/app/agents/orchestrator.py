"""`ConversationOrchestrator` — the turn loop (spec §19, §55, §66, §68, §49.4).

One trainee turn, in order:

    1. safety + intent pre-check   ComplianceAgent.fast_path + SafetyService + IntentPipeline
    2. ScenarioDirector            phase / hidden vars / difficulty / event injection
    3. KnowledgeAgent              retrieve, decide sufficiency, build citations
    4. CustomerAgent               in-persona reply (streamed)
    5. ComplianceAgent             post-check: trainee turn AND persona output
    6. CoachAgent                  insight — **Training Mode only**
    7. EvaluatorAgent              accumulate per-turn evidence

Event timing (spec §55/§68) — `agent.thinking` always precedes the slow work it
describes, `agent.response.partial` is emitted as tokens arrive, and
`persona.state.updated` is emitted **after the director has run** so the right-hand
Persona State card never shows a state the director has not produced (§20):

    speech.final(trainee)
    agent.thinking(compliance)        -> pre-check
    agent.thinking(scenario_director) -> director
    persona.state.updated
    agent.thinking(knowledge)         -> retrieval (concurrent with compliance model tier)
    knowledge.citation
    agent.thinking(customer)          -> streaming starts
    agent.response.partial * n
    agent.response.final
    agent.thinking(compliance)        -> post-check (concurrent with coach)
    compliance.warning * n
    agent.thinking(coach)             -> training mode only
    coach.insight * n
    score.updated * n                 -> only when score_live_enabled (§23)

Degradation (spec §49.4): the knowledge, coach, evaluator and compliance-model legs
are non-critical. If one raises, the turn still completes; only a customer-agent
failure falls back to a deterministic in-persona line rather than aborting.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import CollectingTelemetrySink, gather_degrading
from app.agents.coach_agent import CoachAgent, CoachRequest, to_domain_insight
from app.agents.compliance_agent import (
    ComplianceAgent,
    ComplianceFindingDraft,
    ComplianceRequest,
    ComplianceResult,
    to_domain_finding,
)
from app.agents.customer_agent import CustomerAgent, CustomerReply, CustomerTurnRequest
from app.agents.errors import AgentError
from app.agents.evaluator_agent import EvaluatorAgent
from app.agents.intent import (
    ClientIntentHint,
    IntentDecision,
    IntentPipeline,
    IntentRequest,
    SafetyPort,
)
from app.agents.knowledge_agent import (
    EvidenceItem,
    KnowledgeAgent,
    KnowledgeRequest,
    KnowledgeVerdict,
)
from app.agents.patterns import max_severity
from app.agents.scenario_director import (
    DirectorDecision,
    DirectorInput,
    DirectorState,
    ScenarioDirector,
)
from app.ws.events import EventEmitter, now_ms

log = structlog.get_logger(__name__)


class TurnInput(BaseModel):
    """Everything the orchestrator needs for one trainee turn."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    session_id: str
    text: str
    timestamp_ms: int = Field(default_factory=now_ms)
    turn_id: str = ""
    mode: str = "training"
    locale: str = "zh-TW"
    turn_index: int = 0
    elapsed_seconds: int = 0

    #: pinned scenario/persona config (§54 version pinning)
    persona: dict[str, Any] = Field(default_factory=dict)
    persona_hidden: dict[str, Any] = Field(default_factory=dict)
    scenario: dict[str, Any] = Field(default_factory=dict)
    knowledge_base_ids: list[str] = Field(default_factory=list)

    state: Any = None                          # PersonaSimulationState
    director_state: DirectorState = Field(default_factory=DirectorState)
    recent_turns: list[tuple[str, str]] = Field(default_factory=list)
    last_persona_text: str = ""

    score_live_enabled: bool = False
    voice_enabled: bool = False
    client_intent_hint: ClientIntentHint | None = None
    #: has a required disclosure already been made earlier in this session?
    disclosure_made_earlier: bool = False


class TurnResult(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    trainee_turn: dict[str, Any]
    persona_turn: dict[str, Any] | None = None
    intent: IntentDecision
    director: DirectorDecision | None = None
    knowledge: KnowledgeVerdict | None = None
    reply: CustomerReply | None = None
    citations: list[dict[str, Any]] = Field(default_factory=list)
    coach_insights: list[dict[str, Any]] = Field(default_factory=list)
    compliance_findings: list[dict[str, Any]] = Field(default_factory=list)
    state: Any = None
    director_state: DirectorState = Field(default_factory=DirectorState)
    blocked: bool = False
    degraded_agents: list[str] = Field(default_factory=list)
    telemetry: list[dict[str, Any]] = Field(default_factory=list)


class ConversationOrchestrator:
    """Owns the turn loop. One instance per live session."""

    def __init__(
        self,
        *,
        emitter: EventEmitter,
        customer: CustomerAgent,
        knowledge: KnowledgeAgent | None = None,
        coach: CoachAgent | None = None,
        evaluator: EvaluatorAgent | None = None,
        compliance: ComplianceAgent | None = None,
        director: ScenarioDirector | None = None,
        intent_pipeline: IntentPipeline | None = None,
        safety: SafetyPort | None = None,
        locale: str = "zh-TW",
        telemetry: CollectingTelemetrySink | None = None,
    ) -> None:
        self.emitter = emitter
        self.customer = customer
        self.knowledge = knowledge
        self.coach = coach
        self.evaluator = evaluator
        self.compliance = compliance
        self.director = director or ScenarioDirector(locale=locale)
        self.intent = intent_pipeline or IntentPipeline(locale=locale, safety=safety)
        self.safety = safety
        self.locale = locale
        self.telemetry = telemetry or CollectingTelemetrySink()
        for agent in (customer, knowledge, coach, evaluator, compliance):
            if agent is not None:
                agent.telemetry = self.telemetry

    # ------------------------------------------------------------------
    async def handle_turn(self, payload: TurnInput) -> TurnResult:
        degraded: list[str] = []
        turn_id = payload.turn_id or f"tt_{uuid.uuid4().hex[:12]}"
        trainee_turn = self._turn_dict(
            payload, turn_id=turn_id, speaker="trainee", text=payload.text
        )
        await self.emitter.speech_final(trainee_turn)

        # --- 1. safety + intent pre-check ------------------------------
        await self.emitter.agent_thinking("compliance")
        compliance_request = self._compliance_request(payload, turn_id, persona_text="")
        pre_check: ComplianceResult
        intent_decision: IntentDecision
        intent_decision, pre_check = await self._pre_check(payload, compliance_request, degraded)
        trainee_turn["intent"] = str(intent_decision.label)

        for finding in pre_check.findings:
            await self._emit_finding(payload, finding)

        if pre_check.blocked or intent_decision.is_blocked:
            return await self._handle_blocked(
                payload, turn_id, trainee_turn, intent_decision, pre_check, degraded
            )

        # --- 2. scenario director --------------------------------------
        await self.emitter.agent_thinking("scenario_director")
        decision = self.director.decide(
            DirectorInput(
                state=payload.state,
                director_state=payload.director_state,
                trainee_text=payload.text,
                intent=intent_decision,
                mode=payload.mode,
                locale=payload.locale,
                last_persona_text=payload.last_persona_text,
                citations_count=0,
                compliance_severity=pre_check.overall_risk,
                elapsed_seconds=payload.elapsed_seconds,
                time_limit_seconds=payload.scenario.get("time_limit_seconds"),
                max_turns=payload.scenario.get("max_turns"),
                key_objections=list(payload.scenario.get("key_objections") or []),
            )
        )
        # persona.state.updated is emitted here — after the director ran (§20/§68)
        await self.emitter.persona_state_updated(decision.state)

        # --- 3. knowledge (concurrent with the compliance model tier) ---
        await self.emitter.agent_thinking("knowledge")
        knowledge_leg = self._knowledge_leg(payload, intent_decision)
        compliance_model_leg = self._compliance_model_leg(compliance_request)
        knowledge_verdict, trainee_model_findings = await gather_degrading(
            knowledge_leg, compliance_model_leg
        )
        if knowledge_verdict is None and self.knowledge is not None:
            degraded.append("knowledge")
        citations: list[dict[str, Any]] = []
        evidence: list[EvidenceItem] = []
        if isinstance(knowledge_verdict, tuple):
            knowledge_verdict, evidence = knowledge_verdict
            citations = build_citations(evidence, knowledge_verdict.used_citation_indexes)
        if citations:
            await self.emitter.knowledge_citation(turn_id, citations)

        # --- 4. customer agent (streamed) ------------------------------
        await self.emitter.agent_thinking("customer")
        persona_turn_id = f"pt_{uuid.uuid4().hex[:12]}"
        customer_request = CustomerTurnRequest(
            persona=payload.persona,
            hidden=payload.persona_hidden,
            director=decision,
            intent=intent_decision,
            knowledge_summary=(
                knowledge_verdict.summary_for_persona() if knowledge_verdict is not None else ""
            ),
            recent_turns=payload.recent_turns,
            trainee_text=payload.text,
            opening_context=str(payload.scenario.get("opening_context") or ""),
            locale=payload.locale,
            mode=payload.mode,
            turn_index=payload.turn_index,
        )
        reply = await self._customer_leg(customer_request, persona_turn_id, degraded)

        state = decision.state
        if reply.reveals_hidden_need and decision.allow_hidden_need_reveal:
            state = self.director.apply_hidden_need_reveal(state)
            await self.emitter.persona_state_updated(state)

        persona_turn = self._turn_dict(
            payload,
            turn_id=persona_turn_id,
            speaker="persona",
            text=reply.text,
            citations=citations,
            state_delta=decision.state_delta,
        )
        await self.emitter.agent_response_final(persona_turn)

        # --- 5/6/7. post-checks, coach, evaluator (concurrent) ---------
        await self.emitter.agent_thinking("compliance")
        post_request = self._compliance_request(payload, turn_id, persona_text=reply.text)
        legs: list[Any] = [self._persona_audit_leg(post_request)]
        coach_index = -1
        if self.coach is not None and payload.mode == "training":
            await self.emitter.agent_thinking("coach")
            coach_index = 1
            legs.append(self._coach_leg(payload, reply, decision))
        results = await gather_degrading(*legs)
        persona_findings: list[ComplianceFindingDraft] = results[0] or []
        coach_output = results[coach_index] if coach_index > 0 else None
        if coach_index > 0 and coach_output is None:
            degraded.append("coach")

        all_findings: list[ComplianceFindingDraft] = [
            *(trainee_model_findings or []),
            *persona_findings,
        ]
        for finding in all_findings:
            await self._emit_finding(payload, finding)

        coach_payloads: list[dict[str, Any]] = []
        if coach_output is not None:
            for insight in coach_output.insights:
                domain_insight = to_domain_insight(
                    insight, session_id=payload.session_id, timestamp_ms=payload.timestamp_ms
                )
                coach_payloads.append(domain_insight)
                await self.emitter.coach_insight(domain_insight)

        # evaluator: deterministic per-turn evidence accumulation (§19.6)
        if self.evaluator is not None:
            self.evaluator.observe_turn(
                turn_id=turn_id,
                timestamp_ms=payload.timestamp_ms,
                speaker="trainee",
                text=payload.text,
                signals=[str(s) for s in decision.signals],
                citations=len(citations),
                compliance_severity=max_severity(
                    [pre_check.overall_risk, *(f.severity for f in all_findings)]
                ),
                intent_label=str(intent_decision.label),
            )
            if payload.score_live_enabled:
                for skill, score in self.evaluator.live_scores().items():
                    await self.emitter.score_updated(skill, score, confidence=0.4)

        findings_payload = [
            to_domain_finding(f, session_id=payload.session_id)
            for f in [*pre_check.findings, *all_findings]
        ]
        return TurnResult(
            trainee_turn=trainee_turn,
            persona_turn=persona_turn,
            intent=intent_decision,
            director=decision,
            knowledge=knowledge_verdict,
            reply=reply,
            citations=citations,
            coach_insights=coach_payloads,
            compliance_findings=findings_payload,
            state=state,
            director_state=decision.director_state,
            blocked=False,
            degraded_agents=degraded,
            telemetry=[t.as_dict() for t in self.telemetry.records],
        )

    # ------------------------------------------------------------------
    # legs
    # ------------------------------------------------------------------
    async def _pre_check(
        self,
        payload: TurnInput,
        compliance_request: ComplianceRequest,
        degraded: list[str],
    ) -> tuple[IntentDecision, ComplianceResult]:
        """Intent resolution and the rule-tier compliance check, run concurrently."""
        intent_request = IntentRequest(
            text=payload.text,
            locale=payload.locale,
            mode=payload.mode,
            scenario_phase=str(getattr(payload.state, "scenario_phase", "opening")),
            allowed_scope=list(payload.scenario.get("required_knowledge") or []),
            restricted_topics=list(payload.scenario.get("restricted_topics") or []),
            recent_turns=payload.recent_turns,
            client_hint=payload.client_intent_hint,
        )

        async def intent_leg() -> IntentDecision:
            return await self.intent.resolve(intent_request)

        async def compliance_leg() -> ComplianceResult:
            if self.compliance is None:
                return ComplianceResult()
            # rule tier is synchronous and cheap; keep it in the gather for symmetry
            return self.compliance.fast_path(compliance_request)

        intent_decision, pre_check = await gather_degrading(intent_leg(), compliance_leg())
        if intent_decision is None:
            degraded.append("intent")
            intent_decision = IntentDecision(normalized_text=payload.text)
        if pre_check is None:
            degraded.append("compliance")
            pre_check = ComplianceResult()
        return intent_decision, pre_check

    async def _knowledge_leg(
        self, payload: TurnInput, intent_decision: IntentDecision
    ) -> tuple[KnowledgeVerdict, list[EvidenceItem]] | None:
        if self.knowledge is None or not intent_decision.needs_knowledge:
            return None
        evidence = await self.knowledge.retrieve(
            intent_decision.normalized_text or payload.text,
            knowledge_base_ids=payload.knowledge_base_ids,
        )
        verdict = await self.knowledge.run(
            KnowledgeRequest(
                query=intent_decision.normalized_text or payload.text,
                locale=payload.locale,
                mode=payload.mode,
                allowed_scope=list(payload.scenario.get("required_knowledge") or []),
                restricted_topics=list(payload.scenario.get("restricted_topics") or []),
                evidence=evidence,
                recent_turns=payload.recent_turns,
            )
        )
        return verdict, evidence

    async def _compliance_model_leg(
        self, request: ComplianceRequest
    ) -> list[ComplianceFindingDraft]:
        if self.compliance is None:
            return []
        result = await self.compliance.safe_run_model(request)
        if result is None:
            return []
        return [
            f
            for f in result.findings
            if ComplianceAgent._evidence_is_real(f, request)  # noqa: SLF001 - same package
        ]

    async def _persona_audit_leg(
        self, request: ComplianceRequest
    ) -> list[ComplianceFindingDraft]:
        if self.compliance is None:
            return []
        return self.compliance.audit_persona_output(request).findings

    async def _coach_leg(
        self, payload: TurnInput, reply: CustomerReply, decision: DirectorDecision
    ) -> Any:
        if self.coach is None:
            return None
        return await self.coach.run(
            CoachRequest(
                mode=payload.mode,
                locale=payload.locale,
                session_id=payload.session_id,
                timestamp_ms=payload.timestamp_ms,
                trainee_text=payload.text,
                persona_text=reply.text,
                persona_state=decision.state.model_dump(),
                director_signals=[str(s) for s in decision.signals],
                learning_objectives=list(payload.scenario.get("learning_objectives") or []),
                required_talking_points=list(
                    payload.scenario.get("required_talking_points") or []
                ),
                recent_turns=payload.recent_turns,
            )
        )

    async def _customer_leg(
        self, request: CustomerTurnRequest, persona_turn_id: str, degraded: list[str]
    ) -> CustomerReply:
        async def on_delta(delta: str) -> None:
            await self.emitter.agent_response_partial(persona_turn_id, delta)

        try:
            return await self.customer.stream_turn(request, on_delta=on_delta)
        except (AgentError, TimeoutError) as exc:
            log.warning("orchestrator.customer_degraded", error=repr(exc))
            degraded.append("customer")
            fallback = self.customer.deterministic_reply(request)
            # the trainee has seen nothing yet in this branch, so stream the fallback
            await self.emitter.agent_response_partial(persona_turn_id, fallback.text)
            return fallback

    # ------------------------------------------------------------------
    async def _handle_blocked(
        self,
        payload: TurnInput,
        turn_id: str,
        trainee_turn: dict[str, Any],
        intent_decision: IntentDecision,
        pre_check: ComplianceResult,
        degraded: list[str],
    ) -> TurnResult:
        """Blocked input still gets an in-character answer (spec §8.2, §21).

        No model is called: the input was an injection/jailbreak attempt, so we answer
        with a deterministic persona deflection and record the event for the audit log.
        """
        persona_turn_id = f"pt_{uuid.uuid4().hex[:12]}"
        request = CustomerTurnRequest(
            persona=payload.persona,
            hidden=payload.persona_hidden,
            intent=intent_decision,
            recent_turns=payload.recent_turns,
            trainee_text=payload.text,
            locale=payload.locale,
            mode=payload.mode,
            turn_index=payload.turn_index,
        )
        reply = self.customer.deterministic_reply(request)
        await self.emitter.agent_thinking("customer")
        await self.emitter.agent_response_partial(persona_turn_id, reply.text)
        persona_turn = self._turn_dict(
            payload, turn_id=persona_turn_id, speaker="persona", text=reply.text
        )
        await self.emitter.agent_response_final(persona_turn)
        if payload.state is not None:
            await self.emitter.persona_state_updated(payload.state)
        log.warning(
            "orchestrator.turn_blocked",
            session=payload.session_id,
            label=str(intent_decision.label),
            flags=[str(f) for f in intent_decision.safety_flags],
        )
        return TurnResult(
            trainee_turn=trainee_turn,
            persona_turn=persona_turn,
            intent=intent_decision,
            reply=reply,
            state=payload.state,
            director_state=payload.director_state,
            compliance_findings=[
                to_domain_finding(f, session_id=payload.session_id) for f in pre_check.findings
            ],
            blocked=True,
            degraded_agents=degraded,
            telemetry=[t.as_dict() for t in self.telemetry.records],
        )

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _compliance_request(
        self, payload: TurnInput, turn_id: str, *, persona_text: str
    ) -> ComplianceRequest:
        return ComplianceRequest(
            trainee_text=payload.text,
            persona_text=persona_text,
            trainee_turn_id=turn_id,
            timestamp_ms=payload.timestamp_ms,
            locale=payload.locale,
            restricted_topics=list(payload.scenario.get("restricted_topics") or []),
            compliance_rules=list(payload.scenario.get("compliance_rules") or []),
            required_disclosures=list(payload.scenario.get("required_disclosures") or []),
            disclosure_made_earlier=payload.disclosure_made_earlier,
        )

    @staticmethod
    def _turn_dict(
        payload: TurnInput,
        *,
        turn_id: str,
        speaker: str,
        text: str,
        citations: Sequence[dict[str, Any]] | None = None,
        state_delta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Shape a `TranscriptTurn` (shared §53) as a plain dict."""
        turn: dict[str, Any] = {
            "id": turn_id,
            "session_id": payload.session_id,
            "speaker": speaker,
            "text": text,
            "timestamp_ms": payload.timestamp_ms,
        }
        if citations:
            turn["citations"] = list(citations)
        if state_delta:
            turn["state_delta"] = state_delta
        return turn

    async def _emit_finding(self, payload: TurnInput, finding: ComplianceFindingDraft) -> None:
        if finding.severity in ("safe",):
            return
        await self.emitter.compliance_warning(
            to_domain_finding(finding, session_id=payload.session_id)
        )

    # ------------------------------------------------------------------
    async def post_session_coaching(self, payload: TurnInput) -> list[dict[str, Any]]:
        """Post-session coaching is allowed in both modes (spec §19.4/§8.4)."""
        if self.coach is None:
            return []
        output = await self.coach.safe_run(
            CoachRequest(
                mode=payload.mode,
                locale=payload.locale,
                session_id=payload.session_id,
                timestamp_ms=payload.timestamp_ms,
                recent_turns=payload.recent_turns,
                persona_state=(
                    payload.state.model_dump() if payload.state is not None else {}
                ),
                learning_objectives=list(payload.scenario.get("learning_objectives") or []),
                post_session=True,
            )
        )
        if output is None:
            return []
        return [
            to_domain_insight(
                insight, session_id=payload.session_id, timestamp_ms=payload.timestamp_ms
            )
            for insight in output.insights
        ]


def build_citations(
    evidence: Sequence[EvidenceItem], used_indexes: Sequence[int]
) -> list[dict[str, Any]]:
    """Shape `Citation` objects (shared §12.5) from retrieved evidence."""
    wanted = set(used_indexes)
    return [
        {
            "chunk_id": item.chunk_id,
            "document_id": item.document_id,
            "document_name": item.document_name,
            "document_version": item.document_version,
            "page": item.page,
            "section": item.section,
            "similarity": round(item.similarity, 4),
            "rerank_score": (
                round(item.rerank_score, 4) if item.rerank_score is not None else None
            ),
            "snippet": item.snippet[:400],
        }
        for item in evidence
        if item.index in wanted
    ]


__all__ = ["ConversationOrchestrator", "TurnInput", "TurnResult", "build_citations"]
