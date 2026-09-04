"""WebSocket streaming event schema (spec §55 / §68).

CONTRACT WARNING
----------------
This module is the Python half of a **cross-language realtime contract**. The
``StreamingEvent`` union here must stay in *lockstep* with
``packages/shared/src/events.ts``:

* identical ``type`` discriminator strings,
* identical payload field names (snake_case on both sides),
* identical member set — neither side may emit or accept an event that the other does
  not declare (see the note at the top of ``events.ts``).

Changing one file without the other is a breaking change; do both in one commit and
keep the ordering below aligned with the TypeScript union for reviewability.

Serialisation
-------------
``runtime.fallback`` carries a field named ``from``, which is a Python keyword. It is
declared as ``from_`` with ``serialization_alias="from"`` and the model sets
``serialize_by_alias=True``. Always emit events through :func:`dump_event` /
:func:`dump_event_json` so the alias is applied.
"""

from __future__ import annotations

from typing import Annotated, Literal, TypeAlias, get_args

from pydantic import AliasChoices, ConfigDict, Field, TypeAdapter

from app.domain.common import ID, Confidence, DomainModel, Score100
from app.domain.enums import (
    AgentName,
    FallbackTarget,
    RuntimeState,
    SessionState,
    SkillKey,
    SpeechSpeaker,
)
from app.domain.evaluation import ComplianceFinding
from app.domain.knowledge import Citation
from app.domain.persona import PersonaSimulationState
from app.domain.session import CoachInsight, TranscriptTurn

# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------


class EventBase(DomainModel):
    """Fields shared by every streaming event (``interface EventBase`` in events.ts)."""

    seq: int = Field(ge=0, description="Monotonically increasing; used for gap fill / resume")
    session_id: ID
    at_ms: int = Field(ge=0)


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


class SessionStartedEvent(EventBase):
    type: Literal["session.started"] = "session.started"
    state: SessionState
    server_time: str


class SessionPausedEvent(EventBase):
    type: Literal["session.paused"] = "session.paused"


class SessionResumedEvent(EventBase):
    type: Literal["session.resumed"] = "session.resumed"


class SessionCompletedEvent(EventBase):
    type: Literal["session.completed"] = "session.completed"
    evaluation_id: ID | None = None


# ---------------------------------------------------------------------------
# Speech (§22 / §49.2)
# ---------------------------------------------------------------------------


class SpeechStartedEvent(EventBase):
    type: Literal["speech.started"] = "speech.started"
    speaker: SpeechSpeaker


class SpeechPartialEvent(EventBase):
    type: Literal["speech.partial"] = "speech.partial"
    speaker: SpeechSpeaker
    text: str


class SpeechFinalEvent(EventBase):
    type: Literal["speech.final"] = "speech.final"
    turn: TranscriptTurn


# ---------------------------------------------------------------------------
# Agents (§19 / §66)
# ---------------------------------------------------------------------------


class AgentThinkingEvent(EventBase):
    type: Literal["agent.thinking"] = "agent.thinking"
    agent: AgentName


class AgentResponsePartialEvent(EventBase):
    type: Literal["agent.response.partial"] = "agent.response.partial"
    turn_id: ID
    delta: str


class AgentResponseFinalEvent(EventBase):
    type: Literal["agent.response.final"] = "agent.response.final"
    turn: TranscriptTurn


# ---------------------------------------------------------------------------
# Persona / coach / knowledge / score / compliance
# ---------------------------------------------------------------------------


class PersonaStateUpdatedEvent(EventBase):
    type: Literal["persona.state.updated"] = "persona.state.updated"
    state: PersonaSimulationState


class CoachInsightEvent(EventBase):
    type: Literal["coach.insight"] = "coach.insight"
    insight: CoachInsight


class KnowledgeCitationEvent(EventBase):
    type: Literal["knowledge.citation"] = "knowledge.citation"
    turn_id: ID
    citations: list[Citation]


class ScoreUpdatedEvent(EventBase):
    type: Literal["score.updated"] = "score.updated"
    skill: SkillKey
    score: Score100
    confidence: Confidence


class ComplianceWarningEvent(EventBase):
    type: Literal["compliance.warning"] = "compliance.warning"
    finding: ComplianceFinding


# ---------------------------------------------------------------------------
# Transport / runtime (§62 / §94)
# ---------------------------------------------------------------------------


class RuntimeFallbackEvent(EventBase):
    """WebGPU -> WASM -> server degradation (§62). Never rendered as an error modal (§94)."""

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        serialize_by_alias=True,
        validate_assignment=True,
    )

    type: Literal["runtime.fallback"] = "runtime.fallback"
    from_: RuntimeState = Field(
        validation_alias=AliasChoices("from", "from_"),
        serialization_alias="from",
    )
    to: FallbackTarget
    reason: str


class ConnectionReconnectingEvent(EventBase):
    type: Literal["connection.reconnecting"] = "connection.reconnecting"
    attempt: int = Field(ge=1)


class SessionErrorEvent(EventBase):
    type: Literal["session.error"] = "session.error"
    code: str
    message: str
    recoverable: bool


# ---------------------------------------------------------------------------
# The union
# ---------------------------------------------------------------------------

StreamingEvent: TypeAlias = Annotated[
    SessionStartedEvent
    | SessionPausedEvent
    | SessionResumedEvent
    | SessionCompletedEvent
    | SpeechStartedEvent
    | SpeechPartialEvent
    | SpeechFinalEvent
    | AgentThinkingEvent
    | AgentResponsePartialEvent
    | AgentResponseFinalEvent
    | PersonaStateUpdatedEvent
    | CoachInsightEvent
    | KnowledgeCitationEvent
    | ScoreUpdatedEvent
    | ComplianceWarningEvent
    | RuntimeFallbackEvent
    | ConnectionReconnectingEvent
    | SessionErrorEvent,
    Field(discriminator="type"),
]

STREAMING_EVENT_ADAPTER: TypeAdapter[StreamingEvent] = TypeAdapter(StreamingEvent)

#: Union members in TypeScript declaration order.
STREAMING_EVENT_MEMBERS: tuple[type[EventBase], ...] = get_args(get_args(StreamingEvent)[0])

#: Every ``type`` literal in the union — mirrors ``StreamingEventType`` in events.ts.
#: Derived from the models themselves so it can never drift from the union above.
STREAMING_EVENT_TYPES: frozenset[str] = frozenset(
    str(member.model_fields["type"].default) for member in STREAMING_EVENT_MEMBERS
)


# ---------------------------------------------------------------------------
# Client -> server commands (same socket)
# ---------------------------------------------------------------------------


class MessageSendCommand(DomainModel):
    type: Literal["message.send"] = "message.send"
    text: str


class SessionPauseCommand(DomainModel):
    type: Literal["session.pause"] = "session.pause"


class SessionResumeCommand(DomainModel):
    type: Literal["session.resume"] = "session.resume"


class SessionEndCommand(DomainModel):
    type: Literal["session.end"] = "session.end"


class CoachRequestHintCommand(DomainModel):
    """Rejected in Assessment Mode (§8.4 / §24) by the session service."""

    type: Literal["coach.request_hint"] = "coach.request_hint"


class VoicePushToTalkCommand(DomainModel):
    type: Literal["voice.push_to_talk"] = "voice.push_to_talk"
    pressed: bool


class ClientIntentHintCommand(DomainModel):
    """Local intent classification result (§53 client runtime); server stays authoritative."""

    type: Literal["client.intent_hint"] = "client.intent_hint"
    intent: str
    confidence: Confidence


class AckCommand(DomainModel):
    type: Literal["ack"] = "ack"
    seq: int = Field(ge=0)


ClientCommand: TypeAlias = Annotated[
    MessageSendCommand
    | SessionPauseCommand
    | SessionResumeCommand
    | SessionEndCommand
    | CoachRequestHintCommand
    | VoicePushToTalkCommand
    | ClientIntentHintCommand
    | AckCommand,
    Field(discriminator="type"),
]

CLIENT_COMMAND_ADAPTER: TypeAdapter[ClientCommand] = TypeAdapter(ClientCommand)

#: Every ``type`` literal accepted from the client — mirrors ``ClientCommand`` in events.ts.
CLIENT_COMMAND_TYPES: frozenset[str] = frozenset(
    str(member.model_fields["type"].default)
    for member in get_args(get_args(ClientCommand)[0])
)


# ---------------------------------------------------------------------------
# Serialisation helpers (use these; do not call ``model_dump()`` directly)
# ---------------------------------------------------------------------------


def dump_event(event: StreamingEvent) -> dict[str, object]:
    """Serialise an event to a JSON-ready dict with aliases applied (``from``)."""
    return STREAMING_EVENT_ADAPTER.dump_python(event, mode="json", by_alias=True)


def dump_event_json(event: StreamingEvent) -> bytes:
    """Serialise an event straight to UTF-8 JSON bytes for the WebSocket frame."""
    return STREAMING_EVENT_ADAPTER.dump_json(event, by_alias=True)


def parse_event(payload: object) -> StreamingEvent:
    """Validate an inbound/replayed event payload into the union."""
    return STREAMING_EVENT_ADAPTER.validate_python(payload)


def parse_client_command(payload: object) -> ClientCommand:
    """Validate a client command frame (§68). Unknown ``type`` raises ``ValidationError``."""
    return CLIENT_COMMAND_ADAPTER.validate_python(payload)
