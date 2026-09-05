"""Fictional customer facts, separate from product knowledge and compliance rules."""
import re

PROFILES = {
    "cautious": dict(label="保守型客戶", capital="30 萬元", loss="5%", loss_money="1 萬 5 千元",
        horizon="3 年", experience="只存過定存，沒有買過基金", goal="讓存款稍微增值，優先控制本金損失",
        opening="你好，我有一筆存款想了解基金，但很在意本金會不會虧損。",
        liquidity="生活費和六個月緊急預備金已另外留好，這筆錢三年內不急著用"),
    "aggressive": dict(label="積極型客戶", capital="100 萬元", loss="20%", loss_money="20 萬元",
        horizon="5 年以上", experience="有五年股票和基金投資經驗，遇過市場下跌", goal="追求長期資產成長，願意接受較大波動",
        opening="你好，我想找長期成長型的基金，可以接受波動，但想先弄清楚風險和費用。",
        liquidity="生活費和緊急預備金已另外留好，這筆錢五年內沒有固定支出用途"),
}
PERSONAS = {
    **{key: value["label"] + "（虛構培訓角色）" for key, value in PROFILES.items()},
    "fee_sensitive": "質疑費用的客戶：有投資經驗，追問手續費和贖回時間。",
    "short_term": "需要短期資金的客戶：三個月後需要用錢，希望保本。",
}


def profile_answer(message, history, persona):
    """Answer personal facts deterministically; product claims still go through RAG/model."""
    profile = PROFILES.get(persona)
    if not profile:
        return None
    text = re.sub(r"\s+", "", message)
    # Product questions and statements must not be mistaken for personal fact collection.
    if re.search(r"(?:這|該|我們|本)(?:個|支|項|家)?(?:基金|產品)|保證獲利|一定不會賠|不保本", text):
        return None
    if re.fullmatch(r"(?:你|妳|您)好[。！!～~]*", text):
        return profile["opening"]
    answers = []
    if re.search(r"承受|接受.*(?:損失|虧損|風險)|(?:幾|多少)[%％]|風險偏好", text):
        answers.append(f"我最多能接受這筆投資虧損約 {profile['loss']}，也就是 {profile['loss_money']}；超過就會想重新評估。")
    if re.search(r"(?:多少|幾).*(?:錢|資金|本金|預算)|(?:資金|本金|預算).*(?:多少|幾)|可投資金額", text):
        answers.append(f"我這次可以拿出 {profile['capital']} 投資，這是可投資金額，不是全部財產。")
    if re.search(r"多久|幾年|期限|投資期間|持有期間|何時.*用錢", text):
        answers.append(f"我預計持有 {profile['horizon']}。")
    if re.search(r"經驗|買過|投資過", text):
        answers.append(f"我{profile['experience']}。")
    if re.search(r"預備金|生活費|急用|緊急|資金需求", text):
        answers.append(f"我{profile['liquidity']}。")
    if not answers and re.search(r"需求|需要什麼|什麼幫助|投資目標|目的是|想要什麼", text):
        answers.append(f"我想{profile['goal']}，預計投資 {profile['capital']}。")
    if not answers:
        return None
    answer = "".join(answers)
    if any(item["role"] == "assistant" and item["content"] == answer for item in history):
        return "我的條件和剛才一樣：" + answer
    return answer
