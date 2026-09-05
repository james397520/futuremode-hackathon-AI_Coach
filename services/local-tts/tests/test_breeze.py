"""Breeze2-VITS: the 注音 G2P without weights, then one real synthesis.

The G2P tests read the shipped `lexicon.txt`/`tokens.txt` if they are there and
fall back to a hand-written miniature otherwise, so a checkout without the
weights still lints and tests. The smoke test is skipped when the 121 MB graph
is absent.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.config import get_settings
from app.engines import breeze
from app.engines.breeze import (
    LEXICON_FILE,
    TOKENS_FILE,
    BopomofoG2P,
    BreezeVitsEngine,
    is_available,
    read_lexicon,
    read_tokens,
    verbalize,
)

BREEZE_DIR = get_settings().breeze_dir
HAVE_FILES = (BREEZE_DIR / TOKENS_FILE).is_file() and (BREEZE_DIR / LEXICON_FILE).is_file()
needs_files = pytest.mark.skipif(not HAVE_FILES, reason="breeze2-vits lexicon not fetched")
needs_model = pytest.mark.skipif(
    not is_available(BREEZE_DIR), reason="breeze2-vits weights not fetched"
)

#: Six punctuation marks, the blank and a space — the whole of tokens.txt that
#: is not 注音, and enough to exercise the mapping table.
MINI_TOKENS = {"_": 0, "，": 1, "。": 2, "！": 3, "？": 4, "—": 5, "…": 6, "ㄨ": 42, "ˊ": 45}


@pytest.fixture(scope="module")
def g2p() -> BopomofoG2P:
    """The lexicon **as shipped**. `taiwan=False` on purpose: these tests are
    about MediaTek's file, and the 台灣讀音 overlay that the service turns on by
    default is covered on its own in `test_taiwan_readings.py`."""
    if HAVE_FILES:
        return BopomofoG2P(
            read_tokens(BREEZE_DIR / TOKENS_FILE),
            read_lexicon(BREEZE_DIR / LEXICON_FILE, taiwan=False),
        )
    return BopomofoG2P(MINI_TOKENS, {"研": ["ㄧ", "ㄢ", "ˊ"]})


def mini_g2p(lexicon: dict[str, list[str]]) -> BopomofoG2P:
    return BopomofoG2P(MINI_TOKENS, lexicon)


# ---- tokens / lexicon files -------------------------------------------------
@needs_files
def test_tokens_file_parses_including_the_space_symbol() -> None:
    tokens = read_tokens(BREEZE_DIR / TOKENS_FILE)
    assert len(tokens) == 50
    assert tokens["_"] == 0  # the blank that add_blank=1 interleaves
    assert tokens["ㄅ"] == 7
    assert tokens["˙"] == 48
    # The last line is "<space> 49"; splitting from the left would lose it.
    assert tokens[" "] == 49


@needs_files
def test_lexicon_readings_match_the_shipped_file(g2p: BopomofoG2P) -> None:
    assert g2p.lexicon["研究"] == ["ㄧ", "ㄢ", "ˊ", "ㄐ", "ㄧ", "ㄡ", "ˉ"]
    assert g2p.lexicon["星期"] == ["ㄒ", "ㄧ", "ㄥ", "ˉ", "ㄑ", "ㄧ", "ˉ"]
    assert g2p.lexicon["保"] == ["ㄅ", "ㄠ", "ˇ"]
    assert len(g2p.lexicon) == 67_999


@needs_files
def test_a_persona_line_is_read_end_to_end(g2p: BopomofoG2P) -> None:
    assert "".join(g2p.phonemes("好，那我們先看保障的部分。")) == (
        "ㄏㄠˇ，ㄋㄚˋㄨㄛˇㄇㄣ˙ㄒㄧㄢˉㄎㄢˋㄅㄠˇㄓㄤˋㄉㄜ˙ㄅㄨˋㄈㄣˋ。"
    )


# ---- longest match ----------------------------------------------------------
def test_longest_match_beats_per_character() -> None:
    # 研究 as a word is yán-jiū; character by character 究 would still be jiū but
    # the word entry is what must win — here the word reading is deliberately
    # different from the two single-character ones so the test can tell.
    lex = {"研究": ["ㄨ", "ˊ"], "研": ["ㄨ"], "究": ["ˊ", "ˊ"]}
    assert mini_g2p(lex).phonemes("研究") == ["ㄨ", "ˊ"]
    # …and a character that is not part of the word still falls back to itself.
    assert mini_g2p(lex).phonemes("究研") == ["ˊ", "ˊ", "ㄨ"]


def test_longest_match_never_looks_past_the_longest_headword() -> None:
    g = mini_g2p({"研": ["ㄨ"]})
    assert g.max_word == 1
    assert g.phonemes("研研") == ["ㄨ", "ㄨ"]


def test_unknown_characters_are_dropped_not_raised() -> None:
    g = mini_g2p({"研": ["ㄨ"]})
    # An emoji, a Latin word and an unmapped bracket all vanish; the Chinese
    # around them still speaks.
    assert g.phonemes("研😀OK研") == ["ㄨ", "ㄨ"]
    assert g.phonemes("「研」") == ["ㄨ"]


# ---- punctuation ------------------------------------------------------------
def test_punctuation_maps_onto_the_six_supported_marks() -> None:
    g = mini_g2p({"研": ["ㄨ"]})
    assert g.phonemes("研,研、研;研:研") == ["ㄨ", "，", "ㄨ", "，", "ㄨ", "，", "ㄨ", "，", "ㄨ"]
    assert g.phonemes("研.研!研?研") == ["ㄨ", "。", "ㄨ", "！", "ㄨ", "？", "ㄨ"]
    assert g.phonemes("研–研…研") == ["ㄨ", "—", "ㄨ", "…", "ㄨ"]
    # A hyphen is usually between numbers, so it is a comma-length pause.
    assert g.phonemes("研-研") == ["ㄨ", "，", "ㄨ"]


def test_repeated_punctuation_collapses_to_one_pause() -> None:
    g = mini_g2p({"研": ["ㄨ"]})
    assert g.phonemes("研。」，研") == ["ㄨ", "。", "，", "ㄨ"]
    assert g.phonemes("研,,,研") == ["ㄨ", "，", "ㄨ"]


# ---- ids --------------------------------------------------------------------
def test_encode_interleaves_the_blank_token() -> None:
    g = mini_g2p({})
    # add_blank=1: blank, token, blank, token, …, blank.
    assert g.encode(["ㄨ", "ˊ", "。"]) == [0, 42, 0, 45, 0, 2, 0]
    assert g.encode([]) == [0]
    # A phoneme outside tokens.txt is skipped rather than crashing the request.
    assert g.encode(["ㄨ", "☃"]) == [0, 42, 0]


# ---- numbers ----------------------------------------------------------------
def test_verbalize_spells_digits_out_because_the_token_set_has_none() -> None:
    assert verbalize("一個月 3500 元") == "一個月 三千五百 元"
    assert verbalize("百分之5") == "百分之五"
    assert verbalize("沒有數字") == "沒有數字"


# ---- the model itself -------------------------------------------------------
@needs_model
def test_synthesis_produces_audio_of_a_plausible_length() -> None:
    cfg = get_settings()
    engine = BreezeVitsEngine(
        model_path=cfg.breeze_dir / breeze.MODEL_FILE,
        tokens_path=cfg.breeze_dir / breeze.TOKENS_FILE,
        lexicon_path=cfg.breeze_dir / breeze.LEXICON_FILE,
        threads=2,
    )
    assert engine.sample_rate == 22_050
    assert engine.single_speaker is True

    pcm, stats = engine.synthesize("好，那我們先看保障的部分。", voice=breeze.VOICE_NAME)

    assert pcm.dtype == np.int16
    # 13 characters at a human pace: somewhere between 1.5 s and 6 s, never 0.
    assert 1.5 < stats.audio_s < 6.0
    assert stats.chunks == 1
    assert stats.phonemes > 20
    # Not silence, and not a clipped wall of noise either.
    rms = float(np.sqrt(np.mean((pcm.astype(np.float32) / 32767.0) ** 2)))
    assert 0.01 < rms < 0.4
    assert float(np.abs(pcm).max()) / 32767.0 <= 1.0
    assert stats.rtf > 0


@needs_model
def test_voice_and_gender_are_accepted_and_ignored() -> None:
    cfg = get_settings()
    engine = BreezeVitsEngine(
        model_path=cfg.breeze_dir / breeze.MODEL_FILE,
        tokens_path=cfg.breeze_dir / breeze.TOKENS_FILE,
        lexicon_path=cfg.breeze_dir / breeze.LEXICON_FILE,
        threads=2,
    )
    assert engine.voice_names() == [breeze.VOICE_NAME]
    assert engine.default_voice("male") == engine.default_voice("female")
    assert engine.has_voice("zm_010") is False
