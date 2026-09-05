"""Frame encoding for the §37 Phase-1 WebSocket transport.

Pillow gives JPEG/WebP. Without it we fall back to a stdlib zlib PNG writer:
slower and larger, but it means the transport is never the reason a session
cannot start — the same principle as the §53 backend ladder, applied one layer
up.
"""

from __future__ import annotations

import io
import struct
import zlib
from typing import Final, Literal

import numpy as np
import structlog

log = structlog.get_logger(__name__)

Format = Literal["jpeg", "webp", "png"]

try:  # pragma: no cover - availability differs per deployment
    from PIL import Image as _PILImage

    _HAVE_PIL: Final[bool] = True
except Exception:  # pragma: no cover
    _PILImage = None  # type: ignore[assignment]
    _HAVE_PIL = False


def _png_chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def _encode_png(frame: np.ndarray) -> bytes:
    """Minimal RGB8 PNG writer — no third-party dependency."""
    height, width = frame.shape[:2]
    # Each scanline is prefixed with filter type 0 (None).
    raw = b"".join(b"\x00" + frame[y].tobytes() for y in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _png_chunk(b"IDAT", zlib.compress(raw, 6))
        + _png_chunk(b"IEND", b"")
    )


def encode_frame(frame: np.ndarray, *, fmt: Format = "jpeg", quality: int = 82) -> tuple[bytes, Format]:
    """Encode one RGB uint8 frame. Returns the bytes and the format actually used."""
    if frame.dtype != np.uint8:
        frame = np.clip(frame, 0, 255).astype(np.uint8)
    if not _HAVE_PIL or fmt == "png":
        return _encode_png(frame), "png"
    buf = io.BytesIO()
    image = _PILImage.fromarray(frame, mode="RGB")
    if fmt == "webp":
        image.save(buf, format="WEBP", quality=quality, method=1)
    else:
        # optimize/progressive are off deliberately: this runs per frame and the
        # extra passes cost more than the bytes they save at this resolution.
        image.save(buf, format="JPEG", quality=quality, subsampling=1)
        fmt = "jpeg"
    return buf.getvalue(), fmt


class FrameEncoder:
    """Stateful encoder that reports what it settled on, once."""

    def __init__(self, *, fmt: Format = "jpeg", quality: int = 82) -> None:
        self._requested: Format = fmt
        self._quality = quality
        self._effective: Format | None = None

    @property
    def effective_format(self) -> Format:
        return self._effective or ("jpeg" if _HAVE_PIL else "png")

    @property
    def pillow_available(self) -> bool:
        return _HAVE_PIL

    def encode(self, frame: np.ndarray) -> tuple[bytes, Format]:
        payload, used = encode_frame(frame, fmt=self._requested, quality=self._quality)
        if self._effective is None:
            self._effective = used
            if used != self._requested:
                log.warning(
                    "avatar.encoder.degraded",
                    requested=self._requested,
                    effective=used,
                    reason="pillow_unavailable",
                )
        return payload, used
