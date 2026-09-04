"""§11.4 — every chunking strategy, overlap, and parent-child.

`auto` routing is included because it is what the upload modal uses by default: a
document whose shape changes should change strategy, not silently fall back to
fixed-token windows.
"""

from __future__ import annotations

import pytest

from app.rag.chunker import (
    ChunkConfig,
    Chunker,
    ChunkStrategy,
    chunk_document,
    estimate_tokens,
    merge_chunks,
    split_chunk,
    split_sentences,
)
from app.rag.structure import Block, BlockKind, blocks_from_text

MANUAL = """\
# 第一章 商品概述
本商品為終身壽險，提供身故與全殘保障。保費依投保年齡計算。
本商品不保事項請參閱條款第十二條。

## 1.1 給付項目
身故保險金依保單價值準備金計算。全殘保險金給付方式相同。
被保險人於契約有效期間內身故者，本公司按保險金額給付。

## 1.2 費率表
| 年齡 | 男性費率 | 女性費率 |
| --- | --- | --- |
| 30 | 1200 | 1100 |
| 40 | 1800 | 1650 |
| 50 | 2900 | 2600 |

# 第二章 常見問答
Q: 保費可以年繳嗎？
A: 可以，年繳另有折扣，請洽業務人員。

Q: 契約撤銷期間是多久？
A: 收到保單翌日起算十日內可撤銷契約。
"""


@pytest.fixture
def blocks() -> list[Block]:
    return blocks_from_text(MANUAL, page=1)


def _config(**kwargs) -> ChunkConfig:
    # These tests exercise chunking *strategy*, so they set a deliberately tiny
    # chunk_size to keep fixtures readable. ChunkConfig's default overlap (64) is
    # larger than that and would trip the `overlap < chunk_size` validator, so
    # derive a proportional overlap unless the test is specifically about overlap.
    if "overlap" not in kwargs and "chunk_size" in kwargs:
        kwargs["overlap"] = min(ChunkConfig.model_fields["overlap"].default, kwargs["chunk_size"] // 4)
    return ChunkConfig(**kwargs)


# ---------------------------------------------------------------------------
# token estimation + sentence splitting
# ---------------------------------------------------------------------------
def test_estimate_tokens_counts_cjk_per_character():
    assert estimate_tokens("保費依投保年齡計算") == 9
    assert estimate_tokens("") == 0
    # latin text is roughly a quarter of its character count
    assert 4 <= estimate_tokens("the quick brown fox jumps") <= 8


def test_split_sentences_handles_chinese_punctuation():
    parts = split_sentences("第一句。第二句！第三句？")
    assert len(parts) == 3
    assert parts[0].startswith("第一句")


# ---------------------------------------------------------------------------
# per-strategy behaviour
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "strategy",
    [
        ChunkStrategy.SEMANTIC,
        ChunkStrategy.HEADING,
        ChunkStrategy.PARAGRAPH,
        ChunkStrategy.FIXED_TOKEN,
        ChunkStrategy.TABLE_AWARE,
        ChunkStrategy.FAQ_AWARE,
        ChunkStrategy.AUTO,
    ],
)
def test_every_strategy_produces_non_empty_indexed_chunks(blocks, strategy):
    chunks = chunk_document(blocks, config=_config(strategy=strategy, chunk_size=120))
    assert chunks, f"{strategy} produced nothing"
    assert [c.index for c in chunks] == list(range(len(chunks)))
    assert all(c.text.strip() for c in chunks)
    assert all(c.token_count > 0 for c in chunks)
    assert all(c.strategy is not ChunkStrategy.AUTO for c in chunks)


def test_heading_strategy_splits_at_headings_and_records_the_section(blocks):
    chunks = chunk_document(
        blocks,
        config=_config(strategy=ChunkStrategy.HEADING, chunk_size=400, min_length=1),
    )
    sections = [c.section for c in chunks if c.section]
    assert any("第一章" in (section or "") for section in sections)
    assert any("1.1" in (section or "") for section in sections)
    # a chunk never spans two top-level chapters
    for chunk in chunks:
        assert not ("第一章" in chunk.text and "第二章" in chunk.text)


def test_paragraph_strategy_never_splits_mid_paragraph():
    blocks = [
        Block(kind=BlockKind.PARAGRAPH, text="第一段內容。", order=0),
        Block(kind=BlockKind.PARAGRAPH, text="第二段內容。", order=1),
    ]
    chunks = chunk_document(
        blocks, config=_config(strategy=ChunkStrategy.PARAGRAPH, chunk_size=32, min_length=1)
    )
    joined = " ".join(c.text for c in chunks)
    assert "第一段內容。" in joined
    assert "第二段內容。" in joined


def test_fixed_token_respects_chunk_size():
    long_text = "。".join(f"這是第{index}句話內容" for index in range(60)) + "。"
    blocks = [Block(kind=BlockKind.PARAGRAPH, text=long_text, order=0)]
    config = _config(
        strategy=ChunkStrategy.FIXED_TOKEN, chunk_size=64, overlap=0, max_length=128
    )
    chunks = chunk_document(blocks, config=config)
    assert len(chunks) > 1
    assert all(c.token_count <= config.max_length for c in chunks)


def test_fixed_token_overlap_repeats_the_tail_of_the_previous_chunk():
    sentences = [f"句子{index}內容足夠長以便切分" for index in range(30)]
    blocks = [Block(kind=BlockKind.PARAGRAPH, text="。".join(sentences) + "。", order=0)]
    with_overlap = chunk_document(
        blocks,
        config=_config(strategy=ChunkStrategy.FIXED_TOKEN, chunk_size=48, overlap=24),
    )
    without_overlap = chunk_document(
        blocks,
        config=_config(strategy=ChunkStrategy.FIXED_TOKEN, chunk_size=48, overlap=0),
    )
    assert len(with_overlap) >= len(without_overlap)

    # consecutive overlapping chunks must share at least one sentence
    shared = 0
    for previous, current in zip(with_overlap, with_overlap[1:], strict=False):
        previous_sentences = set(split_sentences(previous.text))
        current_sentences = set(split_sentences(current.text))
        if previous_sentences & current_sentences:
            shared += 1
    assert shared >= 1


def test_overlap_must_be_smaller_than_chunk_size():
    with pytest.raises(ValueError, match="overlap"):
        ChunkConfig(chunk_size=100, overlap=100)


def test_table_aware_keeps_the_table_in_one_chunk(blocks):
    chunks = chunk_document(
        blocks, config=_config(strategy=ChunkStrategy.TABLE_AWARE, chunk_size=64)
    )
    table_chunks = [c for c in chunks if "table" in c.tags]
    assert len(table_chunks) == 1
    table = table_chunks[0]
    for age in ("30", "40", "50"):
        assert age in table.text
    assert table.metadata.get("table_rows") == 4
    assert table.metadata.get("table_columns") == 3


def test_table_is_not_split_even_when_it_exceeds_chunk_size(blocks):
    chunks = chunk_document(
        blocks, config=_config(strategy=ChunkStrategy.PARAGRAPH, chunk_size=32, max_length=4096)
    )
    table_chunks = [c for c in chunks if "table" in c.tags]
    assert len(table_chunks) == 1


def test_faq_aware_keeps_question_and_answer_together(blocks):
    chunks = chunk_document(
        blocks,
        config=_config(strategy=ChunkStrategy.FAQ_AWARE, chunk_size=200, min_length=1),
    )
    faq = [c for c in chunks if "faq" in c.tags]
    assert len(faq) == 2
    for chunk in faq:
        assert chunk.text.startswith("Q: ")
        assert "\nA: " in chunk.text
        assert chunk.metadata.get("question")
    annual = next(c for c in faq if "年繳" in c.text)
    assert "折扣" in annual.text


def test_semantic_strategy_breaks_on_a_topic_shift():
    blocks = [
        Block(
            kind=BlockKind.PARAGRAPH,
            text="保費依投保年齡計算。保費也會依繳費年期調整。保費繳納方式有年繳與月繳。",
            order=0,
            section_path=["費率"],
        ),
        Block(
            kind=BlockKind.PARAGRAPH,
            text="理賠申請需檢附診斷證明。理賠文件請寄回總公司。理賠審核約需十個工作日。",
            order=1,
            section_path=["理賠"],
        ),
    ]
    chunks = chunk_document(
        blocks, config=_config(strategy=ChunkStrategy.SEMANTIC, chunk_size=200, min_length=4)
    )
    assert len(chunks) >= 2
    assert not any("保費" in c.text and "理賠審核" in c.text for c in chunks)


# ---------------------------------------------------------------------------
# auto routing
# ---------------------------------------------------------------------------
def test_auto_picks_faq_aware_for_an_faq_document():
    faq_text = "\n".join(
        f"Q: 問題{index}是什麼？\nA: 這是問題{index}的完整回答內容。" for index in range(6)
    )
    chunks = chunk_document(
        blocks_from_text(faq_text), config=_config(strategy=ChunkStrategy.AUTO)
    )
    assert all(c.strategy is ChunkStrategy.FAQ_AWARE for c in chunks)


def test_auto_picks_heading_for_a_structured_manual():
    text = "\n".join(
        f"## 第{index}節 標題\n這一節的內容說明如下，包含相關規範與範例。" for index in range(1, 8)
    )
    chunks = chunk_document(blocks_from_text(text), config=_config(strategy=ChunkStrategy.AUTO))
    assert all(c.strategy is ChunkStrategy.HEADING for c in chunks)


def test_auto_picks_table_aware_for_a_table_heavy_document():
    rows = "\n".join(f"| {index} | {index * 10} | {index * 20} |" for index in range(1, 6))
    text = f"費率表\n| 年齡 | 男 | 女 |\n| --- | --- | --- |\n{rows}\n"
    chunks = chunk_document(blocks_from_text(text), config=_config(strategy=ChunkStrategy.AUTO))
    assert any("table" in c.tags for c in chunks)


def test_detect_strategy_falls_back_to_fixed_token_for_nothing():
    assert Chunker().detect_strategy([]) is ChunkStrategy.FIXED_TOKEN


# ---------------------------------------------------------------------------
# parent-child (§11.4) + metadata inheritance
# ---------------------------------------------------------------------------
def test_parent_child_emits_parents_before_children_with_valid_links(blocks):
    chunks = chunk_document(
        blocks,
        config=_config(
            strategy=ChunkStrategy.SEMANTIC,
            chunk_size=40,
            overlap=0,
            min_length=1,
            parent_child=True,
            parent_chunk_size=2048,
        ),
    )
    parents = [c for c in chunks if c.is_parent]
    children = [c for c in chunks if c.parent_index is not None]
    assert parents, "expected at least one parent chunk"
    assert children, "expected child chunks linked to a parent"

    for child in children:
        assert 0 <= child.parent_index < len(chunks)
        parent = chunks[child.parent_index]
        assert parent.is_parent is True
        # the parent must precede its children and contain their text
        assert parent.index < child.index
        assert child.text.replace(" ", "")[:12] in parent.text.replace(" ", "")
    for parent in parents:
        assert "parent" in parent.tags
        assert parent.metadata.get("child_count", 0) >= 2


def test_parent_child_off_by_default(blocks):
    chunks = chunk_document(blocks, config=_config(strategy=ChunkStrategy.SEMANTIC))
    assert all(not c.is_parent for c in chunks)
    assert all(c.parent_index is None for c in chunks)


def test_metadata_inheritance_flows_document_fields_onto_every_chunk(blocks):
    chunks = chunk_document(
        blocks,
        config=_config(strategy=ChunkStrategy.HEADING, metadata_inheritance=True),
        document_metadata={
            "document_id": "doc1",
            "document_name": "商品手冊.pdf",
            "document_version": 3,
        },
    )
    assert chunks
    for chunk in chunks:
        assert chunk.metadata["document_id"] == "doc1"
        assert chunk.metadata["document_name"] == "商品手冊.pdf"
        assert chunk.metadata["document_version"] == 3
        # chunk-level keys survive inheritance
        assert "section_path" in chunk.metadata


def test_metadata_inheritance_can_be_disabled(blocks):
    chunks = chunk_document(
        blocks,
        config=_config(strategy=ChunkStrategy.HEADING, metadata_inheritance=False),
        document_metadata={"document_id": "doc1"},
    )
    assert all("document_id" not in c.metadata for c in chunks)


def test_page_numbers_are_preserved_for_citations():
    blocks = [
        Block(kind=BlockKind.PARAGRAPH, text="第一頁的內容說明。", page=1, order=0),
        Block(kind=BlockKind.PARAGRAPH, text="第二頁的內容說明。", page=2, order=1),
    ]
    chunks = chunk_document(
        blocks, config=_config(strategy=ChunkStrategy.PARAGRAPH, chunk_size=32, min_length=1)
    )
    pages = {c.page for c in chunks}
    assert pages <= {1, 2}
    assert pages


# ---------------------------------------------------------------------------
# bounds
# ---------------------------------------------------------------------------
def test_chunks_over_max_length_are_hard_split():
    text = "。".join(f"很長的句子第{index}段內容" for index in range(200)) + "。"
    chunks = chunk_document(
        [Block(kind=BlockKind.PARAGRAPH, text=text, order=0)],
        config=_config(strategy=ChunkStrategy.PARAGRAPH, chunk_size=64, max_length=128),
    )
    assert all(c.token_count <= 128 for c in chunks)


def test_tiny_fragments_are_merged_backwards():
    blocks = [
        Block(kind=BlockKind.PARAGRAPH, text="這是一段足夠長的內容說明，用來當作前一個 chunk。", order=0),
        Block(kind=BlockKind.PARAGRAPH, text="好。", order=1),
    ]
    chunks = chunk_document(
        blocks,
        config=_config(strategy=ChunkStrategy.PARAGRAPH, chunk_size=32, min_length=10),
    )
    assert all(c.token_count >= 3 for c in chunks)
    assert "好。" in " ".join(c.text for c in chunks)


def test_footer_blocks_are_dropped():
    blocks = [
        Block(kind=BlockKind.PARAGRAPH, text="正式內容說明如下所示。", order=0),
        Block(kind=BlockKind.FOOTER, text="第 3 頁", order=1),
    ]
    chunks = chunk_document(
        blocks, config=_config(strategy=ChunkStrategy.PARAGRAPH, min_length=1)
    )
    assert all("第 3 頁" not in c.text for c in chunks)


# ---------------------------------------------------------------------------
# chunk editor primitives (§11.5)
# ---------------------------------------------------------------------------
def test_split_chunk_produces_two_non_empty_halves(blocks):
    chunk = chunk_document(blocks, config=_config(strategy=ChunkStrategy.PARAGRAPH))[0]
    head, tail = split_chunk(chunk, len(chunk.text) // 2)
    assert head.text and tail.text
    assert head.token_count == estimate_tokens(head.text)
    assert tail.index == chunk.index + 1


@pytest.mark.parametrize("position", [0, 10_000])
def test_split_chunk_rejects_an_out_of_range_position(blocks, position):
    chunk = chunk_document(blocks, config=_config(strategy=ChunkStrategy.PARAGRAPH))[0]
    with pytest.raises(ValueError, match="split"):
        split_chunk(chunk, position)


def test_merge_chunks_unions_tags_and_recomputes_tokens(blocks):
    chunks = chunk_document(blocks, config=_config(strategy=ChunkStrategy.PARAGRAPH))[:2]
    merged = merge_chunks(chunks)
    assert merged.token_count == estimate_tokens(merged.text)
    assert all(chunk.text in merged.text for chunk in chunks)
    assert merged.tags == sorted({tag for chunk in chunks for tag in chunk.tags})


def test_merge_chunks_requires_input():
    with pytest.raises(ValueError, match="nothing to merge"):
        merge_chunks([])


# ---------------------------------------------------------------------------
# determinism
# ---------------------------------------------------------------------------
def test_chunking_is_deterministic(blocks):
    config = _config(strategy=ChunkStrategy.AUTO, parent_child=True)
    first = chunk_document(blocks, config=config)
    second = chunk_document(blocks, config=config)
    assert [c.model_dump() for c in first] == [c.model_dump() for c in second]


def test_fingerprint_ignores_whitespace(blocks):
    chunk = chunk_document(blocks, config=_config(strategy=ChunkStrategy.PARAGRAPH))[0]
    spaced = chunk.model_copy(update={"text": f"  {chunk.text}  \n"})
    assert chunk.fingerprint == spaced.fingerprint
