"""Conditional retrieval and a conservative, local compliance screening stage."""
import re


def retrieval_query(message, history):
    text = re.sub(r"[\s，。！？!?、~～]", "", message)
    if re.fullmatch(r"(你好|您好|嗨|哈囉|早安|午安|晚安|謝謝|謝謝你|不客氣|再見|hello|hi)+", text, re.I):
        return None
    risk_words = ("保本", "保證", "獲利", "不會賠", "虧", "本金", "風險", "市場", "報酬")
    # Resolve short answers such as '對啊' against the customer's last question.
    context = ""
    if len(text) <= 8 and history:
        context = history[-1]["content"]
    if any(word in message + context for word in risk_words):
        return message + " 風險揭露 本金損失 不保本 不保證獲利"
    return (context + " " + message).strip()


def screen_compliance(message, turn, sources, history=()):
    """Candidate flags only; no legal verdict or automatic numeric penalty."""
    flags = []
    patterns = [r"(?:一定|絕對)?不會(?:賠|虧損|虧)", r"保證(?:獲利|收益|賺錢)", r"保本"]
    for clause in re.split(r"[，,。；;！!\n]", message):
        # Keep explicit denials and descriptions of prohibited wording out of positive claims.
        if re.search(r"不保本|(?:不|不能|無法|不得|沒有|並非|不是|不可|不應|禁止).{0,8}(?:保證|保本|不會賠)", clause):
            continue
        if re.search(r"[？?]|是否|能否|[嗎呢]\s*$|[「『\"]", clause):
            continue
        for pattern in patterns:
            match = re.search(pattern, clause)
            if match:
                flags.append(dict(turn=turn, category="疑似保本／獲利承諾", quote=clause.strip(),
                    trigger=match.group(), status="needs_review", method="local_rules",
                    reason="偵測到可能的絕對承諾，需結合上下文與產品條款確認；不是違法判定。",
                    source_ids=[s["id"] for s in sources], evidence_status="retrieved_context" if sources else "missing"))
                break
    if not flags and re.fullmatch(r"\s*(對|對啊|是|是的|沒錯)[。！!\s]*", message) and history:
        question = history[-1]["content"]
        if re.search(r"保證獲利|保本|不會賠|完全不會|完全不受", question):
            flags.append(dict(turn=turn, category="疑似確認絕對承諾", quote=message.strip(),
                trigger="肯定前句", status="needs_review", method="local_rules",
                reason="肯定客戶對絕對承諾的追問，需人工核對上下文：" + question,
                source_ids=[s["id"] for s in sources], evidence_status="retrieved_context" if sources else "missing"))
    return flags
