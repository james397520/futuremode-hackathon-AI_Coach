"""§89 — the engine is selected by measuring the host, not by reading a spec.

The published "~34 faces/sec" figure is an M-series Max/Ultra number. This
machine class measured 62.6 s/frame for the same q4 weights at batch 1, so
"the port imports" and "the port is usable" have to be separate answers.
"""

from __future__ import annotations

from app.musetalk.mlx_backend import (
    MIN_MEMORY_MB,
    REALTIME_BUDGET_FRACTION,
    MuseTalkProbe,
    probe,
)


def test_low_memory_is_rejected_without_loading_weights():
    """A cheap rejection: no point pulling 1.4 GB to prove it will not fit."""
    result = probe(fps=20, memory_mb=8192.0)
    assert result.usable is False
    assert "unified memory" in result.reason
    assert result.ms_per_frame is None, "must not have run the model"


def test_reason_names_both_the_requirement_and_the_host():
    result = probe(fps=20, memory_mb=4096.0)
    assert str(MIN_MEMORY_MB) in result.reason
    assert "4096" in result.reason


def test_available_and_usable_are_distinct():
    """Installed-but-too-slow must not be reported as 'not installed'.

    Conflating them sends an operator hunting for a missing package when the
    real answer is that the hardware cannot serve it.
    """
    result = probe(fps=20, memory_mb=8192.0)
    if result.available:
        assert result.usable is False
        assert "not installed" not in result.reason


def test_budget_leaves_room_for_the_rest_of_the_pipeline():
    """Inference alone must not consume the whole frame interval.

    VAE decode, compositing, encode and the socket all come after it, and §17's
    drift budget is only 80 ms in total.
    """
    assert 0.0 < REALTIME_BUDGET_FRACTION <= 0.5


def test_probe_never_raises_on_a_hostile_host():
    """§53: an unusable engine is a degrade, never an exception."""
    result = probe(fps=20, memory_mb=0.0)
    assert isinstance(result, MuseTalkProbe)
    assert result.usable is False
