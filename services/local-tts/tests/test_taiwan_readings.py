"""The 台灣讀音 overlay: what it changes, and — just as important — what it does not.

These run against the real `lexicon.txt` when it is present, because the whole
point of the table is what it does to *that* file; without it there is nothing
to correct and the tests skip.
"""

from __future__ import annotations

import pytest

from app.config import get_settings
from app.engines.breeze import LEXICON_FILE, TOKENS_FILE, BopomofoG2P, read_lexicon, read_tokens
from app.engines.taiwan_readings import TAIWAN_READINGS, taiwan_lexicon


@pytest.fixture(scope="module")
def g2p_pair() -> tuple[BopomofoG2P, BopomofoG2P]:
    model_dir = get_settings().breeze_dir
    lexicon_path = model_dir / LEXICON_FILE
    tokens_path = model_dir / TOKENS_FILE
    if not (lexicon_path.is_file() and tokens_path.is_file()):
        pytest.skip("Breeze2-VITS lexicon not fetched")
    tokens = read_tokens(tokens_path)
    return (
        BopomofoG2P(tokens, read_lexicon(lexicon_path, taiwan=False)),
        BopomofoG2P(tokens, read_lexicon(lexicon_path, taiwan=True)),
    )


#: (word, what the shipped lexicon reads it as, what Taiwan reads it as).
#: Written out rather than derived from the table, so a typo in the table is a
#: test failure and not a silently agreeing expectation.
CASES = [
    ("研究", "ㄧ ㄢ ˊ ㄐ ㄧ ㄡ ˉ", "ㄧ ㄢ ˊ ㄐ ㄧ ㄡ ˋ"),
    ("星期", "ㄒ ㄧ ㄥ ˉ ㄑ ㄧ ˉ", "ㄒ ㄧ ㄥ ˉ ㄑ ㄧ ˊ"),
    ("品質", "ㄆ ㄧ ㄣ ˇ ㄓ ˋ", "ㄆ ㄧ ㄣ ˇ ㄓ ˊ"),
    ("垃圾", "ㄌ ㄚ ˉ ㄐ ㄧ ˉ", "ㄌ ㄜ ˋ ㄙ ㄜ ˋ"),
    ("危險", "ㄨ ㄟ ˉ ㄒ ㄧ ㄢ ˇ", "ㄨ ㄟ ˊ ㄒ ㄧ ㄢ ˇ"),
    ("企業", "ㄑ ㄧ ˇ ㄧ ㄝ ˋ", "ㄑ ㄧ ˋ ㄧ ㄝ ˋ"),
    ("法國", "ㄈ ㄚ ˇ ㄍ ㄨ ㄛ ˊ", "ㄈ ㄚ ˋ ㄍ ㄨ ㄛ ˊ"),
    ("頭髮", "ㄊ ㄡ ˊ ㄈ ㄚ ˋ", "ㄊ ㄡ ˊ ㄈ ㄚ ˇ"),
    ("說服", "ㄕ ㄨ ㄛ ˉ ㄈ ㄨ ˊ", "ㄕ ㄨ ㄟ ˋ ㄈ ㄨ ˊ"),
    ("血液", "ㄒ ㄩ ㄝ ˋ ㄧ ㄝ ˋ", "ㄒ ㄧ ㄝ ˇ ㄧ ˋ"),
    ("包括", "ㄅ ㄠ ˉ ㄎ ㄨ ㄛ ˋ", "ㄅ ㄠ ˉ ㄍ ㄨ ㄚ ˉ"),
    ("蝸牛", "ㄨ ㄛ ˉ ㄋ ㄧ ㄡ ˊ", "ㄍ ㄨ ㄚ ˉ ㄋ ㄧ ㄡ ˊ"),
    # Not an accent fix: 長期 is missing from the word list, so it was read
    # character by character as 長 in its "grow" sense — wrong in any variety.
    ("長期", "ㄓ ㄤ ˇ ㄑ ㄧ ˉ", "ㄔ ㄤ ˊ ㄑ ㄧ ˊ"),
]


@pytest.mark.parametrize(("word", "shipped", "taiwan"), CASES)
def test_reading_is_corrected(
    g2p_pair: tuple[BopomofoG2P, BopomofoG2P], word: str, shipped: str, taiwan: str
) -> None:
    base, tw = g2p_pair
    assert " ".join(base.phonemes(word)) == shipped, "the shipped lexicon changed under us"
    assert " ".join(tw.phonemes(word)) == taiwan


#: Ordinary sales vocabulary with no Taiwan/mainland split. The overlay must not
#: touch these — a reading table that quietly edits unrelated words is worse than
#: no table, because nobody would think to listen for it.
UNTOUCHED = [
    "保險",
    "保單",
    "方案",
    "業務員",
    "理賠",
    "受益人",
    "這個我不太清楚啦，我們還是講回我這個保單好不好？",
]


@pytest.mark.parametrize("text", UNTOUCHED)
def test_unrelated_text_is_unchanged(g2p_pair: tuple[BopomofoG2P, BopomofoG2P], text: str) -> None:
    base, tw = g2p_pair
    assert base.phonemes(text) == tw.phonemes(text)


def test_every_override_uses_symbols_the_model_knows(
    g2p_pair: tuple[BopomofoG2P, BopomofoG2P],
) -> None:
    """A typo in the table would drop that symbol silently at encode time."""
    base, _ = g2p_pair
    unknown = {
        symbol
        for reading in taiwan_lexicon().values()
        for symbol in reading
        if symbol not in base.tokens
    }
    assert unknown == set()


def test_every_override_actually_changes_something(
    g2p_pair: tuple[BopomofoG2P, BopomofoG2P],
) -> None:
    """No dead rows: each entry must differ from what the lexicon already gave."""
    base, _ = g2p_pair
    identical = [
        word for word, reading in taiwan_lexicon().items() if base.phonemes(word) == reading
    ]
    assert identical == []


def test_table_is_traditional_and_has_no_erhua() -> None:
    """The shipped word list is Simplified and carries 儿 headwords (`一丁点儿`).
    Ours must not: erhua is not how any of this is said here."""
    assert not [w for w in TAIWAN_READINGS if "儿" in w or "兒" in w]
    assert not [r for r in TAIWAN_READINGS.values() if "ㄦ" in r.split()]
