"""Prometheus metrics — the §77 list, verbatim.

§77 names the metrics::

    avatar_fps            avatar_first_frame_ms   avatar_render_ms
    musetalk_ms           liveportrait_ms         composite_ms
    encode_ms             av_drift_ms             frame_drop_total
    audio_buffer_ms       avatar_oom_total

Those are the exposition names produced here. ``frame_drop_total`` and
``avatar_oom_total`` are Counters: ``prometheus_client`` strips the ``_total``
suffix from the metric family and re-appends it to the sample, so the scraped
series is ``frame_drop_total`` exactly as written above.

Label cardinality is deliberately tiny — ``session`` is **not** a label. A
training session is a short-lived, per-trainee object; using it as a label would
create a new time series per trainee per day. Per-session numbers belong in the
§45 WebSocket events, which the admin panel reads live; these metrics are the
aggregate health of the runtime.

Why the import is soft
----------------------
``prometheus-client`` is a declared dependency, but §53 says an avatar fault may
never end a training session, and "the metrics library is missing" is a fault
like any other. If the import fails the module installs a no-op shim with the
same surface, ``metrics_available()`` returns ``False``, and ``/metrics``
answers 501 instead of the process refusing to boot.
"""

from __future__ import annotations

from typing import Any, Final

try:  # pragma: no cover - exercised by whichever environment lacks the wheel
    from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram
    from prometheus_client import generate_latest as _generate_latest

    _AVAILABLE = True
except ImportError:  # pragma: no cover
    _AVAILABLE = False

    class _NoopMetric:
        """Same call surface as a prometheus metric, no storage."""

        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def labels(self, *_args: Any, **_kwargs: Any) -> _NoopMetric:
            return self

        def inc(self, _amount: float = 1.0) -> None:
            pass

        def dec(self, _amount: float = 1.0) -> None:
            pass

        def set(self, _value: float) -> None:
            pass

        def observe(self, _value: float) -> None:
            pass

    class CollectorRegistry:  # type: ignore[no-redef]
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

    Counter = Gauge = Histogram = _NoopMetric  # type: ignore[assignment, misc]

    def _generate_latest(_registry: Any) -> bytes:  # type: ignore[misc]
        return b""


#: A private registry rather than the global default, so a test can build a
#: fresh app without "Duplicated timeseries in CollectorRegistry".
REGISTRY: Final[Any] = CollectorRegistry(auto_describe=True) if _AVAILABLE else CollectorRegistry()

CONTENT_TYPE: Final[str] = "text/plain; version=0.0.4; charset=utf-8"

# Millisecond buckets sized around the §17 frame budget: 40ms is one frame at
# 25fps, so anything past 40 is already a dropped-frame risk and anything past
# 320 is a whole micro-batch (§19).
_MS_BUCKETS: Final[tuple[float, ...]] = (1, 2, 5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560)

# --- §77 ------------------------------------------------------------------

AVATAR_FPS: Final[Any] = Gauge(
    "avatar_fps",
    "Frames actually delivered per second, measured over the last second.",
    labelnames=("backend",),
    registry=REGISTRY,
)

AVATAR_FIRST_FRAME_MS: Final[Any] = Histogram(
    "avatar_first_frame_ms",
    "Time from session creation to the first frame leaving the runtime (§57).",
    labelnames=("backend",),
    buckets=_MS_BUCKETS,
    registry=REGISTRY,
)

AVATAR_RENDER_MS: Final[Any] = Histogram(
    "avatar_render_ms",
    "Wall time to produce one finished frame, end to end.",
    labelnames=("backend",),
    buckets=_MS_BUCKETS,
    registry=REGISTRY,
)

MUSETALK_MS: Final[Any] = Histogram(
    "musetalk_ms",
    "Time inside the MuseTalk mouth-region inference for one frame (§19 amortised).",
    buckets=_MS_BUCKETS,
    registry=REGISTRY,
)

LIVEPORTRAIT_MS: Final[Any] = Histogram(
    "liveportrait_ms",
    "Time inside LivePortrait expression/pose inference for one frame.",
    buckets=_MS_BUCKETS,
    registry=REGISTRY,
)

COMPOSITE_MS: Final[Any] = Histogram(
    "composite_ms",
    "Time in the §22 mouth-ROI composite: mask, feather, colour match, blend.",
    buckets=_MS_BUCKETS,
    registry=REGISTRY,
)

ENCODE_MS: Final[Any] = Histogram(
    "encode_ms",
    "Time to encode one frame for transport.",
    labelnames=("format",),
    buckets=_MS_BUCKETS,
    registry=REGISTRY,
)

AV_DRIFT_MS: Final[Any] = Gauge(
    "av_drift_ms",
    "video_pts - audio_pts in milliseconds. Audio is the master clock (§17/ADR-007); "
    "a negative value means video is late and frames are being dropped.",
    registry=REGISTRY,
)

FRAME_DROP_TOTAL: Final[Any] = Counter(
    "frame_drop_total",
    "Frames dropped, by reason (late | queue_full | interrupted).",
    labelnames=("reason",),
    registry=REGISTRY,
)

AUDIO_BUFFER_MS: Final[Any] = Gauge(
    "audio_buffer_ms",
    "Milliseconds of audio currently held in the §18 jitter buffer.",
    registry=REGISTRY,
)

AVATAR_OOM_TOTAL: Final[Any] = Counter(
    "avatar_oom_total",
    "Memory-pressure events that triggered a §65 degrade step. A non-zero value "
    "is not a crash — it is the ladder doing its job — but a rising one means "
    "the chosen profile is wrong for this machine.",
    labelnames=("platform",),
    registry=REGISTRY,
)

# --- supporting series (not in §77, but needed to read §77 honestly) -------

SESSIONS_ACTIVE: Final[Any] = Gauge(
    "avatar_sessions_active",
    "Live avatar sessions.",
    registry=REGISTRY,
)

DEGRADE_TOTAL: Final[Any] = Counter(
    "avatar_degrade_total",
    "§53 fallback transitions, by the rung landed on.",
    labelnames=("level", "reason"),
    registry=REGISTRY,
)

BARGE_IN_TOTAL: Final[Any] = Counter(
    "avatar_barge_in_total",
    "§15 interruptions handled.",
    registry=REGISTRY,
)

EXPRESSION_TRANSITIONS: Final[Any] = Counter(
    "avatar_expression_transitions_total",
    "Expression changes after hysteresis (§12), by target state.",
    labelnames=("to_state",),
    registry=REGISTRY,
)

AUDIO_UNDERRUN_TOTAL: Final[Any] = Counter(
    "avatar_audio_underrun_total",
    "Jitter-buffer underruns. The buffer emits silence rather than stalling (§18).",
    registry=REGISTRY,
)


def metrics_available() -> bool:
    """False when ``prometheus_client`` is not installed and the shim is active."""
    return _AVAILABLE


def render_metrics() -> bytes:
    """Prometheus exposition text for :data:`REGISTRY`."""
    return bytes(_generate_latest(REGISTRY))


__all__ = [
    "AUDIO_BUFFER_MS",
    "AUDIO_UNDERRUN_TOTAL",
    "AVATAR_FIRST_FRAME_MS",
    "AVATAR_FPS",
    "AVATAR_OOM_TOTAL",
    "AVATAR_RENDER_MS",
    "AV_DRIFT_MS",
    "BARGE_IN_TOTAL",
    "COMPOSITE_MS",
    "CONTENT_TYPE",
    "DEGRADE_TOTAL",
    "ENCODE_MS",
    "EXPRESSION_TRANSITIONS",
    "FRAME_DROP_TOTAL",
    "LIVEPORTRAIT_MS",
    "MUSETALK_MS",
    "REGISTRY",
    "SESSIONS_ACTIVE",
    "metrics_available",
    "render_metrics",
]
