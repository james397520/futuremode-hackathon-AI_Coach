"""``/sessions`` — Live Simulation lifecycle plus the §68 WebSocket mount.

Route shapes follow §69::

    POST /api/v1/sessions
    GET  /api/v1/sessions/{id}
    POST /api/v1/sessions/{id}/message
    POST /api/v1/sessions/{id}/end

Two transports, one state machine
---------------------------------
The WebSocket at ``/sessions/{id}/ws`` is the primary transport (§55 streaming events).
``POST /{id}/message`` is the degraded, request/response fallback for environments that
cannot hold a socket; both funnel into ``SessionService`` so the §92 state machine has a
single implementation.

Assessment mode (§8.4 / §24): ``POST /{id}/hint`` is rejected by the service with
``assessment_mode_restricted``. The router does not try to guess — the session's pinned
mode is authoritative.

Version pinning (§54): the client cannot choose ``scenario_version`` /
``persona_version``; the service resolves and pins them at creation.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, WebSocket, status
from fastapi.responses import StreamingResponse

from app.core.deps import (
    AuditDep,
    Ctx,
    Permission,
    WsCtx,
    provide_service,
    require_permission,
)
from app.core.rate_limit import rate_limit
from app.db.session import get_sessionmaker
from app.domain.audit import AuditAction
from app.domain.common import Page, PageParams
from app.domain.enums import SessionState
from app.domain.evaluation import Evaluation
from app.domain.events import StreamingEvent
from app.domain.request_response import (
    CoachHintRequest,
    EvaluationOverrideRequest,
    SessionCreateRequest,
    SessionEndRequest,
    SessionEndResponse,
    SessionMessageRequest,
    SessionMessageResponse,
    SessionResponse,
    SessionSpeakRequest,
    SessionTranscribeResponse,
    SessionTranscriptResponse,
)
from app.domain.session import CoachInsight, TrainingSession
from app.services.evaluation_service import EvaluationService
from app.services.session_service import SessionService
from app.ws.gateway import session_ws_endpoint
from app.ws.voice import AudioChunk

router = APIRouter(prefix="/sessions", tags=["sessions"])

SessionDep = Annotated[SessionService, Depends(provide_service(SessionService))]
EvaluationDep = Annotated[EvaluationService, Depends(provide_service(EvaluationService))]

CanStart = Annotated[Ctx, Depends(require_permission(Permission.SESSION_START))]
CanParticipate = Annotated[Ctx, Depends(require_permission(Permission.SESSION_PARTICIPATE))]
CanReadOwn = Annotated[Ctx, Depends(require_permission(Permission.RESULT_VIEW_OWN))]
CanReview = Annotated[Ctx, Depends(require_permission(Permission.TRANSCRIPT_REVIEW))]
CanOverride = Annotated[Ctx, Depends(require_permission(Permission.EVALUATION_OVERRIDE))]


@router.post(
    "",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a training session (§69)",
    dependencies=[Depends(rate_limit("sessions.create", per_minute=12, burst=4))],
)
async def create_session(
    payload: SessionCreateRequest,
    service: SessionDep,
    ctx: CanStart,
    audit: AuditDep,
) -> SessionResponse:
    """Pins scenario/persona versions and returns the WebSocket URL to connect to."""
    result = await service.create_session(payload)
    await audit(
        AuditAction.SESSION_START,
        f"session:{result.session.session_id}",
        detail={
            "scenario_id": result.session.scenario_id,
            "scenario_version": result.session.scenario_version,
            "persona_version": result.session.persona_version,
            "mode": result.session.mode.value,
            "runtime": result.session.runtime.value,
        },
    )
    return result


@router.get(
    "",
    response_model=Page[TrainingSession],
    summary="List sessions (own history, or the workspace with review rights)",
    dependencies=[Depends(rate_limit("sessions.read", per_minute=120))],
)
async def list_sessions(
    service: SessionDep,
    ctx: CanReadOwn,
    params: Annotated[PageParams, Depends()],
    user_id: Annotated[str | None, Query(description="Requires transcript.review")] = None,
    scenario_id: Annotated[str | None, Query()] = None,
    session_status: Annotated[SessionState | None, Query(alias="status")] = None,
) -> Page[TrainingSession]:
    """Without ``transcript.review`` the service forces ``user_id`` to the caller (§9.1)."""
    return await service.list_sessions(
        params=params, user_id=user_id, scenario_id=scenario_id, status=session_status
    )


@router.get(
    "/{session_id}",
    response_model=SessionResponse,
    summary="Read a session, its persona state and resume point (§69)",
)
async def get_session(
    session_id: str, service: SessionDep, ctx: CanReadOwn
) -> SessionResponse:
    return await service.get_session(session_id)


@router.post(
    "/{session_id}/message",
    response_model=SessionMessageResponse,
    summary="Send a trainee turn (HTTP fallback for the WebSocket, §69)",
    dependencies=[Depends(rate_limit("sessions.message", per_minute=60, burst=10, cost=2))],
)
async def post_message(
    session_id: str,
    payload: SessionMessageRequest,
    service: SessionDep,
    ctx: CanParticipate,
) -> SessionMessageResponse:
    """Runs one orchestration turn.

    Deliberately **not** audited per turn: an audit row per utterance would duplicate
    the transcript into the audit log, which §40.2 forbids. Session start and end are
    audited instead, and the transcript itself is the record of the conversation.
    """
    return await service.post_message(session_id, payload)


@router.get(
    "/stt/capabilities",
    summary="Which speech-to-text engines this deployment can offer (§22 / §71)",
)
async def stt_capabilities(ctx: CanParticipate) -> dict[str, Any]:
    """Lets the client show an on-device switch only when the machine can honour it.
    Probing is cheap (one short subprocess) and cached by TCC after the first ask."""
    from app.core.config import get_settings
    from app.ws.voice import MacSpeechStt, probe_local_tts

    settings = get_settings()
    mac = MacSpeechStt()
    probe = (
        await mac.probe("zh-TW")
        if mac.available()
        else {"available": False, "reason": "helper not built"}
    )
    # The local TTS model server is probed here too (one round trip for the
    # client, and the two switches sit side by side): 1 s cap so a stalled
    # daemon cannot hold up the page.
    local_tts = await probe_local_tts(timeout_s=1.0)
    return {
        "default": str(getattr(settings, "stt_provider", "elevenlabs")),
        "cloud": bool(
            getattr(settings, "elevenlabs_api_key", None)
            or getattr(settings, "openai_api_key", None)
        ),
        "mac": probe,
        "tts": {
            "default": str(getattr(settings, "tts_provider", "elevenlabs")),
            "local": local_tts,
        },
    }


#: Roughly 60s of Opus at the browser's default bitrate. Anything larger is not
#: an utterance, it is a file upload on the wrong endpoint.
_MAX_UTTERANCE_BYTES = 4 * 1024 * 1024
_NON_SPEECH_TAG = re.compile(r"[\[（(][^\]）)]{0,24}[\]）)]")


@router.post(
    "/{session_id}/transcribe",
    response_model=SessionTranscribeResponse,
    summary="Transcribe one spoken utterance (server-side STT, §22 / §71)",
    dependencies=[Depends(rate_limit("sessions.transcribe", per_minute=120, burst=20, cost=1))],
)
async def transcribe_utterance(
    session_id: str,
    service: SessionDep,
    ctx: CanParticipate,
    file: UploadFile = File(...),
    engine: Annotated[
        Literal["auto", "mac", "cloud"],
        Query(description="auto | mac (on-device, cloud fallback) | cloud"),
    ] = "auto",
) -> SessionTranscribeResponse:
    """The microphone never streams to a vendor from the browser. Audio comes here,
    the API holds the vendor key, and the text goes back for the client to send
    as an ordinary turn — so a mis-heard sentence can be fixed before the
    persona ever sees it.
    """
    from app.services.exceptions import ValidationFailedError
    from app.ws.voice import build_stt

    # Ownership + tenant scoping exactly as a message would be checked.
    session = await service.get(session_id)
    locale = str(getattr(session, "locale", None) or "zh-TW")

    data = await file.read(_MAX_UTTERANCE_BYTES + 1)
    await file.close()
    if not data:
        return SessionTranscribeResponse(text="", provider="none", language=locale)
    if len(data) > _MAX_UTTERANCE_BYTES:
        raise ValidationFailedError("utterance too large")

    stt = build_stt(engine)
    mime = file.content_type or "audio/webm"

    async def one() -> AsyncIterator[bytes]:
        yield data

    text = ""
    try:
        async for chunk in stt.stream(one(), language=locale, mime_type=mime):
            if chunk.is_final and chunk.text:
                text = chunk.text
    except Exception:
        # The client gets an empty string and says "didn't catch that"; the
        # vendor error is already logged by the adapter.
        text = ""
    # Vendors label non-speech in brackets — "[音樂]", "[笑聲]", "(silence)". A
    # tone or a cough must come back as *nothing*, not be sent to the persona
    # as a message, which is exactly what happened with a test signal.
    text = _NON_SPEECH_TAG.sub("", text).strip()
    return SessionTranscribeResponse(text=text, provider=stt.provider, language=locale)


@router.post(
    "/{session_id}/speak",
    summary="Synthesise one persona line as audio (cloud or local TTS over HTTP)",
    dependencies=[Depends(rate_limit("sessions.speak", per_minute=120, burst=20, cost=1))],
    response_class=StreamingResponse,
)
async def speak_line(
    session_id: str,
    payload: SessionSpeakRequest,
    service: SessionDep,
    ctx: CanParticipate,
    engine: Annotated[
        Literal["auto", "cloud", "local"],
        Query(description="auto (TTS_PROVIDER) | cloud | local (on-device model, cloud fallback)"),
    ] = "auto",
) -> StreamingResponse:
    """The voice reaches the browser over plain HTTP: one persona line in, one
    clip out, played by the client. Simpler than audio frames on the WebSocket
    and it retries cleanly. The vendor key never leaves the API.

    `engine=local` routes to the on-device model server (services/local-tts) and
    falls back to the cloud voice when it is down, so the persona never goes
    silent because a launchd agent is restarting. The `Content-Type` says which
    codec actually came back — MP3 from the cloud, MP3 (or WAV) from the model.

    The voice is the persona's (explicit `voice.voice_id`, else the gender/age
    table); the trainee's tuning sliders override only the expressiveness knobs.
    """
    from app.ws.voice import VoiceConfig, build_tts
    from app.ws.voice_catalog import resolve_voice_id

    replay = await service.replay(session_id)
    persona = dict(replay.pinned.persona or {})
    raw_voice = persona.get("voice")
    persona_voice: dict[str, Any] = raw_voice if isinstance(raw_voice, dict) else {}
    config = VoiceConfig(
        provider="elevenlabs",
        voice_id=payload.voice_id or resolve_voice_id(persona),
        language=str(persona.get("language") or "zh-TW"),
        speed=(
            payload.speed
            if payload.speed is not None
            else float(persona_voice.get("speed") or 1.0)
        ),
        stability=(
            payload.stability
            if payload.stability is not None
            else persona_voice.get("stability")
        ),
        similarity=payload.similarity,
        style=payload.style,
        emotion_style=persona_voice.get("emotion_style"),
        model_id=payload.model_id,
        gender=persona.get("gender") if isinstance(persona.get("gender"), str) else None,
    )
    tts = build_tts(engine)

    # The first chunk decides the Content-Type, so it is awaited before the
    # response starts; the rest streams. A failure here (both engines down) is a
    # clean 502 rather than an empty 200 the browser would try to decode.
    stream = tts.stream(payload.text, config=config)
    first: AudioChunk | None = None
    try:
        async for chunk in stream:
            if chunk.data or chunk.is_final:
                first = chunk
                break
    except Exception as exc:
        raise HTTPException(status_code=502, detail="speech synthesis failed") from exc
    if first is None or (not first.data and first.is_final):
        raise HTTPException(status_code=502, detail="speech synthesis produced no audio")
    media_type = first.mime_type or "audio/mpeg"

    async def body() -> AsyncIterator[bytes]:
        if first.data:
            yield first.data
        async for chunk in stream:
            if chunk.data:
                yield chunk.data

    return StreamingResponse(
        body(),
        media_type=media_type,
        headers={
            "Cache-Control": "no-store",
            "X-Voice-Id": str(config.voice_id),
            "X-Tts-Provider": str(getattr(tts, "provider", engine)),
        },
    )


@router.post(
    "/{session_id}/hint",
    response_model=CoachInsight,
    summary="Request a coach hint (rejected in assessment mode, §8.4/§24)",
    dependencies=[Depends(rate_limit("sessions.hint", per_minute=20, burst=5, cost=2))],
)
async def request_hint(
    session_id: str,
    payload: CoachHintRequest,
    service: SessionDep,
    ctx: CanParticipate,
) -> CoachInsight:
    return await service.request_hint(session_id, payload)


@router.post(
    "/{session_id}/pause",
    response_model=TrainingSession,
    summary="Pause a live session (§24)",
    dependencies=[Depends(rate_limit("sessions.control", per_minute=60))],
)
async def pause_session(
    session_id: str, service: SessionDep, ctx: CanParticipate
) -> TrainingSession:
    return await service.pause_session(session_id)


@router.post(
    "/{session_id}/resume",
    response_model=TrainingSession,
    summary="Resume a paused session (§24)",
    dependencies=[Depends(rate_limit("sessions.control", per_minute=60))],
)
async def resume_session(
    session_id: str, service: SessionDep, ctx: CanParticipate
) -> TrainingSession:
    return await service.resume_session(session_id)


@router.post(
    "/{session_id}/end",
    response_model=SessionEndResponse,
    summary="End a session and trigger evaluation (§29 / §69)",
    dependencies=[Depends(rate_limit("sessions.end", per_minute=30))],
)
async def end_session(
    session_id: str,
    payload: SessionEndRequest,
    service: SessionDep,
    ctx: CanParticipate,
    audit: AuditDep,
) -> SessionEndResponse:
    """Evaluation may be returned inline or reported as pending (§29)."""
    result = await service.end_session(session_id, payload)
    await audit(
        AuditAction.SESSION_END,
        f"session:{session_id}",
        detail={
            "turn_count": result.session.turn_count,
            "evaluation_pending": result.evaluation_pending,
            "passed": bool(result.evaluation.passed) if result.evaluation else None,
        },
    )
    return result


@router.get(
    "/{session_id}/transcript",
    response_model=SessionTranscriptResponse,
    summary="Full transcript, insights and state timeline (§25 / §30 / §31)",
    dependencies=[Depends(rate_limit("sessions.transcript", per_minute=60))],
)
async def get_transcript(
    session_id: str, service: SessionDep, ctx: CanReadOwn
) -> SessionTranscriptResponse:
    """A trainee may read their own transcript; reviewing others needs ``transcript.review``."""
    return await service.get_transcript(session_id)


@router.get(
    "/{session_id}/events",
    response_model=list[StreamingEvent],
    summary="Replay streaming events from a sequence number (§68 gap fill)",
    dependencies=[Depends(rate_limit("sessions.events", per_minute=120))],
)
async def list_events(
    session_id: str,
    service: SessionDep,
    ctx: CanReadOwn,
    since_seq: Annotated[int, Query(ge=0, description="Exclusive lower bound")] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[StreamingEvent]:
    """Used by a reconnecting client to fill the gap before resuming the socket."""
    return await service.list_events(session_id, since_seq=since_seq, limit=limit)


@router.get(
    "/{session_id}/evaluation",
    response_model=Evaluation,
    summary="Read the evaluation of a completed session (§26)",
)
async def get_evaluation(
    session_id: str, service: EvaluationDep, ctx: CanReadOwn
) -> Evaluation:
    return await service.get_evaluation(session_id)


@router.post(
    "/{session_id}/evaluation/override",
    response_model=Evaluation,
    summary="Coach override of the AI score (§28 Rubric Calibration)",
    dependencies=[Depends(rate_limit("sessions.override", per_minute=30))],
)
async def override_evaluation(
    session_id: str,
    payload: EvaluationOverrideRequest,
    service: EvaluationDep,
    ctx: CanOverride,
    audit: AuditDep,
) -> Evaluation:
    """The override is stored alongside the AI score, never replacing it (§28)."""
    evaluation = await service.override_evaluation(session_id, payload)
    await audit(
        AuditAction.EVALUATION_OVERRIDE,
        f"session:{session_id}/evaluation:{evaluation.id}",
        detail={"score": float(payload.score)},
    )
    return evaluation


# ---------------------------------------------------------------------------
# WebSocket (§55 / §68)
# ---------------------------------------------------------------------------


@router.websocket("/{session_id}/ws")
async def session_socket(websocket: WebSocket, session_id: str, ctx: WsCtx) -> None:
    """Authenticate the upgrade, then hand the socket to the gateway.

    Authentication happens here (cookie or bearer, plus an ``Origin`` allowlist check —
    browsers do not enforce same-origin for WebSockets). The gateway owns the protocol:
    it emits the §55 ``StreamingEvent`` union and consumes ``ClientCommand`` frames.

    A long-lived request transaction would pin a pooled connection for the whole
    session, so the gateway is handed the *session factory* and opens short-lived
    transactions per turn instead of a single request-scoped session.
    """
    await session_ws_endpoint(
        websocket,
        session_id,
        ctx=ctx,
        session_factory=get_sessionmaker(),
    )
