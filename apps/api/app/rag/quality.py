"""Chunk quality checks — the §11.3 "Quality Check" step before embedding.

Bad chunks are worse than missing chunks: boilerplate and page furniture pollute
retrieval, near-duplicates crowd out the one good hit, and a broken table produces a
citation that reads as nonsense in the UI. Each issue carries a severity, so the
pipeline can drop `blocking` chunks, flag `warning` ones for the Chunk Viewer (§30
Part II), and pass everything else through.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.rag.chunker import TextChunk, estimate_tokens
from app.rag.structure import is_page_furniture, is_table_well_formed


class QualityIssue(StrEnum):
    EMPTY = "empty"
    TOO_SHORT = "too_short"
    TOO_LONG = "too_long"
    BOILERPLATE = "boilerplate"
    DUPLICATE = "duplicate"
    NEAR_DUPLICATE = "near_duplicate"
    BROKEN_TABLE = "broken_table"
    LOW_INFORMATION = "low_information"
    OCR_LOW_CONFIDENCE = "ocr_low_confidence"


class Severity(StrEnum):
    BLOCKING = "blocking"
    WARNING = "warning"


SEVERITY: dict[QualityIssue, Severity] = {
    QualityIssue.EMPTY: Severity.BLOCKING,
    QualityIssue.TOO_SHORT: Severity.WARNING,
    QualityIssue.TOO_LONG: Severity.WARNING,
    QualityIssue.BOILERPLATE: Severity.BLOCKING,
    QualityIssue.DUPLICATE: Severity.BLOCKING,
    QualityIssue.NEAR_DUPLICATE: Severity.WARNING,
    QualityIssue.BROKEN_TABLE: Severity.WARNING,
    QualityIssue.LOW_INFORMATION: Severity.WARNING,
    QualityIssue.OCR_LOW_CONFIDENCE: Severity.WARNING,
}

#: Lines that are pure furniture in enterprise PDFs.
_BOILERPLATE = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"^\s*(本頁(以下)?空白|this page (is )?intentionally left blank)\s*$",
        r"^\s*(目錄|table of contents|contents)\s*$",
        r"^\s*(著作權|版權所有|all rights reserved|confidential)[^\n]{0,60}$",
        r"^\s*第\s*\d+\s*頁\s*(共\s*\d+\s*頁)?\s*$",
    )
)
_TOC_LINE = re.compile(r".{2,}\.{3,}\s*\d+\s*$")

MIN_TOKENS = 12
MIN_DISTINCT_RATIO = 0.12
MIN_OCR_CONFIDENCE = 0.55
NEAR_DUPLICATE_THRESHOLD = 0.9


class ChunkQuality(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int
    issues: list[QualityIssue] = Field(default_factory=list)
    fingerprint: str = ""
    details: dict[str, Any] = Field(default_factory=dict)

    @property
    def blocking(self) -> bool:
        return any(SEVERITY[issue] is Severity.BLOCKING for issue in self.issues)

    @property
    def ok(self) -> bool:
        return not self.issues


class QualityReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[ChunkQuality] = Field(default_factory=list)
    dropped_indexes: list[int] = Field(default_factory=list)
    flagged_indexes: list[int] = Field(default_factory=list)

    @property
    def score(self) -> float:
        """0–1 quality score shown on the document card (§29/§27 Part II)."""
        if not self.results:
            return 0.0
        good = sum(1 for r in self.results if r.ok)
        return round(good / len(self.results), 4)

    def summary(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for result in self.results:
            for issue in result.issues:
                counts[str(issue)] = counts.get(str(issue), 0) + 1
        return counts


def is_boilerplate(text: str) -> bool:
    body = text.strip()
    if not body:
        return False
    if any(pattern.match(body) for pattern in _BOILERPLATE):
        return True
    lines = [line for line in body.split("\n") if line.strip()]
    if not lines:
        return False
    if all(is_page_furniture(line) for line in lines):
        return True
    # A table of contents block: most lines are "title .... 12"
    toc_like = sum(1 for line in lines if _TOC_LINE.search(line))
    return len(lines) >= 3 and toc_like >= len(lines) * 0.6


def information_ratio(text: str) -> float:
    """Distinct-character ratio; catches repeated separators and dot leaders."""
    stripped = re.sub(r"\s+", "", text)
    if not stripped:
        return 0.0
    return len(set(stripped)) / len(stripped)


def check_chunk(
    chunk: TextChunk,
    *,
    min_tokens: int = MIN_TOKENS,
    max_tokens: int | None = None,
) -> ChunkQuality:
    issues: list[QualityIssue] = []
    details: dict[str, Any] = {}
    text = chunk.text.strip()

    if not text:
        issues.append(QualityIssue.EMPTY)
        return ChunkQuality(index=chunk.index, issues=issues, fingerprint="", details=details)

    tokens = chunk.token_count or estimate_tokens(text)
    if tokens < min_tokens and "table" not in chunk.tags and not chunk.is_parent:
        issues.append(QualityIssue.TOO_SHORT)
        details["token_count"] = tokens
    if max_tokens is not None and tokens > max_tokens:
        issues.append(QualityIssue.TOO_LONG)
        details["token_count"] = tokens

    if is_boilerplate(text):
        issues.append(QualityIssue.BOILERPLATE)

    ratio = information_ratio(text)
    if ratio < MIN_DISTINCT_RATIO:
        issues.append(QualityIssue.LOW_INFORMATION)
        details["information_ratio"] = round(ratio, 4)

    if "table" in chunk.tags:
        rows = chunk.metadata.get("table_rows")
        columns = chunk.metadata.get("table_columns")
        if isinstance(rows, int) and isinstance(columns, int):
            if rows < 2 or columns < 2:
                issues.append(QualityIssue.BROKEN_TABLE)
        elif not _looks_like_table_text(text):
            issues.append(QualityIssue.BROKEN_TABLE)

    confidence = chunk.metadata.get("min_block_confidence")
    if isinstance(confidence, (int, float)) and confidence < MIN_OCR_CONFIDENCE:
        issues.append(QualityIssue.OCR_LOW_CONFIDENCE)
        details["min_block_confidence"] = confidence

    return ChunkQuality(
        index=chunk.index, issues=issues, fingerprint=chunk.fingerprint, details=details
    )


def _looks_like_table_text(text: str) -> bool:
    rows = [line.split("|") for line in text.split("\n") if "|" in line]
    return is_table_well_formed([[cell.strip() for cell in row] for row in rows])


def check_chunks(
    chunks: Sequence[TextChunk],
    *,
    min_tokens: int = MIN_TOKENS,
    max_tokens: int | None = None,
    known_fingerprints: Sequence[str] = (),
) -> QualityReport:
    """Run every check, including cross-chunk duplicate detection.

    `known_fingerprints` lets the caller pass fingerprints already present in the
    knowledge base, so re-uploading an overlapping document does not duplicate
    content in the index (§11.2 duplicate detection).
    """
    seen: dict[str, int] = {fp: -1 for fp in known_fingerprints}
    shingle_index: list[tuple[int, set[str]]] = []
    results: list[ChunkQuality] = []

    for chunk in chunks:
        result = check_chunk(chunk, min_tokens=min_tokens, max_tokens=max_tokens)
        if result.fingerprint:
            previous = seen.get(result.fingerprint)
            if previous is not None:
                result.issues.append(QualityIssue.DUPLICATE)
                result.details["duplicate_of"] = previous
            else:
                seen[result.fingerprint] = chunk.index
        shingles = _shingles(chunk.text)
        if shingles and QualityIssue.DUPLICATE not in result.issues:
            for other_index, other in shingle_index:
                if _jaccard(shingles, other) >= NEAR_DUPLICATE_THRESHOLD:
                    result.issues.append(QualityIssue.NEAR_DUPLICATE)
                    result.details["near_duplicate_of"] = other_index
                    break
        if shingles:
            shingle_index.append((chunk.index, shingles))
        results.append(result)

    return QualityReport(
        results=results,
        dropped_indexes=[r.index for r in results if r.blocking],
        flagged_indexes=[r.index for r in results if r.issues and not r.blocking],
    )


def _shingles(text: str, size: int = 5) -> set[str]:
    body = re.sub(r"\s+", "", text)
    if len(body) < size:
        return set()
    return {body[i : i + size] for i in range(len(body) - size + 1)}


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def apply_report(
    chunks: Sequence[TextChunk], report: QualityReport
) -> tuple[list[TextChunk], list[TextChunk]]:
    """Split chunks into (indexable, rejected) according to the report."""
    dropped = set(report.dropped_indexes)
    flagged = {r.index: r for r in report.results if r.issues}
    keep: list[TextChunk] = []
    reject: list[TextChunk] = []
    for chunk in chunks:
        if chunk.index in dropped:
            reject.append(chunk)
            continue
        result = flagged.get(chunk.index)
        if result is not None:
            keep.append(
                chunk.model_copy(
                    update={
                        "tags": sorted({*chunk.tags, "quality_flagged"}),
                        "metadata": {
                            **chunk.metadata,
                            "quality_issues": [str(i) for i in result.issues],
                        },
                    }
                )
            )
        else:
            keep.append(chunk)
    return keep, reject


__all__ = [
    "MIN_OCR_CONFIDENCE",
    "MIN_TOKENS",
    "SEVERITY",
    "ChunkQuality",
    "QualityIssue",
    "QualityReport",
    "Severity",
    "apply_report",
    "check_chunk",
    "check_chunks",
    "information_ratio",
    "is_boilerplate",
]
