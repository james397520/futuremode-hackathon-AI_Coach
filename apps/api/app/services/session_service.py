"""`SessionService` — live simulation lifecycle (spec §14, §23, §54, §92, §30).

Responsibilities

* **create** — resolves the scenario + persona and **pins their versions** into the
  session row (§54: 「Scenario 與 Persona 必須 version pinning，避免訓練完成後設定被改掉
  導致報告不可重現」). Everything downstream — the orchestrator, the evaluator, the
  report — reads the pinned snapshot, never the live content row.
* **state machine** — `SESSION_TRANSITIONS` is the single source of truth for legal
  moves; anything else raises `StateTransitionError` (§92).
* **turn handling** — delegates to `ConversationOrchestrator`, then persists the
  transcript turns, persona state and findings the turn produced.
* **pause / resume / end** — including the Assessment-Mode restriction on pausing.
* **replay assembly** — the §30 replay payload: transcript, state timeline, coach
  insights, compliance findings, citations, all in one ordered structure.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.intent import ClientIntentHint
from app.agents.orchestrator import ConversationOrchestrator, TurnInput, TurnResult
from app.agents.scenario_director import DirectorState, ScenarioDirector
from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.domain import PersonaSimulationState  # assumed: re-exported from app.domain
from app.domain.affect import face_from_command
from app.domain.request_response import SessionTranscriptResponse
from app.domain.session import CoachInsight, TranscriptTurn
from app.services.base import (
    MANAGEMENT_ROLES,
    ROLE_COACH,
    BaseService,
    iso_now,
    new_id,
)
from app.services.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    StateTransitionError,
    ValidationFailedError,
)
from app.services.repository import Repository, RepositoryPort, field
from app.ws.events import EventEmitter, EventEmitterRegistry, now_ms

log = structlog.get_logger(__name__)

#: §92 / §23 session state machine. Keys are states; values are the legal successors.
SESSION_TRANSITIONS: dict[str, frozenset[str]] = {
    "idle": frozenset({"connecting", "error"}),
    "connecting": frozenset({"ready", "reconnecting", "error"}),
    "ready": frozenset(
        {"listening", "transcribing", "processing", "paused", "reconnecting", "completed", "error"}
    ),
    "listening": frozenset({"transcribing", "processing", "ready", "paused", "error"}),
    "transcribing": frozenset({"processing", "ready", "error"}),
    "processing": frozenset({"persona_speaking", "ready", "paused", "error"}),
    "persona_speaking": frozenset({"ready", "listening", "paused", "completed", "error"}),
    "paused": frozenset({"ready", "reconnecting", "completed", "error"}),
    "reconnecting": frozenset({"ready", "completed", "error"}),
    # terminal
    "completed": frozenset(),
    "error": frozenset({"connecting", "reconnecting", "completed"}),
}

TERMINAL_STATES = frozenset({"completed"})
LIVE_STATES = frozenset(
    {"ready", "listening", "transcribing", "processing", "persona_speaking"}
)


def can_transition(current: str, requested: str) -> bool:
    return requested in SESSION_TRANSITIONS.get(current, frozenset())


def assert_transition(current: str, requested: str) -> None:
    if current == requested:
        return
    if not can_transition(current, requested):
        raise StateTransitionError("session", current, requested)


class PinnedSnapshot(BaseModel):
    """The immutable copy of the content a session was started against (§54)."""

    model_config = ConfigDict(extra="forbid")

    scenario_id: str
    scenario_version: int
    persona_id: str
    persona_version: int
    rubric_id: str | None = None
    rubric_version: int | None = None
    scenario: dict[str, Any] = Field(default_factory=dict)
    persona: dict[str, Any] = Field(default_factory=dict)
    persona_hidden: dict[str, Any] = Field(default_factory=dict)
    knowledge_base_ids: list[str] = Field(default_factory=list)
    embedding_model: str = ""
    pinned_at: str = Field(default_factory=iso_now)


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_id: str
    mode: str | None = None                 # override the scenario's default mode
    runtime: str = "server"                 # webgpu | wasm | server
    voice_enabled: bool = False
    score_live_enabled: bool = False
    assignment_id: str | None = None
    locale: str | None = None


class SessionView(BaseModel):
    """What the routers return for a session (mirrors `TrainingSession`)."""

    model_config = ConfigDict(extra="forbid")

    session_id: str
    tenant_id: str
    workspace_id: str
    user_id: str
    scenario_id: str
    scenario_version: int
    persona_id: str
    persona_version: int
    mode: str
    status: str
    started_at: str
    ended_at: str | None = None
    runtime: str = "server"
    voice_enabled: bool = False
    score_live_enabled: bool = False
    turn_count: int = 0


class ReplayPayload(BaseModel):
    """§30 Conversation Replay + §31 Emotion/Persona State Timeline."""

    model_config = ConfigDict(extra="forbid")

    session: SessionView
    pinned: PinnedSnapshot
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    state_timeline: list[dict[str, Any]] = Field(default_factory=list)
    coach_insights: list[dict[str, Any]] = Field(default_factory=list)
    compliance_findings: list[dict[str, Any]] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    evaluation_id: str | None = None
    duration_ms: int = 0


OrchestratorFactory = Callable[["SessionRuntimeState", EventEmitter], ConversationOrchestrator]


class SessionRuntimeState(BaseModel):
    """In-flight state for one live session (persisted between turns)."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    session_id: str
    mode: str = "training"
    locale: str = "zh-TW"
    status: str = "idle"
    turn_index: int = 0
    started_ms: int = Field(default_factory=now_ms)
    persona_state: Any = None
    director_state: DirectorState = Field(default_factory=DirectorState)
    pinned: PinnedSnapshot | None = None
    recent_turns: list[tuple[str, str]] = Field(default_factory=list)
    last_persona_text: str = ""
    disclosure_made: bool = False
    score_live_enabled: bool = False
    voice_enabled: bool = False


class SessionService(BaseService):
    """`Service(db_session, ctx)` — the contract the routers construct."""

    def __init__(
        self,
        db: Any,
        ctx: RequestContext,
        *,
        repo: RepositoryPort | None = None,
        emitters: EventEmitterRegistry | None = None,
        orchestrator_factory: OrchestratorFactory | None = None,
    ) -> None:
        super().__init__(db, ctx)
        self.repo: RepositoryPort = repo or Repository(
            db, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )
        self.emitters = emitters or EventEmitterRegistry()
        self._orchestrator_factory = orchestrator_factory
        self._runtime: dict[str, SessionRuntimeState] = {}

    # ------------------------------------------------------------------
    # create
    # ------------------------------------------------------------------
    async def create(self, request: CreateSessionRequest) -> SessionView:
        scenario = await self.repo.get("Scenario", request.scenario_id)
        if scenario is None:
            raise NotFoundError(f"scenario {request.scenario_id} not found")
        self.assert_same_tenant(scenario, resource="scenario")
        status = str(field(scenario, "status", "draft"))
        if status != "published" and not self.has_role(ROLE_COACH, "admin"):
            raise PermissionDeniedError(
                f"scenario {request.scenario_id} is '{status}'; only published scenarios "
                "can be run by trainees (§38)"
            )
        persona_id = str(field(scenario, "persona_id", ""))
        persona = await self.repo.get("Persona", persona_id)
        if persona is None:
            raise NotFoundError(f"persona {persona_id} referenced by scenario not found")
        self.assert_same_tenant(persona, resource="persona")

        pinned = self.pin(scenario, persona)
        mode = request.mode or str(field(scenario, "mode", "training"))
        if mode not in ("training", "assessment"):
            raise ValidationFailedError(f"unknown session mode: {mode}")

        session_id = new_id("ses")
        row = await self.repo.add(
            "TrainingSession",
            {
                **self.owned_fields(),
                "id": session_id,
                "session_id": session_id,
                "user_id": self.user_id,
                "scenario_id": pinned.scenario_id,
                "scenario_version": pinned.scenario_version,
                "persona_id": pinned.persona_id,
                "persona_version": pinned.persona_version,
                "assignment_id": request.assignment_id,
                "mode": mode,
                "status": "connecting",
                "started_at": iso_now(),
                "runtime": request.runtime,
                "voice_enabled": request.voice_enabled,
                "score_live_enabled": (
                    request.score_live_enabled and mode == "training"
                ),
                "turn_count": 0,
                "pinned_snapshot": pinned.model_dump(),
            },
        )
        await self.repo.commit()

        self._runtime[session_id] = SessionRuntimeState(
            session_id=session_id,
            mode=mode,
            locale=request.locale or str(field(persona, "locale", "zh-TW") or "zh-TW"),
            status="connecting",
            persona_state=self.initial_persona_state(pinned),
            director_state=DirectorState(
                difficulty=str(field(scenario, "difficulty", "medium") or "medium"),
                base_difficulty=str(field(scenario, "difficulty", "medium") or "medium"),
                objection_queue=ScenarioDirector().seed_objections(
                    list(pinned.scenario.get("key_objections") or [])
                ),
            ),
            pinned=pinned,
            score_live_enabled=bool(request.score_live_enabled and mode == "training"),
            voice_enabled=request.voice_enabled,
        )
        self.audit("session.create", f"session:{session_id}")
        return self.to_view(row)

    def pin(self, scenario: Any, persona: Any) -> PinnedSnapshot:
        """Deep-copy the content into the session (§54 version pinning)."""
        scenario_fields = (
            "name", "description", "industry", "training_type", "difficulty", "mode",
            "opening_context", "learning_objectives", "required_knowledge",
            "required_talking_points", "key_objections", "restricted_topics",
            "success_condition", "failure_condition", "time_limit_seconds", "max_turns",
            "minimum_score", "rubric_id", "compliance_rules", "required_disclosures",
        )
        # `id` and `gender` are not cosmetic: voice selection keys on gender and
        # hashes the id for the ungendered fallback. Leaving them out made every
        # session's persona "ungendered", so 林佳穎 (female) spoke with the male
        # voice whenever the hash landed on it.
        persona_fields = (
            "id", "name", "gender", "age", "occupation", "industry", "background",
            "language", "locale", "traits", "voice", "avatar_url",
        )
        return PinnedSnapshot(
            scenario_id=str(field(scenario, "id", "")),
            scenario_version=int(field(scenario, "version", 1) or 1),
            persona_id=str(field(persona, "id", "")),
            persona_version=int(field(persona, "version", 1) or 1),
            rubric_id=field(scenario, "rubric_id"),
            scenario={
                key: _plain(field(scenario, key))
                for key in scenario_fields
                if field(scenario, key) is not None
            },
            persona={
                key: _plain(field(persona, key))
                for key in persona_fields
                if field(persona, key) is not None
            },
            persona_hidden=_plain(field(persona, "hidden") or {}),
            knowledge_base_ids=[
                str(kb) for kb in (field(scenario, "knowledge_base_ids") or [])
            ],
        )

    @staticmethod
    def initial_persona_state(pinned: PinnedSnapshot) -> Any:
        """Seed `PersonaSimulationState` from the persona's traits + hidden state."""
        traits = pinned.persona.get("traits") or {}
        hidden = pinned.persona_hidden or {}
        return PersonaSimulationState(
            scenario_phase="opening",
            emotion="neutral",
            trust=int(traits.get("trust", 40) or 40),
            interest=int(traits.get("openness", 45) or 45),
            resistance=int(traits.get("resistance", 55) or 55),
            patience=int(traits.get("patience", 60) or 60),
            intent="unknown",
            current_goal=str(hidden.get("primary_goal") or "figure_out_why_we_are_talking"),
            budget=hidden.get("budget"),
            hidden_need_revealed=False,
            compliance_risk="safe",
            time_pressure=0,
        )

    # ------------------------------------------------------------------
    # state machine
    # ------------------------------------------------------------------
    async def transition(self, session_id: str, requested: str) -> SessionView:
        row = await self._require(session_id)
        current = str(field(row, "status", "idle"))
        assert_transition(current, requested)
        values: dict[str, Any] = {"status": requested}
        if requested in TERMINAL_STATES:
            values["ended_at"] = iso_now()
        updated = await self.repo.update("TrainingSession", session_id, values)
        await self.repo.commit()
        runtime = self._runtime.get(session_id)
        if runtime is not None:
            runtime.status = requested
        emitter = await self.emitters.get(
            session_id, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )
        if requested == "ready" and current in ("connecting", "reconnecting"):
            await emitter.session_started("ready", iso_now())
        elif requested == "paused":
            await emitter.session_paused()
        elif requested == "ready" and current == "paused":
            await emitter.session_resumed()
        return self.to_view(updated)

    async def speak_opening_line(self, session_id: str) -> dict[str, Any] | None:
        """Let the customer open the conversation with the line the scenario puts
        in their mouth — the 「…」-quoted sentence in `opening_context`.

        Every scenario is written that way ("他坐下來第一句話是：「…」"), yet the
        session used to start with the trainee staring at a description card and
        the customer silent. Idempotent: nothing happens once the session has any
        turn, so a reconnect never repeats the opener.
        """
        row = await self._require(session_id, read_only=True)
        existing = await self.repo.list(
            "TranscriptTurn", filters={"session_id": session_id}, order_by="timestamp_ms"
        )
        if existing:
            return None
        pinned = await self._pinned_for_row(row)
        context = str((pinned.scenario or {}).get("opening_context") or "")
        quoted = re.findall(r"「([^」]{2,120})」", context)
        if not quoted:
            return None
        text = quoted[-1].strip()
        emitter = await self.emitters.get(
            session_id, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )
        turn: dict[str, Any] = {
            "id": new_id("pt"),
            "session_id": session_id,
            "seq": 0,
            "speaker": "persona",
            "text": text,
            "timestamp_ms": now_ms(),
        }
        await self.repo.add("TranscriptTurn", {**turn, **self.owned_fields()})
        await self.repo.commit()
        await emitter.agent_response_final(
            {k: v for k, v in turn.items() if k != "seq"}
        )
        return turn

    async def mark_ready(self, session_id: str) -> SessionView:
        return await self.transition(session_id, "ready")

    async def pause(self, session_id: str) -> SessionView:
        row = await self._require(session_id)
        if str(field(row, "mode", "training")) == "assessment" and not self.has_role(
            *MANAGEMENT_ROLES
        ):
            # §8.4 lists Pause as a Training-Mode affordance.
            raise PermissionDeniedError("pausing is not available in Assessment Mode")
        return await self.transition(session_id, "paused")

    async def resume(self, session_id: str) -> SessionView:
        row = await self._require(session_id)
        if str(field(row, "status", "")) != "paused":
            raise StateTransitionError("session", str(field(row, "status", "")), "ready")
        return await self.transition(session_id, "ready")

    async def end(self, session_id: str, *, reason: str = "user_ended") -> SessionView:
        row = await self._require(session_id)
        current = str(field(row, "status", "idle"))
        if current in TERMINAL_STATES:
            return self.to_view(row)
        assert_transition(current, "completed")
        updated = await self.repo.update(
            "TrainingSession",
            session_id,
            {"status": "completed", "ended_at": iso_now(), "end_reason": reason},
        )
        await self.repo.commit()
        emitter = await self.emitters.get(session_id)
        await emitter.session_completed(None)
        self.audit("session.end", f"session:{session_id}", reason=reason)
        return self.to_view(updated)

    # ------------------------------------------------------------------
    # turn handling
    # ------------------------------------------------------------------
    async def handle_message(
        self,
        session_id: str,
        text: str,
        *,
        client_intent_hint: ClientIntentHint | None = None,
        face_affect: dict[str, Any] | None = None,
        orchestrator: ConversationOrchestrator | None = None,
    ) -> TurnResult:
        """One trainee turn. Delegates the AI work to the orchestrator (§19)."""
        row = await self._require(session_id)
        status = str(field(row, "status", "idle"))
        if status not in LIVE_STATES:
            raise StateTransitionError("session", status, "processing")
        if str(field(row, "user_id", "")) != self.user_id and not self.has_role(
            ROLE_COACH, "admin"
        ):
            raise PermissionDeniedError("only the session owner may send messages")
        if not text.strip():
            raise ValidationFailedError("message text is empty")

        runtime = await self._runtime_state(session_id, row)
        emitter = await self.emitters.get(
            session_id, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )
        if status != "processing":
            await self.repo.update("TrainingSession", session_id, {"status": "processing"})
        conductor = orchestrator or self._build_orchestrator(runtime, emitter)

        pinned = runtime.pinned or PinnedSnapshot(
            scenario_id="", scenario_version=1, persona_id="", persona_version=1
        )
        payload = TurnInput(
            session_id=session_id,
            text=text,
            turn_id=new_id("tt"),
            mode=runtime.mode,
            locale=runtime.locale,
            turn_index=runtime.turn_index,
            elapsed_seconds=max(0, (now_ms() - runtime.started_ms) // 1000),
            persona=pinned.persona,
            persona_hidden=pinned.persona_hidden,
            scenario=pinned.scenario,
            knowledge_base_ids=list(pinned.knowledge_base_ids),
            state=runtime.persona_state,
            director_state=runtime.director_state,
            recent_turns=list(runtime.recent_turns),
            last_persona_text=runtime.last_persona_text,
            score_live_enabled=runtime.score_live_enabled,
            voice_enabled=runtime.voice_enabled,
            client_intent_hint=client_intent_hint,
            face_affect=face_from_command(face_affect),
            disclosure_made_earlier=runtime.disclosure_made,
        )
        result = await conductor.handle_turn(payload)
        await self._persist_turn(session_id, runtime, result)
        return result

    async def _persist_turn(
        self, session_id: str, runtime: SessionRuntimeState, result: TurnResult
    ) -> None:
        runtime.turn_index += 1
        runtime.persona_state = result.state or runtime.persona_state
        runtime.director_state = result.director_state
        runtime.recent_turns.append(("trainee", result.trainee_turn.get("text", "")))
        if result.persona_turn is not None:
            runtime.recent_turns.append(("customer", result.persona_turn.get("text", "")))
            runtime.last_persona_text = result.persona_turn.get("text", "")
        runtime.recent_turns = runtime.recent_turns[-20:]
        if not runtime.disclosure_made:
            runtime.disclosure_made = _mentions_disclosure(
                result.trainee_turn.get("text", "")
            )

        await self.repo.add("TranscriptTurn", {**result.trainee_turn, **self.owned_fields()})
        if result.persona_turn is not None:
            await self.repo.add(
                "TranscriptTurn", {**result.persona_turn, **self.owned_fields()}
            )
        for insight in result.coach_insights:
            await self.repo.add("CoachInsight", {**insight, **self.owned_fields()})
        for finding in result.compliance_findings:
            await self.repo.add("ComplianceFinding", {**finding, **self.owned_fields()})
        await self.repo.update(
            "TrainingSession",
            session_id,
            {
                "turn_count": runtime.turn_index,
                "status": "ready",
                "persona_state": _plain(runtime.persona_state),
                "director_state": runtime.director_state.model_dump(),
            },
        )
        await self.repo.commit()
        if result.degraded_agents:
            log.warning(
                "session.turn_degraded",
                session=session_id,
                agents=result.degraded_agents,
            )

    # ------------------------------------------------------------------
    # replay
    # ------------------------------------------------------------------
    async def replay(self, session_id: str) -> ReplayPayload:
        row = await self._require(session_id, read_only=True)
        pinned = await self._pinned_for_row(row)
        turns = await self.repo.list(
            "TranscriptTurn", filters={"session_id": session_id}, order_by="timestamp_ms"
        )
        insights = await self.repo.list(
            "CoachInsight", filters={"session_id": session_id}, order_by="timestamp_ms"
        )
        findings = await self.repo.list(
            "ComplianceFinding", filters={"session_id": session_id}, order_by="timestamp_ms"
        )
        transcript = [_plain(turn) for turn in turns]
        timeline: list[dict[str, Any]] = []
        citations: list[dict[str, Any]] = []
        for turn in transcript:
            delta = turn.get("state_delta") or {}
            if delta:
                timeline.append({"timestamp_ms": turn.get("timestamp_ms", 0), **delta})
            for citation in turn.get("citations") or []:
                citations.append({"turn_id": turn.get("id"), **_plain(citation)})
        started = field(row, "started_at")
        ended = field(row, "ended_at")
        return ReplayPayload(
            session=self.to_view(row),
            pinned=pinned,
            transcript=transcript,
            state_timeline=timeline,
            coach_insights=[_plain(i) for i in insights],
            compliance_findings=[_plain(f) for f in findings],
            citations=citations,
            evaluation_id=field(row, "evaluation_id"),
            duration_ms=_duration_ms(started, ended),
        )

    async def get_transcript(self, session_id: str) -> SessionTranscriptResponse:
        """§25 / §30 transcript in the shape the route declares.

        The route has always declared `SessionTranscriptResponse`; the service
        only ever had `transcript()`, which returns a bare list, so every call
        500'd on response validation. Built from `replay()` so the insights and
        the state timeline come along for free. Rows are filtered to the model's
        declared fields because `DomainModel` is `extra="forbid"` and the ORM
        rows carry `seq`, tenant columns and timestamps the contract does not.
        """
        payload = await self.replay(session_id)

        def _fit(model: type[Any], row: Mapping[str, Any]) -> Any:
            allowed = set(model.model_fields)
            return model.model_validate({k: v for k, v in row.items() if k in allowed})

        # The stored timeline is a list of per-turn *deltas* (only the fields the
        # director changed), not full states. A timeline of states is rebuilt by
        # starting from the pinned persona's seeded state and folding each delta
        # in — which is also what §31 means by a state timeline.
        fields = set(PersonaSimulationState.model_fields)
        running = self.initial_persona_state(payload.pinned).model_dump()
        snapshots: list[PersonaSimulationState] = []
        for item in payload.state_timeline:
            if not isinstance(item, Mapping):
                continue
            running.update({k: v for k, v in item.items() if k in fields})
            snapshots.append(PersonaSimulationState.model_validate(running))

        return SessionTranscriptResponse(
            session_id=session_id,
            turns=[_fit(TranscriptTurn, t) for t in payload.transcript],
            insights=[_fit(CoachInsight, i) for i in payload.coach_insights],
            state_timeline=snapshots,
        )

    async def transcript(self, session_id: str) -> list[dict[str, Any]]:
        await self._require(session_id, read_only=True)
        turns = await self.repo.list(
            "TranscriptTurn", filters={"session_id": session_id}, order_by="timestamp_ms"
        )
        return [_plain(turn) for turn in turns]

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    async def get(self, session_id: str) -> SessionView:
        return self.to_view(await self._require(session_id, read_only=True))

    async def list_for_user(
        self, user_id: str | None = None, *, limit: int = 50
    ) -> list[SessionView]:
        target = user_id or self.user_id
        self.require_self_or_role(target, ROLE_COACH, *MANAGEMENT_ROLES, action="list sessions")
        rows = await self.repo.list(
            "TrainingSession",
            filters={"user_id": target},
            order_by="-started_at",
            limit=limit,
        )
        return [self.to_view(row) for row in rows]

    async def _require(self, session_id: str, *, read_only: bool = False) -> Any:
        row = await self.repo.get("TrainingSession", session_id)
        if row is None:
            raise NotFoundError(f"session {session_id} not found")
        self.assert_same_tenant(row, resource="session")
        owner = str(field(row, "user_id", ""))
        if owner != self.user_id:
            roles = (ROLE_COACH, *MANAGEMENT_ROLES) if read_only else (ROLE_COACH, "admin")
            self.require_role(*roles, action="access another user's session")
        return row

    async def _pinned_for_row(self, row: Any) -> PinnedSnapshot:
        """Rebuild the §54 pinned snapshot for an existing session.

        `TrainingSession` has no `pinned_snapshot` column — `create` writes that
        key and the repository silently drops it — so reading it back always
        yielded `{}` and `PinnedSnapshot.model_validate({})` raised
        "4 validation errors ... Field required" on every turn. The persona could
        therefore never answer in a session that outlived the in-process runtime
        cache (i.e. any session after an API restart).

        The pinning *identity* is on the row itself (`scenario_id`,
        `scenario_version`, `persona_id`, `persona_version`), so the snapshot is
        rebuilt from those. Content is re-read from the current rows: versions are
        immutable in this model, so the same version yields the same content.
        """
        stored = field(row, "pinned_snapshot") or None
        if stored:
            return PinnedSnapshot.model_validate(stored)

        scenario = await self.repo.get("Scenario", str(field(row, "scenario_id", "")))
        persona = await self.repo.get("Persona", str(field(row, "persona_id", "")))
        if scenario is None or persona is None:
            # Content was deleted; keep the identity so the turn can still fail
            # with a domain error rather than a validation crash.
            return PinnedSnapshot(
                scenario_id=str(field(row, "scenario_id", "")),
                scenario_version=int(field(row, "scenario_version", 1) or 1),
                persona_id=str(field(row, "persona_id", "")),
                persona_version=int(field(row, "persona_version", 1) or 1),
            )
        return self.pin(scenario, persona)

    async def _runtime_state(self, session_id: str, row: Any) -> SessionRuntimeState:
        runtime = self._runtime.get(session_id)
        if runtime is not None:
            return runtime
        pinned = await self._pinned_for_row(row)
        persisted_state = field(row, "persona_state")
        persisted_director = field(row, "director_state")
        runtime = SessionRuntimeState(
            session_id=session_id,
            mode=str(field(row, "mode", "training")),
            locale=str(pinned.persona.get("locale") or "zh-TW"),
            status=str(field(row, "status", "ready")),
            turn_index=int(field(row, "turn_count", 0) or 0),
            persona_state=(
                PersonaSimulationState.model_validate(persisted_state)
                if persisted_state
                else self.initial_persona_state(pinned)
            ),
            director_state=(
                DirectorState.model_validate(persisted_director)
                if persisted_director
                else DirectorState()
            ),
            pinned=pinned,
            score_live_enabled=bool(field(row, "score_live_enabled", False)),
            voice_enabled=bool(field(row, "voice_enabled", False)),
        )
        turns = await self.repo.list(
            "TranscriptTurn",
            filters={"session_id": session_id},
            order_by="timestamp_ms",
            limit=20,
        )
        runtime.recent_turns = [
            (
                "trainee" if str(field(t, "speaker", "")) == "trainee" else "customer",
                str(field(t, "text", "")),
            )
            for t in turns
        ]
        for speaker, text in reversed(runtime.recent_turns):
            if speaker == "customer":
                runtime.last_persona_text = text
                break
        self._runtime[session_id] = runtime
        return runtime

    def _build_orchestrator(
        self, runtime: SessionRuntimeState, emitter: EventEmitter
    ) -> ConversationOrchestrator:
        if self._orchestrator_factory is not None:
            return self._orchestrator_factory(runtime, emitter)
        from app.services.factory import build_orchestrator

        return build_orchestrator(
            db=self.db,
            ctx=self.ctx,
            emitter=emitter,
            mode=runtime.mode,
            locale=runtime.locale,
            knowledge_base_ids=(
                runtime.pinned.knowledge_base_ids if runtime.pinned is not None else []
            ),
        )

    @staticmethod
    def to_view(row: Any) -> SessionView:
        return SessionView(
            session_id=str(field(row, "session_id") or field(row, "id", "")),
            tenant_id=str(field(row, "tenant_id", "")),
            workspace_id=str(field(row, "workspace_id", "")),
            user_id=str(field(row, "user_id", "")),
            scenario_id=str(field(row, "scenario_id", "")),
            scenario_version=int(field(row, "scenario_version", 1) or 1),
            persona_id=str(field(row, "persona_id", "")),
            persona_version=int(field(row, "persona_version", 1) or 1),
            mode=str(field(row, "mode", "training")),
            status=str(field(row, "status", "idle")),
            started_at=str(field(row, "started_at") or iso_now()),
            ended_at=field(row, "ended_at"),
            runtime=str(field(row, "runtime", "server")),
            voice_enabled=bool(field(row, "voice_enabled", False)),
            score_live_enabled=bool(field(row, "score_live_enabled", False)),
            turn_count=int(field(row, "turn_count", 0) or 0),
        )


_DISCLOSURE_MARKERS = ("風險", "除外", "費用", "審閱期", "不保", "以保單條款為準")


def _mentions_disclosure(text: str) -> bool:
    return any(marker in text for marker in _DISCLOSURE_MARKERS)


def _plain(value: Any) -> Any:
    """Convert ORM rows / Pydantic models / enums into JSON-safe plain data."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    dumper = getattr(value, "model_dump", None)
    if callable(dumper):
        return dumper(mode="json")
    if isinstance(value, Mapping):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_plain(item) for item in value]
    if hasattr(value, "__table__"):  # SQLAlchemy row
        return {
            column.name: _plain(getattr(value, column.name))
            for column in value.__table__.columns
        }
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _duration_ms(started: Any, ended: Any) -> int:
    from datetime import datetime

    def parse(raw: Any) -> Any:
        if raw is None:
            return None
        if hasattr(raw, "timestamp"):
            return raw
        try:
            return datetime.fromisoformat(str(raw))
        except ValueError:
            return None

    start, stop = parse(started), parse(ended)
    if start is None or stop is None:
        return 0
    return max(0, int((stop - start).total_seconds() * 1000))


# ---------------------------------------------------------------------------
# Router-facing names
#
# `app/api/v1/routers/sessions.py` and this module were written against the same
# README contract but landed on different verbs — the router says
# `create_session`, the service says `create`. Rather than rename one side and
# churn both files, the router's vocabulary is bound here explicitly. Aliases,
# not reimplementations: there is exactly one code path per operation.
#
# The four at the end had no counterpart at all and are implemented against what
# the service already exposes.
# ---------------------------------------------------------------------------


async def _session_response(self: SessionService, view: Any) -> Any:
    """Assemble the router's `SessionResponse` around a `SessionView`.

    The service returns the session row; the router's contract is the whole
    start-up bundle the client needs in one round trip — pinned scenario and
    persona, the opening persona state, the runtime policy and the socket URL.
    Building it here keeps `create()` focused on persistence.
    """
    from app.domain.request_response import (
        PersonaResponse,
        ScenarioResponse,
        SessionResponse,
    )
    from app.domain.runtime import RuntimePolicy
    from app.domain.session import TrainingSession

    scenario = await self.repo.get("Scenario", view.scenario_id)
    persona = await self.repo.get("Persona", view.persona_id)

    def _shape(model: Any, row: Any) -> Any:
        if row is None:
            return model.model_construct()
        data = {
            k: getattr(row, k)
            for k in model.model_fields
            if hasattr(row, k) and getattr(row, k) is not None
        }
        return model.model_construct(**data)

    # SessionView is this service's row projection; the response contract wants
    # the shared TrainingSession model. Same fields by design (ADR-0002), so the
    # conversion is a projection rather than a mapping.
    session_model = TrainingSession.model_validate(
        {k: v for k, v in view.model_dump().items() if k in TrainingSession.model_fields}
    )

    return SessionResponse(
        session=session_model,
        scenario=_shape(ScenarioResponse, scenario),
        persona=_shape(PersonaResponse, persona),
        persona_state=self.initial_persona_state(self.pin(scenario, persona))
        if scenario is not None and persona is not None
        else None,
        # §44 / §61 client runtime policy. Conservative by default: local model
        # cache on (it is only weights), sensitive-data cache off, cleared on
        # logout. An enterprise deployment tightens this from settings.
        runtime_policy=RuntimePolicy(
            webgpu="auto",
            allow_local_model_cache=True,
            allow_sensitive_data_cache=False,
            clear_on_logout=True,
        ),
        # The route is registered on the sessions router as `/{session_id}/ws`,
        # so the client-facing path is under the API prefix. Getting this wrong
        # surfaces as a 403 rather than a 404 — Starlette rejects an unmatched
        # WebSocket path that way — which sends you hunting for an auth bug.
        websocket_url=f"/api/v1/sessions/{view.session_id}/ws",
        resume_from_seq=0,
        # §8.4: the coach is a Training-Mode affordance. Assessment must not get
        # one, and that decision belongs here rather than in the client.
        coach_enabled=str(getattr(view, "mode", "")) .endswith("training"),
    )


async def _create_session(self: SessionService, payload: Any) -> Any:
    if isinstance(payload, CreateSessionRequest):
        return await _session_response(self, await self.create(payload))
    raw = payload.model_dump() if hasattr(payload, "model_dump") else dict(payload)
    # The router's request model carries `capability` (the browser's WebGPU probe,
    # §59) which this service does not consume, and omits `locale`, which it
    # defaults. Project onto the fields the service actually declares rather than
    # splatting: an unknown key is a validation error, not a warning.
    accepted = set(CreateSessionRequest.model_fields)
    view = await self.create(CreateSessionRequest(**{k: v for k, v in raw.items() if k in accepted}))
    return await _session_response(self, view)


async def _get_session(self: SessionService, session_id: str) -> Any:
    """GET /sessions/{id} returns the same envelope as POST /sessions.

    `SessionService.get` yields a bare `SessionView`, but the router declares
    `response_model=SessionResponse`, which also requires `scenario`, `persona`,
    `runtime_policy` and `websocket_url`. Binding `get` straight through made
    every read fail with `ResponseValidationError: 5 validation errors` -> 500,
    which the browser surfaced only as "Could not reach the AI service".
    """
    return await _session_response(self, await self.get(session_id))


async def _list_events(
    self: SessionService, session_id: str, *, since_seq: int = 0, limit: int = 200
) -> list[dict[str, Any]]:
    """Replay buffered stream events (§55 gap recovery over HTTP).

    `EventEmitterRegistry.get` is async and takes the tenant scope; calling it
    without `await` returned a coroutine, so this raised
    `AttributeError: 'coroutine' object has no attribute 'replay_since'` -> 500
    on every gap-recovery request.
    """
    emitter = await self.emitters.get(
        session_id, tenant_id=self.tenant_id, workspace_id=self.workspace_id
    )
    if emitter is None:
        return []
    events = await emitter.replay_since(since_seq)
    return events[:limit]


async def _get_evaluation(self: SessionService, session_id: str) -> Any:
    await self._require(session_id, read_only=True)      # tenant scope + existence
    return await self.repo.get_evaluation_for_session(session_id)


async def _override_evaluation(self: SessionService, session_id: str, payload: Any) -> Any:
    """§28 human override. Recorded alongside the AI score, never replacing it."""
    await self._require(session_id, read_only=True)
    data = payload.model_dump() if hasattr(payload, "model_dump") else dict(payload)
    return await self.repo.override_evaluation(
        session_id, reviewer_id=self.ctx.user_id, **data
    )


async def _request_hint(self: SessionService, session_id: str, payload: Any = None) -> Any:
    """§24 Training-Mode hint, on demand.

    Runs the coach agent with `explicit_request=True` against the live runtime
    state and publishes the insights on the session stream — the same shape the
    per-turn coach produces, so the UI needs no second path. Assessment Mode
    must never reach this (§8.4).

    Previously called `self._build_orchestrator(session_id)` — the method takes
    `(runtime, emitter)` — so every "給我提示" click 500'd.
    """
    from app.agents.coach_agent import CoachRequest, to_domain_insight

    row = await self._require(session_id, read_only=True)
    if str(field(row, "mode", "training")) == "assessment":
        raise ValidationFailedError("hints are not available in assessment mode")

    runtime = await self._runtime_state(session_id, row)
    emitter = await self.emitters.get(
        session_id, tenant_id=self.tenant_id, workspace_id=self.workspace_id
    )
    orchestrator = self._build_orchestrator(runtime, emitter)
    coach = getattr(orchestrator, "coach", None)
    if coach is None:
        raise ValidationFailedError("coaching is not available for this session")

    scenario = (runtime.pinned.scenario if runtime.pinned is not None else {}) or {}
    last_trainee = next(
        (t for s_, t in reversed(runtime.recent_turns) if s_ == "trainee"), ""
    )
    context = getattr(payload, "context", None) if payload is not None else None
    persona_state = runtime.persona_state
    state_dict = (
        persona_state.model_dump()
        if hasattr(persona_state, "model_dump")
        else (persona_state if isinstance(persona_state, dict) else {})
    )

    await emitter.agent_thinking("coach")
    output = await coach.run(
        CoachRequest(
            mode=runtime.mode,
            locale=runtime.locale,
            session_id=session_id,
            timestamp_ms=now_ms(),
            trainee_text=str(context or last_trainee or ""),
            persona_text=runtime.last_persona_text,
            persona_state=state_dict,
            director_signals=[],
            learning_objectives=list(scenario.get("learning_objectives") or []),
            required_talking_points=list(scenario.get("required_talking_points") or []),
            recent_turns=list(runtime.recent_turns),
            explicit_request=True,
        )
    )
    insights: list[dict[str, Any]] = []
    for draft in output.insights:
        insight = to_domain_insight(
            draft, session_id=session_id, timestamp_ms=now_ms(), requested=True
        )
        await self.repo.add("CoachInsight", {**insight, **self.owned_fields()})
        insights.append(insight)
        await emitter.coach_insight(insight)
    await self.repo.commit()
    return {"insights": insights, "suppressed": output.suppressed_by_mode}


SessionService.create_session = _create_session          # type: ignore[attr-defined]
SessionService.end_session = SessionService.end          # type: ignore[attr-defined]
SessionService.get_session = _get_session                 # type: ignore[attr-defined]
async def _list_sessions(
    self: SessionService,
    *,
    params: Any = None,
    user_id: str | None = None,
    scenario_id: str | None = None,
    status: Any = None,
) -> Any:
    """Paged session list for the router.

    `list_for_user` returns a bare list and takes no filters; the route's
    contract is a `Page` with scenario/status narrowing. §9.1: a caller without
    transcript-review rights is pinned to their own sessions, which
    `list_for_user` already enforces.
    """
    from app.domain.common import Page
    from app.domain.session import TrainingSession

    limit = int(getattr(params, "limit", 50) or 50)
    offset = int(getattr(params, "offset", 0) or 0)

    # Over-fetch by the offset so post-filtering still fills the page.
    views = await self.list_for_user(user_id, limit=limit + offset + 50)
    if scenario_id:
        views = [v for v in views if getattr(v, "scenario_id", None) == scenario_id]
    if status is not None:
        wanted = getattr(status, "value", status)
        views = [v for v in views if str(getattr(v, "status", "")) == str(wanted)]

    window = views[offset : offset + limit]
    items = [
        TrainingSession.model_validate(
            {k: v for k, v in view.model_dump().items() if k in TrainingSession.model_fields}
        )
        for view in window
    ]
    return Page(items=items, total=len(views), limit=limit, offset=offset)


SessionService.list_sessions = _list_sessions             # type: ignore[attr-defined]
SessionService.pause_session = SessionService.pause      # type: ignore[attr-defined]
SessionService.post_message = SessionService.handle_message  # type: ignore[attr-defined]
SessionService.resume_session = SessionService.resume    # type: ignore[attr-defined]
SessionService.list_events = _list_events                # type: ignore[attr-defined]
SessionService.get_evaluation = _get_evaluation          # type: ignore[attr-defined]
SessionService.override_evaluation = _override_evaluation  # type: ignore[attr-defined]
SessionService.request_hint = _request_hint              # type: ignore[attr-defined]


__all__ = [
    "LIVE_STATES",
    "SESSION_TRANSITIONS",
    "TERMINAL_STATES",
    "CreateSessionRequest",
    "PinnedSnapshot",
    "ReplayPayload",
    "SessionRuntimeState",
    "SessionService",
    "SessionView",
    "assert_transition",
    "can_transition",
]
