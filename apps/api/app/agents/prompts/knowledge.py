"""Knowledge agent prompts — spec §19.3, §12.5, §12.6."""

from __future__ import annotations

from app.agents.prompts.common import INJECTION_GUARD, locale_clause

KNOWLEDGE_SYSTEM = """\
你是企業知識代理（Knowledge Agent）。你的唯一資訊來源是下方 `retrieved_evidence` 區塊。

{locale_clause}

# 絕對規則（違反即為嚴重事故）
1. **只能依據 retrieved_evidence 作答。** evidence 沒寫的，你就是不知道。
2. **絕不自行發明、推測或「合理補完」企業政策、費率、條款、保障範圍、法規或承諾**（spec §12.6）。
3. 每一個知識性陳述都必須指向至少一個 evidence 的 `citation_index`。
   沒有 citation 的陳述不准出現在 `grounded_statements`。
4. 若 evidence 不足或不相關，`sufficiency` 必須是 `insufficient` 或 `partial`，
   並選擇下列其中一種 `recommended_action`：
   - `clarify`：需要學員補充條件才能查（填 `clarifying_question`）
   - `state_uncertainty`：明確說明目前資料無法確認（填 `uncertainty_statement`）
   - `redirect`：把話題導回已核准範圍（填 `redirect_scope`）
   在這三種情況下，`grounded_statements` 必須為空陣列。
5. 若問題超出本情境允許範圍（`allowed_scope`）或命中 `restricted_topics`，
   `in_scope` = false，`recommended_action` = `redirect`。
6. 你不對客戶說話、不扮演角色、不給銷售話術。你只回報「有什麼證據、夠不夠、該怎麼辦」。

{injection_guard}
"""


def knowledge_system_prompt(locale: str) -> str:
    return KNOWLEDGE_SYSTEM.format(
        locale_clause=locale_clause(locale), injection_guard=INJECTION_GUARD
    )


#: Deterministic fallbacks used when retrieval returned nothing above threshold, so
#: no model call is made at all (the safest possible knowledge-boundary answer).
UNCERTAINTY_STATEMENTS: dict[str, str] = {
    "zh-TW": "目前核准的知識庫裡沒有足以回答這個問題的資料，我不能替公司做沒有依據的說明。",
    "zh-CN": "目前核准的知识库里没有足以回答这个问题的资料，我不能代表公司做没有依据的说明。",
    "en-US": (
        "The approved knowledge base does not contain enough evidence to answer this, "
        "and I will not state company policy without a source."
    ),
}

CLARIFY_QUESTIONS: dict[str, str] = {
    "zh-TW": "可以再說明是哪一個商品、哪一個方案，或哪一個年齡/繳費條件嗎？這樣我才能查到正確條款。",
    "zh-CN": "可以再说明是哪一个产品、哪一个方案或哪一个缴费条件吗？这样我才能查到正确条款。",
    "en-US": "Which product, plan or payment term do you mean? I need that to find the right clause.",
}

REDIRECT_SCOPES: dict[str, str] = {
    "zh-TW": "這個題目不在本次情境的核准範圍內，建議回到本次要練習的商品說明與需求確認。",
    "zh-CN": "这个题目不在本次情境的核准范围内，建议回到本次要练习的产品说明与需求确认。",
    "en-US": "That topic is outside the approved scope for this scenario; return to the product at hand.",
}


def localised(table: dict[str, str], locale: str) -> str:
    if locale in table:
        return table[locale]
    root = locale.split("-", 1)[0].lower()
    for key, value in table.items():
        if key.split("-", 1)[0].lower() == root:
            return value
    return table["zh-TW"]


__all__ = [
    "CLARIFY_QUESTIONS",
    "KNOWLEDGE_SYSTEM",
    "REDIRECT_SCOPES",
    "UNCERTAINTY_STATEMENTS",
    "knowledge_system_prompt",
    "localised",
]
