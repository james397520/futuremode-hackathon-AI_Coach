"""Document structure recognition — headings, tables, section tree (spec §11.3).

The parser backends produce a flat list of `Block`s; this module turns that into
something chunkable: it recognises headings (numbering schemes, markdown, CJK chapter
markers, short unpunctuated lines), extracts pipe/tab/CSV-ish tables into real row
matrices, and builds the section tree whose paths become chunk metadata
(`section`), which is what makes a §12.5 citation able to say *where* in the document
a claim came from.

Everything here is pure and deterministic — no model, no network.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BlockKind(StrEnum):
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    TABLE = "table"
    LIST_ITEM = "list_item"
    CAPTION = "caption"
    CODE = "code"
    FOOTER = "footer"


class Block(BaseModel):
    """One structural unit of a parsed document."""

    model_config = ConfigDict(extra="forbid")

    kind: BlockKind = BlockKind.PARAGRAPH
    text: str = ""
    #: heading depth, 1 = top level; 0 for non-headings
    level: int = 0
    page: int | None = None
    order: int = 0
    #: heading trail, e.g. ["第三章 保單條款", "3.2 除外責任"]
    section_path: list[str] = Field(default_factory=list)
    #: for TABLE blocks: rows of cells (first row is treated as the header)
    rows: list[list[str]] = Field(default_factory=list)
    #: parser confidence — low values (e.g. from OCR) propagate to chunk quality
    confidence: float = 1.0
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def section(self) -> str:
        return " > ".join(self.section_path)


class SectionNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = ""
    level: int = 0
    page: int | None = None
    block_indexes: list[int] = Field(default_factory=list)
    children: list[SectionNode] = Field(default_factory=list)

    def flatten(self) -> list[SectionNode]:
        out = [self]
        for child in self.children:
            out.extend(child.flatten())
        return out


# ---------------------------------------------------------------------------
# heading recognition
# ---------------------------------------------------------------------------
_MARKDOWN_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_NUMBERED = re.compile(r"^\s*(\d+(?:\.\d+){0,4})[.)、]?\s+(\S.*)$")
_CJK_CHAPTER = re.compile(r"^\s*第\s*([0-9一二三四五六七八九十百]+)\s*([章節條項款編部])\s*[、.:：]?\s*(.*)$")
_CJK_ENUM = re.compile(r"^\s*([一二三四五六七八九十]+)\s*[、.]\s*(\S.*)$")
_ROMAN = re.compile(r"^\s*([IVXLC]+)[.)]\s+(\S.*)$")
_APPENDIX = re.compile(r"^\s*(附錄|附件|Appendix|Annex)\s*([A-Z0-9一二三四五六七八九十]*)\s*[:：、.]?\s*(.*)$",
                       re.IGNORECASE)
_LIST_ITEM = re.compile(r"^\s*(?:[-*•·‧]|\(\d+\)|\d+[.)]\s)\s*(\S.*)$")
#: A line opening an FAQ question or answer. FAQ exports and 客服規範 are routinely
#: written without a blank line between entries, so paragraph merging alone would
#: collapse an entire Q&A document into one block and destroy the pair structure that
#: `faq_aware` chunking (§11.4) depends on. Treat the marker itself as a block boundary.
_QA_MARKER = re.compile(
    r"^\s*(?:Q\d*[:：]|A\d*[:：]|問[:：]|答[:：]|Question\s*\d*[:：]|Answer\s*\d*[:：])",
    re.IGNORECASE,
)
_PAGE_FOOTER = re.compile(
    r"^\s*(?:第\s*\d+\s*頁(?:\s*/\s*共?\s*\d+\s*頁)?|page\s+\d+(?:\s*of\s*\d+)?|[-–—]?\s*\d{1,4}\s*[-–—]?)\s*$",
    re.IGNORECASE,
)
_TERMINAL_PUNCT = ("。", "．", ".", "!", "！", "?", "？", ";", "；", ",", "，", "、", ":", "：")

#: A short line with no terminal punctuation is probably a heading. Tuned for mixed
#: zh/en enterprise manuals: 40 chars covers "三、被保險人之告知義務" style headings
#: without swallowing real sentences.
MAX_IMPLICIT_HEADING_CHARS = 40


def detect_heading(line: str) -> tuple[int, str] | None:
    """Return `(level, title)` when `line` looks like a heading, else None."""
    text = line.strip()
    if not text or _PAGE_FOOTER.match(text):
        return None

    match = _MARKDOWN_HEADING.match(text)
    if match:
        return len(match.group(1)), match.group(2).strip()

    match = _CJK_CHAPTER.match(text)
    if match:
        unit_levels = {"編": 1, "部": 1, "章": 1, "節": 2, "條": 3, "項": 4, "款": 5}
        title = f"第{match.group(1)}{match.group(2)} {match.group(3)}".strip()
        return unit_levels.get(match.group(2), 2), title

    match = _APPENDIX.match(text)
    if match and len(text) <= 80:
        return 1, text

    match = _NUMBERED.match(text)
    if match and len(match.group(2)) <= 80 and not match.group(2).endswith(_TERMINAL_PUNCT):
        return min(match.group(1).count(".") + 1, 6), text

    match = _CJK_ENUM.match(text)
    if match and len(match.group(2)) <= 60:
        return 3, text

    match = _ROMAN.match(text)
    if match and len(match.group(2)) <= 80:
        return 2, text

    if (
        len(text) <= MAX_IMPLICIT_HEADING_CHARS
        and not text.endswith(_TERMINAL_PUNCT)
        and not _LIST_ITEM.match(text)
        and (text.isupper() or _looks_titleish(text))
    ):
        return 3, text
    return None


def _looks_titleish(text: str) -> bool:
    """Short, no sentence punctuation, and either CJK-dense or Title Case."""
    if any(p in text for p in ("。", "，", ".", ",")):
        return False
    cjk = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    if cjk >= 3 and cjk / max(len(text), 1) > 0.5:
        return True
    words = text.split()
    return 1 < len(words) <= 8 and all(w[:1].isupper() for w in words if w[:1].isalpha())


def is_page_furniture(line: str) -> bool:
    """Running headers/footers and bare page numbers (dropped by quality checks)."""
    return bool(_PAGE_FOOTER.match(line.strip()))


# ---------------------------------------------------------------------------
# table extraction
# ---------------------------------------------------------------------------
_PIPE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")
_SEPARATOR_ROW = re.compile(r"^\s*\|?[\s:\-|]+\|?\s*$")


def extract_pipe_table(lines: Sequence[str]) -> list[list[str]]:
    """Parse a contiguous markdown-ish pipe table into rows."""
    rows: list[list[str]] = []
    for line in lines:
        match = _PIPE_ROW.match(line)
        if not match:
            continue
        if _SEPARATOR_ROW.match(line):
            continue
        cells = [cell.strip() for cell in match.group(1).split("|")]
        rows.append(cells)
    return rows


def extract_tabular(lines: Sequence[str], *, min_columns: int = 2) -> list[list[str]]:
    """Tab/multi-space aligned table (common in PDF text extraction)."""
    rows: list[list[str]] = []
    for line in lines:
        if "\t" in line:
            cells = [c.strip() for c in line.split("\t")]
        else:
            cells = [c.strip() for c in re.split(r"\s{2,}", line.strip())]
        if len(cells) >= min_columns and any(cells):
            rows.append(cells)
    return rows


def table_to_text(rows: Sequence[Sequence[str]], *, caption: str = "") -> str:
    """Render a table as text that survives embedding reasonably well.

    Header-prefixed cells ("繳費年期: 20年") keep each row self-describing, which
    matters because a retrieved table row is often shown on its own in a citation.
    """
    if not rows:
        return caption
    header = [str(cell) for cell in rows[0]]
    lines: list[str] = []
    if caption:
        lines.append(caption)
    lines.append(" | ".join(header))
    for row in rows[1:]:
        pairs = [
            f"{header[i] if i < len(header) else f'col{i + 1}'}: {cell}"
            for i, cell in enumerate(row)
            if str(cell).strip()
        ]
        lines.append("; ".join(pairs))
    return "\n".join(lines)


def is_table_well_formed(rows: Sequence[Sequence[str]]) -> bool:
    if len(rows) < 2:
        return False
    width = len(rows[0])
    if width < 2:
        return False
    return all(abs(len(row) - width) <= 1 for row in rows[1:])


# ---------------------------------------------------------------------------
# block assembly + section tree
# ---------------------------------------------------------------------------
def blocks_from_text(
    text: str, *, page: int | None = None, start_order: int = 0, confidence: float = 1.0
) -> list[Block]:
    """Split raw text into typed blocks with heading levels and section paths."""
    blocks: list[Block] = []
    lines = text.replace("\r\n", "\n").split("\n")
    paragraph: list[str] = []
    table_buffer: list[str] = []
    path: list[str] = []
    order = start_order

    def flush_paragraph() -> None:
        nonlocal order, paragraph
        if not paragraph:
            return
        body = " ".join(line.strip() for line in paragraph).strip()
        paragraph = []
        if not body:
            return
        blocks.append(
            Block(
                kind=BlockKind.PARAGRAPH,
                text=body,
                page=page,
                order=order,
                section_path=list(path),
                confidence=confidence,
            )
        )
        order += 1

    def flush_table() -> None:
        nonlocal order, table_buffer
        if not table_buffer:
            return
        rows = extract_pipe_table(table_buffer) or extract_tabular(table_buffer)
        buffered = table_buffer
        table_buffer = []
        if is_table_well_formed(rows):
            blocks.append(
                Block(
                    kind=BlockKind.TABLE,
                    text=table_to_text(rows),
                    rows=[list(row) for row in rows],
                    page=page,
                    order=order,
                    section_path=list(path),
                    confidence=confidence,
                )
            )
            order += 1
        else:  # not really a table — treat as prose
            for line in buffered:
                paragraph.append(line)
            flush_paragraph()

    for raw_line in lines:
        line = raw_line.rstrip()
        if is_page_furniture(line):
            flush_table()
            flush_paragraph()
            blocks.append(
                Block(
                    kind=BlockKind.FOOTER,
                    text=line.strip(),
                    page=page,
                    order=order,
                    section_path=list(path),
                    confidence=confidence,
                )
            )
            order += 1
            continue
        if _PIPE_ROW.match(line) or ("\t" in line and len(line.split("\t")) >= 2):
            flush_paragraph()
            table_buffer.append(line)
            continue
        flush_table()
        if not line.strip():
            flush_paragraph()
            continue
        heading = detect_heading(line)
        if heading is not None:
            flush_paragraph()
            level, title = heading
            del path[level - 1 :]
            path.append(title)
            blocks.append(
                Block(
                    kind=BlockKind.HEADING,
                    text=title,
                    level=level,
                    page=page,
                    order=order,
                    section_path=list(path),
                    confidence=confidence,
                )
            )
            order += 1
            continue
        if _QA_MARKER.match(line):
            flush_paragraph()
            paragraph.append(line)
            continue
        item = _LIST_ITEM.match(line)
        if item is not None:
            flush_paragraph()
            blocks.append(
                Block(
                    kind=BlockKind.LIST_ITEM,
                    text=item.group(1).strip(),
                    page=page,
                    order=order,
                    section_path=list(path),
                    confidence=confidence,
                )
            )
            order += 1
            continue
        paragraph.append(line)

    flush_table()
    flush_paragraph()
    return blocks


def build_section_tree(blocks: Sequence[Block]) -> SectionNode:
    """Build the document outline. Non-heading blocks attach to the current section."""
    root = SectionNode(title="", level=0)
    stack: list[SectionNode] = [root]
    for index, block in enumerate(blocks):
        if block.kind is BlockKind.HEADING:
            node = SectionNode(title=block.text, level=block.level, page=block.page)
            while len(stack) > 1 and stack[-1].level >= block.level:
                stack.pop()
            stack[-1].children.append(node)
            stack.append(node)
            node.block_indexes.append(index)
        else:
            stack[-1].block_indexes.append(index)
    return root


def outline(tree: SectionNode) -> list[dict[str, Any]]:
    """Flat outline for the document detail page (§27 Part II Document Cards)."""
    return [
        {"title": node.title, "level": node.level, "page": node.page}
        for node in tree.flatten()
        if node.title
    ]


def iter_text(blocks: Iterable[Block]) -> str:
    return "\n".join(b.text for b in blocks if b.kind is not BlockKind.FOOTER)


__all__ = [
    "MAX_IMPLICIT_HEADING_CHARS",
    "Block",
    "BlockKind",
    "SectionNode",
    "blocks_from_text",
    "build_section_tree",
    "detect_heading",
    "extract_pipe_table",
    "extract_tabular",
    "is_page_furniture",
    "is_table_well_formed",
    "iter_text",
    "outline",
    "table_to_text",
]
