"""`session_ws_endpoint` — the live-simulation socket (spec §55, §68, §23, §49.4).

One socket carries the whole session: `ClientCommand`s up, `StreamingEvent`s down
(packages/shared/src/events.ts).

Guarantees

* **Authenticated + authorised before accept.** The token is verified and the session
  is checked against the caller's tenant/workspace *before* `websocket.accept()`, so
  an unauthorised socket is closed with a policy code and never sees an event.
* **Resume from `seq`.** A reconnecting client sends `?after_seq=N` (or an `ack`);
  the gateway replays everything after N from the emitter's bounded buffer / Redis
  log, then joins the live stream. If the gap is larger than the buffer it says so
  with `session.error(code="replay_gap")` rather than silently skipping events.
* **A client error never kills the loop.** Every command is handled inside a
  try/except that reports `session.error` and keeps reading. Only a disconnect,
  an explicit `session.end`, or cancellation ends the loop.
* **Clean shutdown.** Reader and writer are structured as two tasks under one
  `TaskGroup`-style supervisor; whichever finishes first cancels the other, and the
  emitter subscription is always released.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import structlog

from app.services.base import iso_now
from app.ws.events import EventEmitter, EventEmitterRegistry, EventType, now_ms

log = structlog.get_logger(__name__)

#: RFC 6455 close codes we use.
CLOSE_POLICY_VIOLATION = 1008
CLOSE_INTERNAL_ERROR = 1011
CLOSE_NORMAL = 1000

HEARTBEAT_SECONDS = 20.0
#: A client that has not sent anything (not even a pong) for this long is dropped.
CLIENT_IDLE_TIMEOUT = 120.0

#: `ClientCommand['type']` values from shared.
CLIENT_COMMANDS = frozenset(
    {
        "message.send",
        "session.pause",
        "session.resume",
        "session.end",
        "coach.request_hint",
        "voice.push_to_talk",
        "client.intent_hint",
        "trainee.affect",
        "ack",
    }
)

#: Process-wide registry so the orchestrator and the socket share one emitter.
EMITTERS = EventEmitterRegistry()


class SocketAuthError(Exception):
    """Authentication/authorisation failed — the socket is closed, not accepted."""

    def __init__(self, reason: str, *, code: int = CLOSE_POLICY_VIOLATION) -> None:
        super().__init__(reason)
        self.reason = reason
        self.code = code


AuthResolver = Callable[[Any, str], Awaitable[Any]]
ServiceResolver = Callable[[Any], Awaitable[Any]]


async def session_ws_endpoint(
    websocket: Any,
    session_id: str,
    *,
    token: str | None = None,
    after_seq: int = 0,
    emitters: EventEmitterRegistry | None = None,
    authenticate: AuthResolver | None = None,
    session_service_factory: ServiceResolver | None = None,
    ctx: Any = None,
    session_factory: Any = None,
) -> None:
    """FastAPI websocket route body.

    Signature is fixed by the router contract: `session_ws_endpoint(websocket,
    session_id, ...)`. The optional callables exist so tests can inject doubles;
    production leaves them unset and the defaults resolve `app.core.security` /
    `SessionService`.
    """
    registry = emitters or EMITTERS
    service: Any = None
    try:
        # The router authenticates the upgrade through its own `WsCtx`
        # dependency (cookie + Origin allowlist) and hands the resolved context
        # in. Re-deriving it here would verify the same token twice and, more
        # importantly, would fail: the router never forwards a raw token.
        if ctx is None:
            ctx = await (authenticate or _default_authenticate)(websocket, token or "")
        service = await (session_service_factory or _default_session_service)(
            ctx, session_factory=session_factory
        )
        session = await service.get(session_id)
        _authorise(session, ctx)
    except SocketAuthError as exc:
        log.warning("ws.auth_failed", session=session_id, reason=exc.reason)
        with contextlib.suppress(Exception):
            await websocket.close(code=exc.code, reason=exc.reason[:120])
        return
    except Exception as exc:
        log.warning("ws.setup_failed", session=session_id, error=repr(exc))
        with contextlib.suppress(Exception):
            await websocket.close(code=CLOSE_POLICY_VIOLATION, reason="session unavailable")
        return

    await websocket.accept()
    emitter = await registry.get(
        session_id,
        tenant_id=str(getattr(ctx, "tenant_id", "")),
        workspace_id=str(getattr(ctx, "workspace_id", "")),
    )

    # A freshly created session sits in `connecting` until its socket arrives:
    # the transport *is* the readiness signal. Without this the client connects,
    # finds an empty replay buffer, never receives `session.started`, and leaves
    # the composer disabled behind "正在連線…" forever.
    # `mark_ready` transitions connecting/reconnecting -> ready and publishes
    # `session.started`; an already-ready session raises on the illegal
    # transition, which is not a reason to drop the socket.
    # A newly connected client must always learn the current state, not only on
    # the first transition: the event buffer lives in this process, so after a
    # reconnect (or an API restart) an already-`ready` session would replay
    # nothing and leave the composer disabled behind "正在連線…" forever.
    status = str(getattr(session, "status", "") or "")
    log.info("ws.connect_state", session=session_id, status=status, emitter=id(emitter))
    try:
        if status in ("connecting", "reconnecting"):
            # Transitions to `ready` *and* publishes `session.started`.
            await service.mark_ready(session_id)
        elif status == "ready":
            ev = await emitter.session_started("ready", iso_now())
            log.info("ws.session_started_emitted", session=session_id, seq=ev.get("seq"))
    except Exception as exc:
        log.info("ws.mark_ready_skipped", session=session_id, error=repr(exc))
    connection = _Connection(
        websocket=websocket,
        emitter=emitter,
        service=service,
        ctx=ctx,
        session_id=session_id,
    )
    try:
        await connection.run(after_seq=after_seq)
    finally:
        await connection.aclose()


class _Connection:
    """One accepted socket. Owns the reader task, the writer task and the heartbeat."""

    def __init__(
        self,
        *,
        websocket: Any,
        emitter: EventEmitter,
        service: Any,
        ctx: Any,
        session_id: str,
    ) -> None:
        self.ws = websocket
        self.emitter = emitter
        self.service = service
        self.ctx = ctx
        self.session_id = session_id
        self.closing = asyncio.Event()
        self.last_client_ms = now_ms()
        self.acked_seq = 0
        self._turn_tasks: set[asyncio.Task[Any]] = set()

    # -- lifecycle ---------------------------------------------------------
    async def run(self, *, after_seq: int = 0) -> None:
        await self._replay(after_seq)
        reader = asyncio.create_task(self._read_loop(), name=f"ws-read-{self.session_id}")
        writer = asyncio.create_task(self._write_loop(), name=f"ws-write-{self.session_id}")
        heartbeat = asyncio.create_task(
            self._heartbeat_loop(), name=f"ws-beat-{self.session_id}"
        )
        tasks = {reader, writer, heartbeat}
        try:
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in pending:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            for task in done:
                exception = task.exception()
                if exception is not None and not isinstance(exception, asyncio.CancelledError):
                    log.warning(
                        "ws.task_failed",
                        session=self.session_id,
                        task=task.get_name(),
                        error=repr(exception),
                    )
        finally:
            self.closing.set()

    async def aclose(self) -> None:
        self.closing.set()
        for task in list(self._turn_tasks):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        with contextlib.suppress(Exception):
            await self.ws.close(code=CLOSE_NORMAL)
        log.info("ws.closed", session=self.session_id)

    # -- replay ------------------------------------------------------------
    async def _replay(self, after_seq: int) -> None:
        """Catch a newly attached socket up on everything already buffered.

        `after_seq <= 0` used to return immediately, on the assumption that a
        cursor of 0 means "new client, nothing to catch up on". The opposite is
        true: readiness (`session.started`) is published when the socket is
        accepted, which is *before* `_write_loop` subscribes, so a first-time
        client missed the live push and then skipped the replay that would have
        delivered it — it received zero frames and sat at "正在連線…" forever.
        Replaying from 0 hands it the buffer, which is exactly the catch-up a
        fresh attach needs.
        """
        if after_seq < 0:
            return
        if self.emitter.has_gap(after_seq):
            await self._send(
                {
                    "type": EventType.SESSION_ERROR,
                    "seq": self.emitter.last_seq,
                    "session_id": self.session_id,
                    "at_ms": now_ms(),
                    "code": "replay_gap",
                    "message": (
                        f"events after seq {after_seq} are no longer buffered; "
                        "reload the session to resynchronise"
                    ),
                    "recoverable": True,
                }
            )
            return
        missed = await self.emitter.replay_since(after_seq)
        for event in missed:
            await self._send(event)
        log.info("ws.replayed", session=self.session_id, count=len(missed), after=after_seq)

    # -- writer ------------------------------------------------------------
    async def _write_loop(self) -> None:
        try:
            async for event in self.emitter.subscribe():
                if self.closing.is_set():
                    return
                if event.get("type") == "__close__":
                    return
                await self._send(event)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("ws.write_loop_failed", session=self.session_id, error=repr(exc))

    async def _send(self, event: Mapping[str, Any]) -> None:
        try:
            await self.ws.send_text(json.dumps(event, ensure_ascii=False, default=str))
        except Exception as exc:
            log.info("ws.send_failed", session=self.session_id, error=repr(exc))
            self.closing.set()

    # -- heartbeat ---------------------------------------------------------
    async def _heartbeat_loop(self) -> None:
        while not self.closing.is_set():
            await asyncio.sleep(HEARTBEAT_SECONDS)
            if self.closing.is_set():
                return
            if now_ms() - self.last_client_ms > CLIENT_IDLE_TIMEOUT * 1000:
                log.info("ws.idle_timeout", session=self.session_id)
                self.closing.set()
                return
            # A ping frame keeps proxies from closing the connection; the JSON
            # heartbeat also gives the client a liveness signal it can display.
            await self._send(
                {
                    "type": "connection.heartbeat",
                    "seq": self.emitter.last_seq,
                    "session_id": self.session_id,
                    "at_ms": now_ms(),
                    "acked_seq": self.acked_seq,
                }
            )

    # -- reader ------------------------------------------------------------
    async def _read_loop(self) -> None:
        while not self.closing.is_set():
            try:
                raw = await self.ws.receive_text()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.info("ws.client_disconnected", session=self.session_id, error=repr(exc))
                return
            self.last_client_ms = now_ms()
            try:
                command = json.loads(raw)
            except json.JSONDecodeError:
                await self._client_error("bad_json", "command was not valid JSON")
                continue
            if not isinstance(command, dict):
                await self._client_error("bad_command", "command must be a JSON object")
                continue
            try:
                await self._dispatch(command)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning(
                    "ws.command_failed",
                    session=self.session_id,
                    command=command.get("type"),
                    error=repr(exc),
                )
                await self._client_error(
                    _error_code(exc), _safe_message(exc), recoverable=True
                )

    async def _dispatch(self, command: Mapping[str, Any]) -> None:
        kind = str(command.get("type") or "")
        if kind not in CLIENT_COMMANDS:
            await self._client_error("unknown_command", f"unsupported command '{kind}'")
            return

        if kind == "ack":
            self.acked_seq = max(self.acked_seq, int(command.get("seq") or 0))
            return
        if kind == "message.send":
            text = str(command.get("text") or "")
            if not text.strip():
                await self._client_error("empty_message", "message text was empty")
                return
            # Run the turn as a task so the reader stays responsive: the trainee can
            # still pause or barge in while the persona is generating.
            task = asyncio.create_task(self._run_turn(text))
            self._turn_tasks.add(task)
            task.add_done_callback(self._turn_tasks.discard)
            return
        if kind == "session.pause":
            await self.service.pause(self.session_id)
            return
        if kind == "session.resume":
            await self.service.resume(self.session_id)
            return
        if kind == "session.end":
            await self.service.end(self.session_id)
            self.closing.set()
            return
        if kind == "coach.request_hint":
            await self._request_hint()
            return
        if kind == "voice.push_to_talk":
            await self._push_to_talk(bool(command.get("pressed")))
            return
        if kind == "trainee.affect":
            # Advisory, exactly like `client.intent_hint`: the browser classified
            # the trainee's own face and sent a label. It is stored for the next
            # turn and never trusted as fact — a client can say anything. No
            # image data is accepted here, and none is ever requested.
            label = str(command.get("label") or "")
            if label:
                self._trainee_affect = {
                    "label": label[:32],
                    "confidence": max(0.0, min(1.0, float(command.get("confidence") or 0.0))),
                    "at_ms": int(command.get("at_ms") or now_ms()),
                }
            return
        if kind == "client.intent_hint":
            # Advisory only (Part II §53/§55): stored for the next turn, never trusted.
            self._pending_hint = {
                "intent": str(command.get("intent") or ""),
                "confidence": float(command.get("confidence") or 0.0),
            }
            return

    _pending_hint: dict[str, Any] | None = None
    #: Latest browser-side facial-affect reading; advisory, overwritten each time.
    _trainee_affect: dict[str, Any] | None = None

    async def _run_turn(self, text: str) -> None:
        from app.agents.intent import ClientIntentHint

        hint = None
        if self._pending_hint:
            hint = ClientIntentHint(**self._pending_hint)
            self._pending_hint = None
        # The facial reading is consumed by the turn it precedes, then cleared —
        # a stale expression from three turns ago is not evidence about this one.
        face = self._trainee_affect
        self._trainee_affect = None
        try:
            await self.service.handle_message(
                self.session_id, text, client_intent_hint=hint, face_affect=face
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("ws.turn_failed", session=self.session_id, error=repr(exc), exc_info=exc)
            await self._client_error(_error_code(exc), _safe_message(exc), recoverable=True)

    async def _request_hint(self) -> None:
        """§8.4: a hint request in Assessment Mode is refused, not silently ignored."""
        session = await self.service.get(self.session_id)
        if getattr(session, "mode", "training") == "assessment":
            await self._client_error(
                "hint_not_available",
                "hints are disabled in Assessment Mode",
                recoverable=True,
            )
            return
        requester = getattr(self.service, "request_hint", None)
        if requester is None:
            await self._client_error(
                "hint_unavailable", "coaching is not available for this session"
            )
            return
        await requester(self.session_id)

    async def _push_to_talk(self, pressed: bool) -> None:
        voice = getattr(self.service, "voice", None)
        if voice is None:
            # Speech-to-text runs over HTTP (`POST /sessions/{id}/transcribe`);
            # this command is then only the floor-change signal, and answering it
            # with an error put a red "voice is not enabled" banner on every
            # single key release.
            log.debug("ws.push_to_talk.no_voice_session", session=self.session_id, pressed=pressed)
            return
        await (voice.start_listening if pressed else voice.stop_listening)(self.session_id)

    async def _client_error(
        self, code: str, message: str, *, recoverable: bool = True
    ) -> None:
        """Report an error to *this* client without polluting the session stream."""
        await self._send(
            {
                "type": EventType.SESSION_ERROR,
                "seq": self.emitter.last_seq,
                "session_id": self.session_id,
                "at_ms": now_ms(),
                "code": code,
                "message": message[:300],
                "recoverable": recoverable,
            }
        )


# ---------------------------------------------------------------------------
# defaults
# ---------------------------------------------------------------------------
async def _default_authenticate(websocket: Any, token: str) -> Any:
    """Verify the socket's bearer token and build a `RequestContext`.

    ASSUMPTION: `app.core.security` exposes `context_from_token(token)` (or
    `decode_token`) and `app.core.context.RequestContext`. Cookies are preferred over
    the query string, since a token in a URL ends up in proxy logs.
    """
    candidate = token
    if not candidate:
        cookies = getattr(websocket, "cookies", {}) or {}
        # The cookie is named by settings (`COOKIE_NAME`, default
        # `aicoach_session`) — `access_token` was a guess and never matched what
        # the login route actually sets, so every browser socket fell through to
        # "missing credentials" and closed 403.
        try:
            from app.core.config import get_settings

            cookie_name = get_settings().session_cookie_name
        except Exception:
            cookie_name = "aicoach_session"
        candidate = str(cookies.get(cookie_name) or cookies.get("access_token") or "")
    if not candidate:
        headers = getattr(websocket, "headers", {}) or {}
        authorization = str(headers.get("authorization") or "")
        if authorization.lower().startswith("bearer "):
            candidate = authorization[7:]
        else:
            candidate = str(headers.get("sec-websocket-protocol") or "")
    if not candidate:
        raise SocketAuthError("missing credentials")

    try:
        from app.core import security  # assumed: app.core.security
    except ImportError as exc:  # pragma: no cover
        raise SocketAuthError("authentication unavailable", code=CLOSE_INTERNAL_ERROR) from exc

    resolver = getattr(security, "context_from_token", None) or getattr(
        security, "decode_token", None
    )
    if resolver is None:
        raise SocketAuthError("authentication unavailable", code=CLOSE_INTERNAL_ERROR)
    try:
        result = resolver(candidate)
        ctx = await result if asyncio.iscoroutine(result) else result
    except Exception as exc:
        raise SocketAuthError("invalid credentials") from exc
    if ctx is None:
        raise SocketAuthError("invalid credentials")
    return ctx


async def _default_session_service(ctx: Any, *, session_factory: Any = None) -> Any:
    """Build a `SessionService` with its own DB session for the socket's lifetime.

    The router passes its sessionmaker so the socket does not build a second
    engine; falling back to `get_sessionmaker()` keeps direct callers working.
    """
    from app.services.session_service import SessionService

    maker = session_factory
    if maker is None:
        from app.db.session import get_sessionmaker

        maker = get_sessionmaker()
    return SessionService(maker(), ctx, emitters=EMITTERS)


def _authorise(session: Any, ctx: Any) -> None:
    """The socket may only attach to a session in the caller's own tenant/workspace."""
    tenant = str(getattr(session, "tenant_id", "") or "")
    workspace = str(getattr(session, "workspace_id", "") or "")
    user = str(getattr(session, "user_id", "") or "")
    roles = {str(role) for role in (getattr(ctx, "roles", ()) or ())}
    if tenant and tenant != str(getattr(ctx, "tenant_id", "")):
        raise SocketAuthError("session belongs to another tenant")
    if workspace and workspace != str(getattr(ctx, "workspace_id", "")):
        raise SocketAuthError("session belongs to another workspace")
    if user and user != str(getattr(ctx, "user_id", "")) and not (
        roles & {"coach", "admin", "manager", "reviewer"}
    ):
        raise SocketAuthError("not permitted to observe this session")
    if str(getattr(session, "status", "")) == "completed":
        raise SocketAuthError("session is already completed")


def _error_code(exc: Exception) -> str:
    code = getattr(exc, "code", None)
    return str(code) if code else type(exc).__name__


def _safe_message(exc: Exception) -> str:
    """Only surface messages from our own error taxonomy; never raw internals."""
    from app.services.exceptions import ServiceError

    if isinstance(exc, ServiceError):
        return exc.message
    return "the server could not process that command"


__all__ = [
    "CLIENT_COMMANDS",
    "CLOSE_POLICY_VIOLATION",
    "EMITTERS",
    "HEARTBEAT_SECONDS",
    "SocketAuthError",
    "session_ws_endpoint",
]
