"""WebSocket layer: the §55/§68 streaming contract.

`events.EventEmitter` owns sequencing, fan-out and replay; `gateway.session_ws_endpoint`
is the socket route; `voice.VoiceSession` is the server-side STT/TTS boundary (§22/§71).
"""

from app.ws.events import EventEmitter, EventEmitterRegistry, EventType

__all__ = ["EventEmitter", "EventEmitterRegistry", "EventType"]
