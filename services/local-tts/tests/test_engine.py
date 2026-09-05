"""Text handling shared by both engines, plus Kokoro's own vocab tokenizer and
length→speed curve. No weights needed."""

from __future__ import annotations

from app.engines.base import normalize, split_long, split_sentences
from app.engines.kokoro import Tokenizer, length_speed


def test_split_sentences_on_cjk_terminators() -> None:
    text = "這個我不太清楚啦，我們還是講回我這個保單好不好？好，那我們先看保障的部分。\n第三句"
    assert split_sentences(text) == [
        "這個我不太清楚啦，我們還是講回我這個保單好不好？",
        "好，那我們先看保障的部分。",
        "第三句",
    ]


def test_split_long_cuts_at_clauses_and_merges_greedily() -> None:
    sentence = "一二三，四五六，七八九，十。"
    pieces = split_long(sentence, lambda s: len(s) > 8)
    assert pieces == ["一二三，四五六，", "七八九，十。"]
    assert "".join(pieces) == sentence


def test_split_long_leaves_short_sentences_alone() -> None:
    assert split_long("短句。", lambda s: False) == ["短句。"]


def test_length_speed_matches_the_model_card_curve() -> None:
    assert length_speed(10) == 1.0
    assert length_speed(83) == 1.0
    assert abs(length_speed(133) - 0.9) < 1e-9
    assert length_speed(183) == 0.8
    assert length_speed(400) == 0.8


def test_tokenizer_drops_unknown_symbols_instead_of_raising() -> None:
    tok = Tokenizer({"a": 1, "b": 2, ".": 3})
    assert tok.encode("ab.😀b") == [1, 2, 3, 2]


def test_normalize_strips_thousands_separators_and_currency_marks() -> None:
    assert normalize("保費是 1,200 元，NT$3,500，共 12,345,678 元。") == (
        "保費是 1200 元，新台幣3500，共 12345678 元。"
    )
    # A comma between two-digit groups is a real comma, not a separator.
    assert normalize("1,20 元") == "1,20 元"
