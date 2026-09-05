"""台灣讀音覆寫表 — Taiwan readings layered over the shipped lexicon.

Breeze2-VITS is a Taiwan *voice* with a mainland *reading list*. Its
`lexicon.txt` is 注音符號 and its headwords include Traditional characters, which
makes it look Taiwanese, but the readings are the PRC standard and the multi-
character headwords are Simplified (`一丁点儿`, `一个`), so a Traditional word
usually misses the word list entirely and falls back to per-character readings —
losing polyphone disambiguation along with the accent. Measured against the file
itself:

    研究  詞典 ㄧㄢˊ ㄐㄧㄡˉ (jiū)      台灣 ㄐㄧㄡˋ (jiù)
    星期  詞典 ㄒㄧㄥ ㄑㄧˉ (qī)        台灣 ㄑㄧˊ (qí)
    品質  詞典沒有詞條 → 質 ㄓˋ (zhì)   台灣 ㄓˊ (zhí)
    垃圾  詞典沒有詞條 → ㄌㄚ ㄐㄧ       台灣 ㄌㄜˋ ㄙㄜˋ
    危險  詞典 危 ㄨㄟˉ (wēi)          台灣 ㄨㄟˊ (wéi)

So the fix is data, not code: these entries are merged over the lexicon before
the G2P sees it, and longest-match then picks them up for free. Readings follow
教育部《國語一字多音審訂表》/《重編國語辭典修訂本》.

One entry is not an accent fix at all: 長期 is absent from the word list, so it
was read character by character as ㄓㄤˇ ㄑㄧˉ — 長 in its "grow" sense. That is
wrong in every variety of Mandarin, and it is the kind of thing a word list of
Simplified headwords will keep doing to Traditional input.

**Deliberately not here: 和 as ㄏㄢˋ.** It is the most recognisably Taiwanese
reading of all, but it applies only to the conjunction, and a single-character
override would also hit 和平, 溫和, 和諧 and 和尚 whenever those are not matched
as words first. A wrong 和平 is a worse trade than a bookish 和.

Regenerating: the readings were written as tone-numbered pinyin and converted to
注音 by a script that was first validated against 18 of this lexicon's own
entries (圍/有/崖/月/雲/中/說/學/對/六/永/文/王/用/一/五/女/外) — all 18 matched,
so the symbol decomposition here is the file's own, not an invented one.
"""

from __future__ import annotations

#: word → 注音符號 tokens, space separated, exactly as `lexicon.txt` writes them
#: (tone mark is its own token and follows the syllable).
TAIWAN_READINGS: dict[str, str] = {
    # 期 — 台灣一律讀 ㄑㄧˊ，詞典給的是大陸的 ㄑㄧ（保單文案裡到處都是）
    "星期": "ㄒ ㄧ ㄥ ˉ ㄑ ㄧ ˊ",
    "期間": "ㄑ ㄧ ˊ ㄐ ㄧ ㄢ ˉ",
    "期限": "ㄑ ㄧ ˊ ㄒ ㄧ ㄢ ˋ",
    "期待": "ㄑ ㄧ ˊ ㄉ ㄞ ˋ",
    "期滿": "ㄑ ㄧ ˊ ㄇ ㄢ ˇ",
    "過期": "ㄍ ㄨ ㄛ ˋ ㄑ ㄧ ˊ",
    "到期": "ㄉ ㄠ ˋ ㄑ ㄧ ˊ",
    "學期": "ㄒ ㄩ ㄝ ˊ ㄑ ㄧ ˊ",
    "定期": "ㄉ ㄧ ㄥ ˋ ㄑ ㄧ ˊ",
    "短期": "ㄉ ㄨ ㄢ ˇ ㄑ ㄧ ˊ",
    "初期": "ㄔ ㄨ ˉ ㄑ ㄧ ˊ",
    "預期": "ㄩ ˋ ㄑ ㄧ ˊ",
    "如期": "ㄖ ㄨ ˊ ㄑ ㄧ ˊ",
    "續期": "ㄒ ㄩ ˋ ㄑ ㄧ ˊ",
    # 長期 — 詞典沒這個詞，逐字讀成 ㄓㄤˇ（生長的長）＋ㄑㄧ，兩個字都錯
    "長期": "ㄔ ㄤ ˊ ㄑ ㄧ ˊ",
    # 質 — 台灣 ㄓˊ，詞典 ㄓˋ
    "品質": "ㄆ ㄧ ㄣ ˇ ㄓ ˊ",
    "本質": "ㄅ ㄣ ˇ ㄓ ˊ",
    "素質": "ㄙ ㄨ ˋ ㄓ ˊ",
    "實質": "ㄕ ˊ ㄓ ˊ",
    "體質": "ㄊ ㄧ ˇ ㄓ ˊ",
    "物質": "ㄨ ˋ ㄓ ˊ",
    "質疑": "ㄓ ˊ ㄧ ˊ",
    "質押": "ㄓ ˊ ㄧ ㄚ ˉ",
    # 危 — 台灣 ㄨㄟˊ，詞典 ㄨㄟ（保險最常講的兩個字之一）
    "危險": "ㄨ ㄟ ˊ ㄒ ㄧ ㄢ ˇ",
    "危機": "ㄨ ㄟ ˊ ㄐ ㄧ ˉ",
    "危害": "ㄨ ㄟ ˊ ㄏ ㄞ ˋ",
    "危及": "ㄨ ㄟ ˊ ㄐ ㄧ ˊ",
    "安危": "ㄢ ˉ ㄨ ㄟ ˊ",
    # 企 — 台灣 ㄑㄧˋ，詞典 ㄑㄧˇ
    "企業": "ㄑ ㄧ ˋ ㄧ ㄝ ˋ",
    "企圖": "ㄑ ㄧ ˋ ㄊ ㄨ ˊ",
    "企劃": "ㄑ ㄧ ˋ ㄏ ㄨ ㄚ ˋ",
    "企鵝": "ㄑ ㄧ ˋ ㄜ ˊ",
    # 髮 — 台灣 ㄈㄚˇ，詞典 ㄈㄚˋ
    "頭髮": "ㄊ ㄡ ˊ ㄈ ㄚ ˇ",
    "理髮": "ㄌ ㄧ ˇ ㄈ ㄚ ˇ",
    "髮型": "ㄈ ㄚ ˇ ㄒ ㄧ ㄥ ˊ",
    "白髮": "ㄅ ㄞ ˊ ㄈ ㄚ ˇ",
    # 法（國名）— 台灣 ㄈㄚˋ，詞典 ㄈㄚˇ；法律的法兩邊都是 ㄈㄚˇ，所以只列國名相關
    "法國": "ㄈ ㄚ ˋ ㄍ ㄨ ㄛ ˊ",
    "法語": "ㄈ ㄚ ˋ ㄩ ˇ",
    "法文": "ㄈ ㄚ ˋ ㄨ ㄣ ˊ",
    "法郎": "ㄈ ㄚ ˋ ㄌ ㄤ ˊ",
    # 研究 / 究竟 — 究 台灣 ㄐㄧㄡˋ，詞典 ㄐㄧㄡ
    "研究": "ㄧ ㄢ ˊ ㄐ ㄧ ㄡ ˋ",
    "究竟": "ㄐ ㄧ ㄡ ˋ ㄐ ㄧ ㄥ ˋ",
    # 液 / 血 — 台灣 液 ㄧˋ、血 ㄒㄧㄝˇ；詞典 ㄧㄝˋ / ㄒㄩㄝˋ
    "液體": "ㄧ ˋ ㄊ ㄧ ˇ",
    "液晶": "ㄧ ˋ ㄐ ㄧ ㄥ ˉ",
    "血液": "ㄒ ㄧ ㄝ ˇ ㄧ ˋ",
    # 其餘一字多音審訂表上的常用差異
    "垃圾": "ㄌ ㄜ ˋ ㄙ ㄜ ˋ",
    "說服": "ㄕ ㄨ ㄟ ˋ ㄈ ㄨ ˊ",
    "暫時": "ㄓ ㄢ ˋ ㄕ ˊ",
    "短暫": "ㄉ ㄨ ㄢ ˇ ㄓ ㄢ ˋ",
    "暫停": "ㄓ ㄢ ˋ ㄊ ㄧ ㄥ ˊ",
    "攜帶": "ㄒ ㄧ ˉ ㄉ ㄞ ˋ",
    "亞洲": "ㄧ ㄚ ˇ ㄓ ㄡ ˉ",
    "亞太": "ㄧ ㄚ ˇ ㄊ ㄞ ˋ",
    "包括": "ㄅ ㄠ ˉ ㄍ ㄨ ㄚ ˉ",
    "步驟": "ㄅ ㄨ ˋ ㄗ ㄡ ˋ",
    "檔案": "ㄉ ㄤ ˇ ㄢ ˋ",
    "懸崖": "ㄒ ㄩ ㄢ ˊ ㄧ ㄞ ˊ",
    "山崖": "ㄕ ㄢ ˉ ㄧ ㄞ ˊ",
    "蝸牛": "ㄍ ㄨ ㄚ ˉ ㄋ ㄧ ㄡ ˊ",
    "曝光": "ㄆ ㄨ ˋ ㄍ ㄨ ㄤ ˉ",
    "熟悉": "ㄕ ㄡ ˊ ㄒ ㄧ ˉ",
}


def taiwan_lexicon() -> dict[str, list[str]]:
    """The table in the same shape `read_lexicon` returns."""
    return {word: reading.split() for word, reading in TAIWAN_READINGS.items()}
