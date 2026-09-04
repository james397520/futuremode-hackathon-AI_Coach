"""Chunking — every §11.4 strategy, with parent-child and metadata inheritance.

Strategies (`ChunkStrategy` in packages/shared/src/entities.ts):

===============  ====================================================================
`heading`        split at heading boundaries; section path becomes chunk metadata
`paragraph`      pack whole paragraphs up to `chunk_size`, never mid-sentence
`fixed_token`    sliding window of `chunk_size` with `overlap` — the safe default
`semantic`       sentence-level packing that breaks where lexical cohesion drops
`table_aware`    tables are never split; each table keeps its caption + heading context
`faq_aware`      Q/A pairs stay together (FAQ exports, 客服規範)
`auto`           inspect the document and route each region to the best of the above
===============  ====================================================================

Token counting is `estimate_tokens`: CJK counts ~1 token/char, Latin ~1 token/4 chars.
That approximation is deliberate — the real tokenizer depends on the embedding model
(BGE vs text-embedding-3), and being *model-independent* keeps chunking reproducible
across the local/API embedder split (§2.1). `Embedder` implementations re-check the
true limit and truncate defensively.

Parent-child (§11.4): with `parent_child=True` each section-sized parent chunk is
emitted alongside its smaller children; children carry `parent_index`, and retrieval
can expand a child hit into its parent (§12.3 parent-document expansion).
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Sequence
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.rag.structure import Block, BlockKind

#: Mirrors `ChunkStrategy` in packages/shared/src/entities.ts
class ChunkStrategy(StrEnum):
    AUTO = "auto"
    SEMANTIC = "semantic"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    FIXED_TOKEN = "fixed_token"
    TABLE_AWARE = "table_aware"
    FAQ_AWARE = "faq_aware"


class ChunkConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    strategy: ChunkStrategy = ChunkStrategy.AUTO
    #: target tokens per chunk
    chunk_size: int = Field(default=512, ge=32, le=8192)
    #: token overlap between consecutive chunks (fixed_token / semantic)
    overlap: int = Field(default=64, ge=0)
    min_length: int = Field(default=24, ge=0)
    max_length: int = Field(default=2048, ge=64)
    parent_child: bool = False
    parent_chunk_size: int = Field(default=2048, ge=128)
    #: propagate document/section metadata onto every chunk
    metadata_inheritance: bool = True
    keep_tables_whole: bool = True

    @model_validator(mode="after")
    def _check(self) -> ChunkConfig:
        if self.overlap >= self.chunk_size:
            raise ValueError("overlap must be smaller than chunk_size")
        if self.max_length < self.chunk_size:
            raise ValueError("max_length must be >= chunk_size")
        return self


class TextChunk(BaseModel):
    """Pre-persistence chunk. `KnowledgeService` maps this onto the `Chunk` entity."""

    model_config = ConfigDict(extra="forbid")

    index: int = 0
    text: str = ""
    token_count: int = 0
    page: int | None = None
    section: str | None = None
    #: index of the parent chunk within the same list, when parent_child is on
    parent_index: int | None = None
    is_parent: bool = False
    strategy: ChunkStrategy = ChunkStrategy.FIXED_TOKEN
    metadata: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    block_orders: list[int] = Field(default_factory=list)

    @property
    def fingerprint(self) -> str:
        normalised = re.sub(r"\s+", " ", self.text).strip().lower()
        return hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:32]


_CJK = re.compile(
    "[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]"
)
_SENTENCE_SPLIT = re.compile(r"(?<=[。！？!?；;])\s*|\n+")
_WORD = re.compile(r"[A-Za-z0-9_']+")
_QUESTION_PREFIX = re.compile(r"^\s*(Q\d*[:：.、]|問\s*[:：.、]?|Question\s*\d*[:：])\s*", re.IGNORECASE)
_ANSWER_PREFIX = re.compile(r"^\s*(A\d*[:：.、]|答\s*[:：.、]?|Answer\s*\d*[:：])\s*", re.IGNORECASE)
#: An answer marker appearing *mid-block* rather than at the start of one.
#: `blocks_from_text` merges consecutive non-blank lines into a single paragraph, so an
#: FAQ export written the normal way —
#:     Q: 保費可以年繳嗎？
#:     A: 可以，年繳另有折扣。
#: — arrives as one block with the answer inline, not as a question block followed by an
#: answer block. A colon is required here (unlike `_ANSWER_PREFIX`, which is anchored and
#: can afford to be loose) so ordinary prose containing 答 is not split apart.
_INLINE_ANSWER = re.compile(r"[\s　]+(?:A\d*[:：]|答[:：]|Answer\s*\d*[:：])\s*", re.IGNORECASE)


def _split_inline_answer(question_text: str) -> tuple[str, str]:
    """Split ``"問題？ A: 答案"`` into ``("問題？", "答案")``.

    Returns the text unchanged with an empty answer when there is no inline marker.
    """
    match = _INLINE_ANSWER.search(question_text)
    if not match:
        return question_text, ""
    answer = question_text[match.end() :].strip()
    if not answer:
        return question_text, ""
    return question_text[: match.start()].strip(), answer


def estimate_tokens(text: str) -> int:
    """Model-independent token estimate (CJK ≈ 1/char, Latin ≈ 1/4 chars)."""
    if not text:
        return 0
    cjk = len(_CJK.findall(text))
    rest = len(text) - cjk
    return int(cjk + rest / 4) or 1


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_SPLIT.split(text) if p and p.strip()]
    return parts or ([text.strip()] if text.strip() else [])


def _tokens(text: str) -> list[str]:
    """Lexical tokens for the cohesion measure: Latin words + individual CJK chars."""
    latin = _WORD.findall(text.lower())
    cjk = _CJK.findall(text)
    return [*latin, *cjk]


def lexical_cohesion(left: str, right: str) -> float:
    """Jaccard overlap — the deterministic stand-in for embedding similarity.

    Semantic chunking with a real embedder would need one embedding call per sentence
    at ingest time; for enterprise SOP/FAQ material lexical cohesion picks the same
    boundaries in the overwhelming majority of cases and costs nothing, so it is the
    default. `SemanticChunker` accepts an optional similarity callback for tenants who
    want the embedding-based version.
    """
    a, b = set(_tokens(left)), set(_tokens(right))
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


class Chunker:
    """Applies a `ChunkConfig` to parsed blocks."""

    #: cohesion below this starts a new semantic chunk
    cohesion_threshold = 0.12

    def __init__(self, config: ChunkConfig | None = None) -> None:
        self.config = config or ChunkConfig()

    # -- entry point -------------------------------------------------------
    def chunk(
        self,
        blocks: Sequence[Block],
        *,
        document_metadata: dict[str, Any] | None = None,
        config: ChunkConfig | None = None,
    ) -> list[TextChunk]:
        cfg = config or self.config
        strategy = cfg.strategy
        if strategy is ChunkStrategy.AUTO:
            strategy = self.detect_strategy(blocks)

        handlers = {
            ChunkStrategy.HEADING: self._heading,
            ChunkStrategy.PARAGRAPH: self._paragraph,
            ChunkStrategy.FIXED_TOKEN: self._fixed_token,
            ChunkStrategy.SEMANTIC: self._semantic,
            ChunkStrategy.TABLE_AWARE: self._table_aware,
            ChunkStrategy.FAQ_AWARE: self._faq_aware,
        }
        chunks = handlers[strategy](list(blocks), cfg)
        chunks = [c.model_copy(update={"strategy": strategy}) for c in chunks]
        chunks = self._enforce_bounds(chunks, cfg)
        if cfg.parent_child:
            chunks = self._add_parents(chunks, cfg)
        if cfg.metadata_inheritance:
            chunks = self._inherit_metadata(chunks, document_metadata or {})
        return self._reindex(chunks)

    # -- strategy selection ------------------------------------------------
    def detect_strategy(self, blocks: Sequence[Block]) -> ChunkStrategy:
        """`auto`: pick from the document's own shape (§11.4)."""
        if not blocks:
            return ChunkStrategy.FIXED_TOKEN
        tables = sum(1 for b in blocks if b.kind is BlockKind.TABLE)
        headings = sum(1 for b in blocks if b.kind is BlockKind.HEADING)
        faq_pairs = self._count_faq_pairs(blocks)
        total = len(blocks)
        if faq_pairs >= 3 and faq_pairs * 2 >= total * 0.4:
            return ChunkStrategy.FAQ_AWARE
        if tables and tables >= total * 0.25:
            return ChunkStrategy.TABLE_AWARE
        if headings >= 3 and headings >= total * 0.08:
            return ChunkStrategy.HEADING
        if total >= 8:
            return ChunkStrategy.SEMANTIC
        return ChunkStrategy.PARAGRAPH

    @staticmethod
    def _count_faq_pairs(blocks: Sequence[Block]) -> int:
        count = 0
        for index, block in enumerate(blocks):
            if not (
                _QUESTION_PREFIX.match(block.text) or block.text.rstrip().endswith(("?", "？"))
            ):
                continue
            # A Q/A pair written on consecutive lines arrives as a single merged block,
            # so the answer is inline and there is no following block to inspect. Without
            # this branch an all-FAQ document counts (N - 1) pairs at best and `auto`
            # never reaches its FAQ_AWARE threshold.
            if _split_inline_answer(block.text)[1]:
                count += 1
                continue
            if index + 1 < len(blocks):
                nxt = blocks[index + 1]
                if _ANSWER_PREFIX.match(nxt.text) or nxt.kind is BlockKind.PARAGRAPH:
                    count += 1
        return count

    # -- strategies --------------------------------------------------------
    def _heading(self, blocks: list[Block], cfg: ChunkConfig) -> list[TextChunk]:
        groups: list[list[Block]] = []
        current: list[Block] = []
        for block in blocks:
            if block.kind is BlockKind.HEADING and current:
                groups.append(current)
                current = [block]
            else:
                current.append(block)
        if current:
            groups.append(current)

        chunks: list[TextChunk] = []
        for group in groups:
            if cfg.keep_tables_whole and any(b.kind is BlockKind.TABLE for b in group):
                chunks.extend(self._split_tables_out(group, cfg))
                continue
            text = self._join(group)
            if estimate_tokens(text) <= cfg.chunk_size:
                chunks.append(self._make(group, text, cfg))
            else:
                chunks.extend(self._pack_sentences(group, cfg))
        return chunks

    def _paragraph(self, blocks: list[Block], cfg: ChunkConfig) -> list[TextChunk]:
        chunks: list[TextChunk] = []
        buffer: list[Block] = []
        tokens = 0
        for block in blocks:
            if block.kind is BlockKind.FOOTER:
                continue
            if block.kind is BlockKind.TABLE and cfg.keep_tables_whole:
                if buffer:
                    chunks.append(self._make(buffer, self._join(buffer), cfg))
                    buffer, tokens = [], 0
                chunks.append(self._make([block], block.text, cfg, tags=["table"]))
                continue
            block_tokens = estimate_tokens(block.text)
            if buffer and tokens + block_tokens > cfg.chunk_size:
                chunks.append(self._make(buffer, self._join(buffer), cfg))
                buffer, tokens = [], 0
            buffer.append(block)
            tokens += block_tokens
        if buffer:
            chunks.append(self._make(buffer, self._join(buffer), cfg))
        return chunks

    def _fixed_token(self, blocks: list[Block], cfg: ChunkConfig) -> list[TextChunk]:
        """Sliding window with overlap, kept aligned to sentence boundaries."""
        chunks: list[TextChunk] = []
        for block in blocks:
            if block.kind is BlockKind.FOOTER:
                continue
            if block.kind is BlockKind.TABLE and cfg.keep_tables_whole:
                chunks.append(self._make([block], block.text, cfg, tags=["table"]))
                continue
            sentences = split_sentences(block.text)
            window: list[str] = []
            tokens = 0
            for sentence in sentences:
                sentence_tokens = estimate_tokens(sentence)
                if window and tokens + sentence_tokens > cfg.chunk_size:
                    chunks.append(self._make([block], " ".join(window), cfg))
                    window, tokens = self._carry_overlap(window, cfg.overlap)
                window.append(sentence)
                tokens += sentence_tokens
            if window:
                chunks.append(self._make([block], " ".join(window), cfg))
        return chunks

    def _semantic(self, blocks: list[Block], cfg: ChunkConfig) -> list[TextChunk]:
        chunks: list[TextChunk] = []
        for group in self._section_groups(blocks):
            if cfg.keep_tables_whole and any(b.kind is BlockKind.TABLE for b in group):
                chunks.extend(self._split_tables_out(group, cfg))
                continue
            chunks.extend(self._pack_sentences(group, cfg))
        return chunks

    def _pack_sentences(self, group: list[Block], cfg: ChunkConfig) -> list[TextChunk]:
        sentences = [s for block in group for s in split_sentences(block.text)]
        chunks: list[TextChunk] = []
        window: list[str] = []
        tokens = 0
        for sentence in sentences:
            sentence_tokens = estimate_tokens(sentence)
            too_big = window and tokens + sentence_tokens > cfg.chunk_size
            drop = (
                bool(window)
                and tokens >= max(cfg.min_length, cfg.chunk_size // 3)
                and lexical_cohesion(window[-1], sentence) < self.cohesion_threshold
            )
            if too_big or drop:
                chunks.append(self._make(group, " ".join(window), cfg))
                window, tokens = self._carry_overlap(window, cfg.overlap)
            window.append(sentence)
            tokens += sentence_tokens
        if window:
            chunks.append(self._make(group, " ".join(window), cfg))
        return chunks

    def _table_aware(self, blocks: list[Block], cfg: ChunkConfig) -> list[TextChunk]:
        chunks: list[TextChunk] = []
        prose: list[Block] = []
        for index, block in enumerate(blocks):
            if block.kind is BlockKind.TABLE:
                if prose:
                    chunks.extend(self._paragraph(prose, cfg))
                    prose = []
                caption = self._nearby_caption(blocks, index)
                text = block.text if not caption else f"{caption}\n{block.text}"
                chunks.append(
                    self._make(
                        [block],
                        text,
                        cfg,
                        tags=["table"],
                        extra_metadata={
                            "table_rows": len(block.rows),
                            "table_columns": len(block.rows[0]) if block.rows else 0,
                            "caption": caption,
                        },
                    )
                )
            elif block.kind is not BlockKind.FOOTER:
                prose.append(block)
        if prose:
            chunks.extend(self._paragraph(prose, cfg))
        return chunks

    def _faq_aware(self, blocks: list[Block], cfg: ChunkConfig) -> list[TextChunk]:
        chunks: list[TextChunk] = []
        index = 0
        pending: list[Block] = []
        while index < len(blocks):
            block = blocks[index]
            is_question = bool(_QUESTION_PREFIX.match(block.text)) or block.text.rstrip().endswith(
                ("?", "？")
            )
            if is_question:
                if pending:
                    chunks.extend(self._paragraph(pending, cfg))
                    pending = []
                answer_blocks: list[Block] = []
                cursor = index + 1
                while cursor < len(blocks):
                    candidate = blocks[cursor]
                    candidate_is_question = bool(
                        _QUESTION_PREFIX.match(candidate.text)
                    ) or candidate.text.rstrip().endswith(("?", "？"))
                    if candidate_is_question or candidate.kind is BlockKind.HEADING:
                        break
                    answer_blocks.append(candidate)
                    cursor += 1
                question, inline_answer = _split_inline_answer(
                    _QUESTION_PREFIX.sub("", block.text).strip()
                )
                answer = " ".join(
                    part
                    for part in (
                        inline_answer,
                        *(_ANSWER_PREFIX.sub("", b.text).strip() for b in answer_blocks),
                    )
                    if part
                ).strip()
                chunks.append(
                    self._make(
                        [block, *answer_blocks],
                        f"Q: {question}\nA: {answer}",
                        cfg,
                        tags=["faq"],
                        extra_metadata={"question": question},
                    )
                )
                index = cursor
                continue
            if block.kind is not BlockKind.FOOTER:
                pending.append(block)
            index += 1
        if pending:
            chunks.extend(self._paragraph(pending, cfg))
        return chunks

    # -- shared helpers ----------------------------------------------------
    @staticmethod
    def _section_groups(blocks: Sequence[Block]) -> list[list[Block]]:
        groups: list[list[Block]] = []
        current: list[Block] = []
        current_section: str | None = None
        for block in blocks:
            if block.kind is BlockKind.FOOTER:
                continue
            if current and block.section != current_section:
                groups.append(current)
                current = []
            current_section = block.section
            current.append(block)
        if current:
            groups.append(current)
        return groups

    def _split_tables_out(self, group: list[Block], cfg: ChunkConfig) -> list[TextChunk]:
        chunks: list[TextChunk] = []
        prose = [b for b in group if b.kind not in (BlockKind.TABLE, BlockKind.FOOTER)]
        if prose:
            chunks.extend(self._pack_sentences(prose, cfg))
        for block in group:
            if block.kind is BlockKind.TABLE:
                chunks.append(self._make([block], block.text, cfg, tags=["table"]))
        return chunks

    @staticmethod
    def _nearby_caption(blocks: Sequence[Block], index: int) -> str:
        for offset in (-1, 1):
            neighbour = index + offset
            if 0 <= neighbour < len(blocks):
                block = blocks[neighbour]
                if block.kind in (BlockKind.CAPTION, BlockKind.HEADING):
                    return block.text
        return ""

    @staticmethod
    def _carry_overlap(window: Sequence[str], overlap: int) -> tuple[list[str], int]:
        """Keep trailing sentences worth ~`overlap` tokens as the next window's head."""
        if overlap <= 0:
            return [], 0
        carried: list[str] = []
        tokens = 0
        for sentence in reversed(window):
            sentence_tokens = estimate_tokens(sentence)
            if tokens + sentence_tokens > overlap and carried:
                break
            carried.insert(0, sentence)
            tokens += sentence_tokens
        return carried, tokens

    @staticmethod
    def _join(blocks: Sequence[Block]) -> str:
        parts: list[str] = []
        for block in blocks:
            if block.kind is BlockKind.FOOTER:
                continue
            if block.kind is BlockKind.LIST_ITEM:
                parts.append(f"- {block.text}")
            else:
                parts.append(block.text)
        return "\n".join(p for p in parts if p.strip())

    def _make(
        self,
        blocks: Sequence[Block],
        text: str,
        cfg: ChunkConfig,
        *,
        tags: Sequence[str] = (),
        extra_metadata: dict[str, Any] | None = None,
    ) -> TextChunk:
        body = text.strip()
        first = blocks[0] if blocks else None
        pages = sorted({b.page for b in blocks if b.page is not None})
        metadata: dict[str, Any] = {
            "section_path": list(first.section_path) if first is not None else [],
            "block_kinds": sorted({str(b.kind) for b in blocks}),
        }
        if pages:
            metadata["pages"] = pages
        if any(b.confidence < 1.0 for b in blocks):
            metadata["min_block_confidence"] = min(b.confidence for b in blocks)
        metadata.update(extra_metadata or {})
        return TextChunk(
            text=body,
            token_count=estimate_tokens(body),
            page=pages[0] if pages else None,
            section=(first.section or None) if first is not None else None,
            metadata=metadata,
            tags=list(tags),
            block_orders=[b.order for b in blocks],
        )

    def _enforce_bounds(self, chunks: Sequence[TextChunk], cfg: ChunkConfig) -> list[TextChunk]:
        """Drop under-length fragments (merging them backwards) and hard-split overruns."""
        out: list[TextChunk] = []
        for chunk in chunks:
            if not chunk.text.strip():
                continue
            if chunk.token_count > cfg.max_length:
                out.extend(self._hard_split(chunk, cfg))
                continue
            if (
                chunk.token_count < cfg.min_length
                and out
                and "table" not in chunk.tags
                and "table" not in out[-1].tags
                and out[-1].token_count + chunk.token_count <= cfg.max_length
            ):
                previous = out.pop()
                merged_text = f"{previous.text}\n{chunk.text}".strip()
                out.append(
                    previous.model_copy(
                        update={
                            "text": merged_text,
                            "token_count": estimate_tokens(merged_text),
                            "block_orders": [*previous.block_orders, *chunk.block_orders],
                        }
                    )
                )
                continue
            out.append(chunk)
        return out

    @staticmethod
    def _hard_split(chunk: TextChunk, cfg: ChunkConfig) -> list[TextChunk]:
        sentences = split_sentences(chunk.text) or [chunk.text]
        pieces: list[TextChunk] = []
        window: list[str] = []
        tokens = 0
        for sentence in sentences:
            sentence_tokens = estimate_tokens(sentence)
            if window and tokens + sentence_tokens > cfg.chunk_size:
                text = " ".join(window)
                pieces.append(
                    chunk.model_copy(
                        update={"text": text, "token_count": estimate_tokens(text)}
                    )
                )
                window, tokens = [], 0
            window.append(sentence)
            tokens += sentence_tokens
        if window:
            text = " ".join(window)
            pieces.append(
                chunk.model_copy(update={"text": text, "token_count": estimate_tokens(text)})
            )
        return pieces


    # -- parent-child ------------------------------------------------------
    def _add_parents(self, chunks: Sequence[TextChunk], cfg: ChunkConfig) -> list[TextChunk]:
        """Emit section-sized parents before their children (§11.4 parent-child).

        Children keep their own text (precision at retrieval time); the parent holds
        the surrounding context that §12.3 parent-document expansion returns to the
        LLM. Parents are marked `is_parent=True` and are excluded from vector search
        by the pipeline unless the tenant opts into indexing them too.
        """
        result: list[TextChunk] = []
        group: list[TextChunk] = []
        current_section: str | None = None

        def flush() -> None:
            nonlocal group
            if not group:
                return
            if len(group) == 1:
                result.extend(group)
                group = []
                return
            parent_text = "\n".join(c.text for c in group)
            if estimate_tokens(parent_text) > cfg.parent_chunk_size:
                # too big to be a useful parent: keep children only
                result.extend(group)
                group = []
                return
            parent_position = len(result)
            result.append(
                TextChunk(
                    text=parent_text,
                    token_count=estimate_tokens(parent_text),
                    page=group[0].page,
                    section=group[0].section,
                    is_parent=True,
                    strategy=group[0].strategy,
                    metadata={**group[0].metadata, "child_count": len(group)},
                    tags=["parent"],
                    block_orders=[o for c in group for o in c.block_orders],
                )
            )
            for child in group:
                result.append(child.model_copy(update={"parent_index": parent_position}))
            group = []

        for chunk in chunks:
            if chunk.section != current_section:
                flush()
                current_section = chunk.section
            group.append(chunk)
        flush()
        return result

    # -- metadata ----------------------------------------------------------
    @staticmethod
    def _inherit_metadata(
        chunks: Sequence[TextChunk], document_metadata: dict[str, Any]
    ) -> list[TextChunk]:
        """Document-level metadata flows down; chunk-level keys always win."""
        inheritable = {
            key: value
            for key, value in document_metadata.items()
            if isinstance(value, (str, int, float, bool))
        }
        out: list[TextChunk] = []
        for chunk in chunks:
            merged = {**inheritable, **chunk.metadata}
            out.append(chunk.model_copy(update={"metadata": merged}))
        return out

    @staticmethod
    def _reindex(chunks: Sequence[TextChunk]) -> list[TextChunk]:
        """Assign final indexes.

        `_add_parents` already records `parent_index` as the position in the final
        list (nothing reorders chunks after it), so only `index` needs stamping.
        """
        return [
            chunk.model_copy(update={"index": position})
            for position, chunk in enumerate(chunks)
        ]


def chunk_document(
    blocks: Sequence[Block],
    *,
    config: ChunkConfig | None = None,
    document_metadata: dict[str, Any] | None = None,
) -> list[TextChunk]:
    """Convenience wrapper used by the ingest pipeline and the chunk editor."""
    return Chunker(config).chunk(blocks, document_metadata=document_metadata, config=config)


def split_chunk(chunk: TextChunk, at_char: int) -> tuple[TextChunk, TextChunk]:
    """§11.5 Chunk Editor — split. Returns two chunks; the caller re-embeds both."""
    if not 0 < at_char < len(chunk.text):
        raise ValueError("split point must be inside the chunk text")
    head, tail = chunk.text[:at_char].strip(), chunk.text[at_char:].strip()
    if not head or not tail:
        raise ValueError("split would produce an empty chunk")
    return (
        chunk.model_copy(update={"text": head, "token_count": estimate_tokens(head)}),
        chunk.model_copy(
            update={"text": tail, "token_count": estimate_tokens(tail), "index": chunk.index + 1}
        ),
    )


def merge_chunks(chunks: Sequence[TextChunk]) -> TextChunk:
    """§11.5 Chunk Editor — merge. Metadata of the first chunk wins; tags are unioned."""
    if not chunks:
        raise ValueError("nothing to merge")
    text = "\n".join(c.text for c in chunks).strip()
    tags = sorted({tag for c in chunks for tag in c.tags})
    return chunks[0].model_copy(
        update={
            "text": text,
            "token_count": estimate_tokens(text),
            "tags": tags,
            "block_orders": [order for c in chunks for order in c.block_orders],
        }
    )


def iter_texts(chunks: Iterable[TextChunk]) -> list[str]:
    return [chunk.text for chunk in chunks]


__all__ = [
    "ChunkConfig",
    "ChunkStrategy",
    "Chunker",
    "TextChunk",
    "chunk_document",
    "estimate_tokens",
    "iter_texts",
    "lexical_cohesion",
    "merge_chunks",
    "split_chunk",
    "split_sentences",
]
