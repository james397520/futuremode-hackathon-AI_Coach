"""§39 health and §40 capabilities.

`max_recommended_fps` comes from a real benchmark of this machine, never a
constant — the whole point of §40 is that the client can size itself to the host
it actually landed on.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from app.platform.detect import benchmark_render_fps, cached_platform, choose_profile

router = APIRouter(tags=["health"])


def _engine_status(available: bool, name: str) -> str:
    return name if available else "unavailable"


@router.get("/health")
async def health(request: Request) -> dict[str, Any]:
    platform = cached_platform()
    profile = choose_profile(platform)
    orchestrator = getattr(request.app.state, "orchestrator", None)
    return {
        # "ready" means the service can serve frames, which the static backend
        # always can. Engine availability is reported separately rather than
        # folded into status, because a missing engine is a quality degrade and
        # not an outage (§53).
        "status": "ready",
        "platform": str(platform.accelerator),
        "backend": str(profile.name),
        "liveportrait": _engine_status(platform.modules.get("mlx", False), "mlx"),
        "musetalk": _engine_status(platform.modules.get("mlx", False), "mlx"),
        "encoder": str(profile.encoder),
        "sessions": len(orchestrator.sessions) if orchestrator else 0,
    }


@router.get("/capabilities")
async def capabilities(request: Request) -> dict[str, Any]:
    platform = cached_platform()
    profile = choose_profile(platform)
    bench = benchmark_render_fps(width=profile.width, height=profile.height)
    # p95 rather than the mean: §57 records p95_frame_ms because a profile that
    # only holds on average is a profile that visibly stutters.
    sustainable_fps = 1000.0 / bench.p95_ms if bench.p95_ms > 0 else float(profile.fps)
    orchestrator = getattr(request.app.state, "orchestrator", None)
    settings = request.app.state.settings
    return {
        "backend": str(profile.name),
        "accelerator": str(platform.accelerator),
        "state_bank": True,
        "continuous_liveportrait": platform.modules.get("mlx", False),
        "musetalk": platform.modules.get("mlx", False),
        "webrtc": bool(platform.modules.get("aiortc", False)) and settings.webrtc,
        "transport": "websocket_frames",
        # Headroom-derived, then capped: rendering faster than the card refreshes
        # buys nothing and costs battery.
        # 0.6 of sustainable leaves headroom for encode, socket and the rest of
        # the machine; never below 10, where motion stops reading as motion.
        "max_recommended_fps": int(min(profile.fps, max(10, sustainable_fps * 0.6))),
        "measured_render_fps": round(sustainable_fps, 1),
        "render_p50_ms": round(bench.p50_ms, 2),
        "render_p95_ms": round(bench.p95_ms, 2),
        "memory_mb": platform.total_memory_mb,
        "avatars": orchestrator.store.list_ids() if orchestrator else [],
        "modules": platform.modules,
    }
