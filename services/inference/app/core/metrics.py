"""Prometheus metrics (spec §49.5: metrics, latency, token usage).

Label cardinality is kept deliberately tiny — ``model`` (bounded by the
allowlist), ``task``, ``endpoint``, ``code`` — because an unbounded label such as
a request id or a tenant id would blow up the time series count on the very
service that is supposed to be cheap to run.

Nothing here is content-derived. Token *counts* are metrics; token *values* are
not, for the reasons in :mod:`app.core.logging`.
"""

from __future__ import annotations

from typing import Final

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

#: A private registry rather than the global default, so tests can build a fresh
#: app without "Duplicated timeseries in CollectorRegistry" on the second import.
REGISTRY: Final[CollectorRegistry] = CollectorRegistry(auto_describe=True)

REQUESTS: Final[Counter] = Counter(
    "inference_requests_total",
    "Inference requests by endpoint and outcome code.",
    labelnames=("endpoint", "code"),
    registry=REGISTRY,
)

REQUEST_DURATION: Final[Histogram] = Histogram(
    "inference_request_duration_seconds",
    "End-to-end request latency, including queue wait and tokenisation.",
    labelnames=("endpoint",),
    # Tuned for the §49.1 budget: a single query embedding should land in the
    # first two buckets; a 256-chunk document batch is allowed to be slow.
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
    registry=REGISTRY,
)

MODEL_DURATION: Final[Histogram] = Histogram(
    "inference_model_duration_seconds",
    "Time inside the model runtime only (excludes queue wait and tokenisation).",
    labelnames=("model", "task"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
    registry=REGISTRY,
)

QUEUE_WAIT: Final[Histogram] = Histogram(
    "inference_queue_wait_seconds",
    "Time spent waiting for a device slot.",
    buckets=(0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 2.5, 5.0, 10.0),
    registry=REGISTRY,
)

BATCH_SIZE: Final[Histogram] = Histogram(
    "inference_batch_size",
    "Items per ONNX execution. The gap between this and the request item count "
    "is what dynamic batching is buying.",
    labelnames=("model",),
    buckets=(1, 2, 4, 8, 16, 32, 64, 128, 256),
    registry=REGISTRY,
)

TOKENS: Final[Counter] = Counter(
    "inference_tokens_total",
    "Non-padding tokens processed.",
    labelnames=("model", "task"),
    registry=REGISTRY,
)

PADDING_TOKENS: Final[Counter] = Counter(
    "inference_padding_tokens_total",
    "Padding tokens processed. Wasted work; watch the ratio against "
    "inference_tokens_total when tuning batching.",
    labelnames=("model", "task"),
    registry=REGISTRY,
)

TRUNCATED: Final[Counter] = Counter(
    "inference_truncated_inputs_total",
    "Inputs that hit the model's max sequence length and lost their tail.",
    labelnames=("model",),
    registry=REGISTRY,
)

MODELS_LOADED: Final[Gauge] = Gauge(
    "inference_models_loaded",
    "Model sessions currently resident.",
    registry=REGISTRY,
)

RESIDENT_MB: Final[Gauge] = Gauge(
    "inference_resident_megabytes",
    "Estimated resident weight bytes across loaded sessions, per the manifest.",
    registry=REGISTRY,
)

MODEL_LOADS: Final[Counter] = Counter(
    "inference_model_loads_total",
    "Model load attempts by outcome.",
    labelnames=("model", "outcome"),
    registry=REGISTRY,
)

MODEL_EVICTIONS: Final[Counter] = Counter(
    "inference_model_evictions_total",
    "Sessions released, by reason (lru | idle | shutdown).",
    labelnames=("model", "reason"),
    registry=REGISTRY,
)

IN_FLIGHT: Final[Gauge] = Gauge(
    "inference_in_flight",
    "Requests currently holding a device slot.",
    registry=REGISTRY,
)

QUEUED: Final[Gauge] = Gauge(
    "inference_queued",
    "Requests waiting for a device slot.",
    registry=REGISTRY,
)

NUMERICAL_FAILURES: Final[Counter] = Counter(
    "inference_numerical_failures_total",
    "Outputs discarded because they contained NaN or Inf. Should be zero; a "
    "non-zero value means bad weights or a broken accelerator, not a bad request.",
    labelnames=("model",),
    registry=REGISTRY,
)

READY: Final[Gauge] = Gauge(
    "inference_ready",
    "1 when every preloaded model is resident and warm, else 0.",
    registry=REGISTRY,
)


__all__ = [
    "BATCH_SIZE",
    "IN_FLIGHT",
    "MODELS_LOADED",
    "MODEL_DURATION",
    "MODEL_EVICTIONS",
    "MODEL_LOADS",
    "NUMERICAL_FAILURES",
    "PADDING_TOKENS",
    "QUEUED",
    "QUEUE_WAIT",
    "READY",
    "REGISTRY",
    "REQUESTS",
    "REQUEST_DURATION",
    "RESIDENT_MB",
    "TOKENS",
    "TRUNCATED",
]
