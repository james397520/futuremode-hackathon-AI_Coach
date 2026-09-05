"""§45 control events + §37 Phase-1 binary frames on one socket.

Both travel together on purpose: a control event that arrives on a different
connection than the frames it describes can land out of order with them, and
then the caption says "speaking" over a closed mouth.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.event_bus import EventName

log = structlog.get_logger(__name__)
router = APIRouter(tags=["websocket"])


@router.websocket("/ws/sessions/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    app = websocket.app
    orchestrator = app.state.orchestrator
    try:
        session = orchestrator.get(session_id)
    except Exception:
        await websocket.close(code=4404, reason="unknown session")
        return

    await websocket.accept()
    subscription = orchestrator.bus.subscribe()
    frame_interval = 1.0 / session.fps
    dropped_run = 0

    async def pump_events() -> None:
        """Forward control events as JSON text frames."""
        try:
            while True:
                event = await subscription.queue.get()
                if event.session_id not in (session_id, "*"):
                    continue
                await websocket.send_json(
                    {"type": str(event.name), "session_id": event.session_id,
                     "at": event.at, "data": event.data}
                )
        except (WebSocketDisconnect, RuntimeError):
            pass

    events_task = asyncio.create_task(pump_events())
    await websocket.send_json(
        {"type": str(EventName.READY), "session_id": session_id,
         "at": time.time(), "data": session.snapshot()}
    )

    try:
        next_deadline = time.monotonic()
        while True:
            now = time.monotonic()
            if now < next_deadline:
                await asyncio.sleep(next_deadline - now)
            next_deadline += frame_interval

            # §17/§49: if we are more than a frame behind, skip ahead instead of
            # rendering into a backlog. Audio must not wait for video.
            lag = time.monotonic() - next_deadline
            if lag > frame_interval:
                skipped = int(lag // frame_interval)
                next_deadline += skipped * frame_interval
                session.stats.frames_dropped += skipped
                dropped_run += skipped
                if dropped_run >= session.fps:      # ~1s of sustained dropping
                    orchestrator.bus.publish(
                        EventName.FRAME_DROP,
                        session_id,
                        dropped=session.stats.frames_dropped,
                        lag_ms=round(lag * 1000, 1),
                    )
                    dropped_run = 0
                continue
            dropped_run = 0

            payload, fmt, meta = await asyncio.to_thread(session.render_frame)
            await websocket.send_bytes(payload)

            if session.maybe_end_speaking():
                orchestrator.bus.publish(
                    EventName.SPEAKING_ENDED, session_id, reason="audio_drained"
                )
    except WebSocketDisconnect:
        log.info("avatar.ws.disconnected", session_id=session_id, **session.stats.to_json())
    except Exception as exc:  # noqa: BLE001 - a socket error must not kill the service
        log.warning("avatar.ws.error", session_id=session_id, error=repr(exc))
        with contextlib.suppress(Exception):
            await websocket.close(code=1011)
    finally:
        events_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await events_task
        orchestrator.bus.unsubscribe(subscription)
