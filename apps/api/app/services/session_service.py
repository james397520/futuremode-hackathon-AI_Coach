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

from collections.abc import Callable, Mapping, Sequence
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.intent import ClientIntentHint
from app.agents.orchestrator import ConversationOrchestrator, TurnInput, TurnResult
from app.agents.scenario_director import DirectorState, ScenarioDirector
from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.domain import PersonaSimulationState  # assumed: re-exported from app.domain
from app.services.base import (
    MANAGEMENT_ROLES,
    ROLE_COACH,
    BaseService,
    iso_now,
    new_id,
)
from app.services.exceptions import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    StateTransitionError,
    ValidationFailedError,
)
from app.services.repository import InMemoryRepository, Repository, RepositoryPort, field
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
        persona_fields = (
            "name", "age", "occupation", "industry", "background", "language", "locale",
            "traits", "voice", "avatar_url",
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
        pinned = PinnedSnapshot.model_validate(field(row, "pinned_snapshot") or {})
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

    async def _runtime_state(self, session_id: str, row: Any) -> SessionRuntimeState:
        runtime = self._runtime.get(session_id)
        if runtime is not None:
            return runtime
        pinned = PinnedSnapshot.model_validate(field(row, "pinned_snapshot") or {})
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
