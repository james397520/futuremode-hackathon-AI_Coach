"""§42-§44 session lifecycle, persona state, audio and interrupt."""

from __future__ import annotations

from typing import Annotated, Any, Literal

import numpy as np
from fastapi import APIRouter, Body, Request
from pydantic import BaseModel, Field

from app.core.errors import AudioFormatInvalidError, PayloadTooLargeError
from app.core.jitter_buffer import decode_wav, resample_linear, to_mono

router = APIRouter(prefix="/sessions", tags=["sessions"])


class CreateSessionRequest(BaseModel):
    avatar_id: str
    fps: Annotated[int, Field(ge=5, le=60)] = 20
    width: Annotated[int, Field(ge=64, le=1920)] = 384
    height: Annotated[int, Field(ge=64, le=1920)] = 512
    mode: Literal["state_bank", "continuous", "prerendered_loop"] = "state_bank"


@router.post("", status_code=201)
async def create_session(request: Request, body: CreateSessionRequest) -> dict[str, Any]:
    session = request.app.state.orchestrator.create_session(
        avatar_id=body.avatar_id,
        width=body.width,
        height=body.height,
        fps=body.fps,
        mode=body.mode,
    )
    return session.snapshot()


@router.get("/{session_id}")
async def get_session(session_id: str, request: Request) -> dict[str, Any]:
    return request.app.state.orchestrator.get(session_id).snapshot()


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str, request: Request) -> None:
    await request.app.state.orchestrator.close_session(session_id)


@router.post("/{session_id}/state")
async def set_state(
    session_id: str, request: Request, body: dict[str, Any] = Body(...)
) -> dict[str, Any]:
    """§43. Called ahead of the turn's audio so the figure prepares to speak (§47)."""
    session = request.app.state.orchestrator.get(session_id)
    return await session.set_persona_state(body)


@router.post("/{session_id}/audio")
async def push_audio(session_id: str, request: Request) -> dict[str, Any]:
    """§44 prototype path: a WAV body. Production streams binary over the socket."""
    session = request.app.state.orchestrator.get(session_id)
    settings = request.app.state.settings
    raw = await request.body()
    if len(raw) > settings.max_audio_bytes:
        raise PayloadTooLargeError(f"audio is {len(raw)} bytes; max {settings.max_audio_bytes}")
    if not raw:
        raise AudioFormatInvalidError("empty audio body")

    try:
        samples, rate, channels = decode_wav(raw)
    except Exception as exc:  # noqa: BLE001 - any decode failure is a client error
        raise AudioFormatInvalidError(f"could not decode audio: {exc}") from exc

    mono = to_mono(samples, channels)
    # §16: MuseTalk's feature path is mono 16 kHz regardless of what TTS emitted.
    if rate != settings.feature_sample_rate:
        mono = resample_linear(mono, rate, settings.feature_sample_rate)
    return await session.push_audio(np.asarray(mono, dtype=np.float32))


@router.post("/{session_id}/interrupt")
async def interrupt(session_id: str, request: Request) -> dict[str, Any]:
    """§44 / §15 barge-in."""
    return await request.app.state.orchestrator.get(session_id).interrupt()
