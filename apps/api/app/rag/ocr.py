"""OCR port — invoked only when text extraction was empty or low confidence (§11.3).

    Upload -> Validate -> Extract -> **OCR if needed** -> Detect Structure -> ...

Rationale for the gate: OCR is slow and lossy, so running it on a text-native PDF
would both waste worker time and *degrade* quality (ligature errors, lost table
structure). `should_ocr()` therefore decides from the extraction result: no
characters, suspiciously few characters per page, or a parser confidence below
threshold.

The engine itself is a port. `TesseractOcr` shells out to pytesseract if it is
installed in the worker image (spec §72 puts the document parser inside the AMD AUP
environment, so the binary lives there, not in the API pod); `NullOcr` is the
default so that a deployment without OCR degrades to "text-only extraction" instead
of failing ingestion.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, ConfigDict

log = structlog.get_logger(__name__)

#: A text-native page yields far more than this; below it we assume a scan.
MIN_CHARS_PER_PAGE = 80
MIN_PARSER_CONFIDENCE = 0.6


class OcrPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int
    text: str = ""
    confidence: float = 0.0


class OcrResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pages: list[OcrPage] = []
    engine: str = "none"
    language: str = ""

    @property
    def text(self) -> str:
        return "\n".join(page.text for page in self.pages)

    @property
    def mean_confidence(self) -> float:
        if not self.pages:
            return 0.0
        return sum(p.confidence for p in self.pages) / len(self.pages)


@runtime_checkable
class OcrPort(Protocol):
    engine: str

    async def recognise(
        self, content: bytes, *, languages: Sequence[str] = ("chi_tra", "eng"), dpi: int = 200
    ) -> OcrResult: ...


class NullOcr:
    """Default: no OCR available. Ingestion continues with text-only extraction."""

    engine = "none"

    async def recognise(
        self, content: bytes, *, languages: Sequence[str] = ("chi_tra", "eng"), dpi: int = 200
    ) -> OcrResult:
        log.info("ocr.skipped", reason="no engine configured", bytes=len(content))
        return OcrResult(pages=[], engine=self.engine, language="+".join(languages))


class TesseractOcr:
    """pytesseract/pdf2image backend. Optional dependency, imported lazily.

    Not declared in `pyproject.toml` by default — see the report: enabling OCR needs
    `pytesseract`, `pdf2image`, `pillow` plus the `tesseract` and `poppler` binaries,
    which belong in the worker image (AMD AUP side, §72), not in the API pod.
    """

    engine = "tesseract"

    def __init__(self, *, tesseract_cmd: str | None = None) -> None:
        self._cmd = tesseract_cmd

    async def recognise(
        self, content: bytes, *, languages: Sequence[str] = ("chi_tra", "eng"), dpi: int = 200
    ) -> OcrResult:
        import asyncio

        return await asyncio.to_thread(self._recognise_sync, content, tuple(languages), dpi)

    def _recognise_sync(
        self, content: bytes, languages: tuple[str, ...], dpi: int
    ) -> OcrResult:
        try:
            import pytesseract  # type: ignore[import-not-found]
            from pdf2image import convert_from_bytes  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - optional dependency
            log.warning("ocr.unavailable", error=repr(exc))
            return OcrResult(pages=[], engine="tesseract-missing")
        if self._cmd:
            pytesseract.pytesseract.tesseract_cmd = self._cmd
        lang = "+".join(languages)
        pages: list[OcrPage] = []
        for index, image in enumerate(convert_from_bytes(content, dpi=dpi), start=1):
            data = pytesseract.image_to_data(
                image, lang=lang, output_type=pytesseract.Output.DICT
            )
            words = [w for w in data.get("text", []) if str(w).strip()]
            confidences = [
                float(c) for c in data.get("conf", []) if str(c) not in ("-1", "", "None")
            ]
            pages.append(
                OcrPage(
                    page=index,
                    text=" ".join(words),
                    confidence=(sum(confidences) / len(confidences) / 100.0)
                    if confidences
                    else 0.0,
                )
            )
        return OcrResult(pages=pages, engine=self.engine, language=lang)


def should_ocr(
    *,
    text_chars: int,
    page_count: int,
    parser_confidence: float = 1.0,
    source_kind: str = "pdf",
) -> bool:
    """The §11.3 "OCR if needed" gate."""
    if source_kind not in ("pdf", "image", "pptx"):
        return False
    if text_chars == 0:
        return True
    if parser_confidence < MIN_PARSER_CONFIDENCE:
        return True
    pages = max(page_count, 1)
    return (text_chars / pages) < MIN_CHARS_PER_PAGE


def merge_ocr(result: OcrResult, *, existing_pages: dict[int, str] | None = None) -> dict[int, str]:
    """Per-page merge: OCR only fills pages that extraction left empty."""
    merged = dict(existing_pages or {})
    for page in result.pages:
        if not merged.get(page.page, "").strip() and page.text.strip():
            merged[page.page] = page.text
    return merged


__all__ = [
    "MIN_CHARS_PER_PAGE",
    "MIN_PARSER_CONFIDENCE",
    "NullOcr",
    "OcrPage",
    "OcrPort",
    "OcrResult",
    "TesseractOcr",
    "merge_ocr",
    "should_ocr",
]
