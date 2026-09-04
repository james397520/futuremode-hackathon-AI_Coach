"""Deterministic detection primitives shared by intent / compliance / safety.

Why these live in `app/agents` rather than in the safety service: the intent pipeline
(agents) and the authoritative `SafetyService` (services) must agree byte-for-byte on
what counts as an injection attempt or a piece of PII, and `services` may import
`agents` while the reverse would be circular. The service layer stays authoritative —
it *decides* — but it decides using this one shared rule pack (spec §40.1/§40.2).

All patterns are locale-aware for zh-TW/zh-CN/en, deliberately regex-based (no model
call) so they are fast enough to run on every turn and fully reproducible in tests.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum

# ---------------------------------------------------------------------------
# text normalisation (typo / full-width / spacing tolerance — spec §21)
# ---------------------------------------------------------------------------
_WS = re.compile(r"\s+")
_ZH_PUNCT = str.maketrans({"，": ",", "。": ".", "！": "!", "？": "?", "；": ";", "：": ":"})


def normalize(text: str) -> str:
    """NFKC-fold, collapse whitespace, unify punctuation. Case is preserved."""
    folded = unicodedata.normalize("NFKC", text or "")
    folded = folded.translate(_ZH_PUNCT)
    return _WS.sub(" ", folded).strip()


def fold(text: str) -> str:
    """Aggressive fold for keyword matching: normalised + lowercase + spaces removed.

    Removing spaces defeats the common `i g n o r e   p r e v i o u s` evasion and
    also makes Chinese matching insensitive to stray spaces from voice transcription.
    """
    return normalize(text).lower().replace(" ", "")


# ---------------------------------------------------------------------------
# rule pack
# ---------------------------------------------------------------------------
class RiskKind(StrEnum):
    """Internal detection kinds. Mapped to `ComplianceFindingType` by the caller.

    NOTE: `shared` `ComplianceFindingType` has no `jailbreak` member, so
    jailbreak detections are reported as `prompt_injection` with the policy rule
    `AI-SAFETY-JAILBREAK` to stay inside the published contract.
    """

    PROMPT_INJECTION = "prompt_injection"
    JAILBREAK = "jailbreak"
    ROLE_ESCAPE = "role_escape"
    DIRECT_ANSWER_REQUEST = "direct_answer_request"
    UNAUTHORIZED_KNOWLEDGE = "unauthorized_knowledge"
    PII = "pii"
    FALSE_PROMISE = "false_promise"
    MISLEADING_STATEMENT = "misleading_statement"
    UNSUPPORTED_CLAIM = "unsupported_claim"
    UNAUTHORIZED_ADVICE = "unauthorized_advice"
    SENSITIVE_INFORMATION = "sensitive_information"
    MISSING_DISCLOSURE = "missing_disclosure"
    RESTRICTED_TOPIC = "restricted_topic"
    OFF_TOPIC = "off_topic"
    TOOL_ABUSE = "tool_abuse"


@dataclass(frozen=True, slots=True)
class Rule:
    kind: RiskKind
    pattern: re.Pattern[str]
    policy_rule: str
    severity: str          # ComplianceRisk value
    #: match against `fold(text)` instead of `normalize(text)`
    folded: bool = True


def _r(
    kind: RiskKind,
    expr: str,
    policy_rule: str,
    severity: str = "medium",
    *,
    folded: bool = True,
) -> Rule:
    return Rule(kind, re.compile(expr, re.IGNORECASE), policy_rule, severity, folded)


#: Prompt injection / jailbreak (spec §40.1). Matched on the folded form.
INJECTION_RULES: tuple[Rule, ...] = (
    _r(RiskKind.PROMPT_INJECTION, r"ignore(all)?(the)?(previous|above|prior)(instructions?|prompts?)",
       "AI-SAFETY-INJECTION", "high"),
    _r(RiskKind.PROMPT_INJECTION, r"disregard(the)?(previous|above)", "AI-SAFETY-INJECTION", "high"),
    _r(RiskKind.PROMPT_INJECTION, r"(忽略|無視|不要理)(前面|上面|之前|以上|所有)?(的)?(指令|指示|規則|設定|提示)",
       "AI-SAFETY-INJECTION", "high"),
    _r(RiskKind.PROMPT_INJECTION, r"(show|reveal|print|repeat|輸出|顯示|告訴我)(me)?(your|the|你的)?(system)?"
       r"(prompt|instruction|指令|提示詞|系統設定)", "AI-SAFETY-INJECTION", "high"),
    _r(RiskKind.PROMPT_INJECTION, r"(you\s*are\s*now|from\s*now\s*on\s*you\s*are|你現在是|你不再是)",
       "AI-SAFETY-INJECTION", "medium"),
    _r(RiskKind.PROMPT_INJECTION, r"<\|?(im_start|system|endoftext)\|?>", "AI-SAFETY-INJECTION", "high"),
    _r(RiskKind.JAILBREAK, r"(developermode|開發者模式|god\s*mode|dan\s*mode|do\s*anything\s*now)",
       "AI-SAFETY-JAILBREAK", "high"),
    _r(RiskKind.JAILBREAK, r"(pretend|act\s*as\s*if|假裝)(you)?(have|had)?(no|沒有)(rules?|restrictions?|限制|規則)",
       "AI-SAFETY-JAILBREAK", "high"),
    _r(RiskKind.JAILBREAK, r"(沒有任何限制|不受任何限制|解除限制|越獄|jailbreak)",
       "AI-SAFETY-JAILBREAK", "high"),
    _r(RiskKind.TOOL_ABUSE, r"(執行|呼叫|call|invoke)(這個)?(工具|tool|function|api|指令列|shell|sql)",
       "AI-SAFETY-TOOL-POLICY", "high"),
)

#: Attempts to make the persona drop character, or to extract the answer key (§21).
ROLE_ESCAPE_RULES: tuple[Rule, ...] = (
    _r(RiskKind.ROLE_ESCAPE, r"(不要|別)(再)?(當|扮|演)(客戶|客人|角色)", "TRAIN-ROLE-01", "low"),
    _r(RiskKind.ROLE_ESCAPE, r"(跳出|離開|退出)(角色|扮演)", "TRAIN-ROLE-01", "low"),
    _r(RiskKind.ROLE_ESCAPE, r"(你是不是|你其實是|你到底是)(ai|人工智慧|機器人|chatgpt|模型)",
       "TRAIN-ROLE-01", "low"),
    _r(RiskKind.ROLE_ESCAPE, r"(stop|quit|drop)(the)?(roleplay|persona|character|act)",
       "TRAIN-ROLE-01", "low"),
    _r(RiskKind.DIRECT_ANSWER_REQUEST, r"(直接)?(告訴|給)我(標準)?(答案|正確答案|範例答案|話術稿)",
       "TRAIN-ROLE-02", "low"),
    _r(RiskKind.DIRECT_ANSWER_REQUEST, r"(幫我|替我)(寫|想|生成)(一整段|整段)?(話術|回答|台詞)",
       "TRAIN-ROLE-02", "low"),
    _r(RiskKind.DIRECT_ANSWER_REQUEST, r"(just)?(tell|give)me(the)?(right|correct|standard)?(answer)",
       "TRAIN-ROLE-02", "low"),
    _r(RiskKind.DIRECT_ANSWER_REQUEST, r"(這題|這個)(要|該)怎麼(回|答|說)才(對|正確)", "TRAIN-ROLE-02", "low"),
)

#: Asking for data the trainee is not authorised to see (spec §21, §39).
UNAUTHORIZED_KNOWLEDGE_RULES: tuple[Rule, ...] = (
    _r(RiskKind.UNAUTHORIZED_KNOWLEDGE, r"(其他|別的|隔壁)(客戶|學員|同事)的(資料|保單|成績|分數)",
       "KB-ACL-01", "high"),
    _r(RiskKind.UNAUTHORIZED_KNOWLEDGE, r"(內部|公司)(成本|底價|佣金|抽成|折讓)", "KB-ACL-02", "medium"),
    _r(RiskKind.UNAUTHORIZED_KNOWLEDGE, r"(未公開|機密|內部限閱|donotdistribute|confidential)",
       "KB-ACL-02", "high"),
    _r(RiskKind.UNAUTHORIZED_KNOWLEDGE, r"(hidden|隱藏)(need|需求|設定|state)", "TRAIN-ROLE-03", "medium"),
    _r(RiskKind.UNAUTHORIZED_KNOWLEDGE, r"(評分|rubric|評分表|scoring)(標準|規則|權重)", "TRAIN-ROLE-03",
       "medium"),
)

#: PII (spec §40.2). Matched on the *normalised* text so digit groups survive.
PII_RULES: tuple[Rule, ...] = (
    _r(RiskKind.PII, r"\b[A-Za-z][12]\d{8}\b", "PII-TW-ID", "high", folded=False),
    _r(RiskKind.PII, r"\b09\d{2}[- ]?\d{3}[- ]?\d{3}\b", "PII-TW-MOBILE", "high", folded=False),
    _r(RiskKind.PII, r"\b0\d{1,2}[- ]?\d{6,8}\b", "PII-TW-PHONE", "medium", folded=False),
    _r(RiskKind.PII, r"\b(?:\d[ -]?){13,16}\b", "PII-CARD", "high", folded=False),
    _r(RiskKind.PII, r"[\w.+-]+@[\w-]+\.[\w.]{2,}", "PII-EMAIL", "medium", folded=False),
    _r(RiskKind.PII, r"[一-鿿]{2,}(?:市|縣)[一-鿿]{1,}(?:區|鄉|鎮)"
       r"[一-鿿0-9]{1,}(?:路|街|大道)[0-9]{1,4}號", "PII-ADDRESS", "high", folded=False),
    _r(RiskKind.PII, r"\b[A-Z]{2}\d{7,10}\b", "PII-POLICY-NO", "medium", folded=False),
)

#: Compliance content risks (spec §32). Applied to trainee utterances.
COMPLIANCE_RULES: tuple[Rule, ...] = (
    _r(RiskKind.FALSE_PROMISE, r"(保證|一定|絕對|百分之百|100%)(會)?(賺|獲利|還本|保本|不會賠|通過|核保|理賠)",
       "FSC-ADV-01 不得保證獲利", "critical"),
    _r(RiskKind.FALSE_PROMISE, r"(穩賺|穩賺不賠|包賺|零風險|沒有風險|保證不會虧)",
       "FSC-ADV-01 不得保證獲利", "critical"),
    _r(RiskKind.FALSE_PROMISE, r"(guaranteed|guarantee)(returns?|profit|approval|payout)",
       "FSC-ADV-01", "critical"),
    _r(RiskKind.MISLEADING_STATEMENT, r"(跟|和|像)(定存|存款|銀行)(一樣)(安全|穩|保本)",
       "FSC-ADV-02 不得誤導性類比", "high"),
    _r(RiskKind.MISLEADING_STATEMENT, r"(不用看|不用管)(條款|合約|除外)", "FSC-ADV-02", "high"),
    _r(RiskKind.MISLEADING_STATEMENT, r"(隨時)(都)?可以(全額)?(解約|領回)(不會)?(損失|虧)",
       "FSC-ADV-02", "high"),
    _r(RiskKind.UNSUPPORTED_CLAIM, r"(業界|市場上|全台)(最|唯一)(高|好|便宜|強|划算)",
       "MKT-CLAIM-01 須有依據", "medium"),
    _r(RiskKind.UNSUPPORTED_CLAIM, r"(一定|絕對)(比)(別家|其他家|同業)(好|便宜|划算)", "MKT-CLAIM-01",
       "medium"),
    _r(RiskKind.UNSUPPORTED_CLAIM, r"(best|highest|cheapest)inthe(industry|market)", "MKT-CLAIM-01",
       "medium"),
    _r(RiskKind.UNAUTHORIZED_ADVICE, r"(把|將)(定存|股票|基金|房子)(全部|都)?(解約|賣掉|贖回|抵押)",
       "SUIT-01 越權財務指示", "high"),
    _r(RiskKind.UNAUTHORIZED_ADVICE, r"(這樣)?可以(節|逃|避)(稅|稅金)", "TAX-01 未授權稅務建議", "high"),
    _r(RiskKind.UNAUTHORIZED_ADVICE, r"(不用|不必)(申報|告知)(病史|既往症|收入)", "UW-01 誘導不實告知",
       "critical"),
    _r(RiskKind.SENSITIVE_INFORMATION, r"(病歷|診斷書|癌症|愛滋|hiv|精神科|重大傷病卡)",
       "PII-HEALTH", "high"),
    _r(RiskKind.SENSITIVE_INFORMATION, r"(內部文件|限閱|僅供內部|internalonly)", "SEC-DOC-01", "high"),
)

#: Signals that a required disclosure *was* made — absence of these next to a
#: recommendation is what raises `missing_disclosure` (spec §32).
DISCLOSURE_SIGNALS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"風險", r"除外", r"不保", r"審閱期", r"費用", r"手續費", r"可能(會)?(虧|損失)",
        r"投資有風險", r"以保單條款為準", r"risk", r"exclusion", r"fees?",
    )
)

#: A product recommendation / closing attempt, which triggers the disclosure check.
RECOMMENDATION_SIGNALS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"我(建議|推薦)你", r"你(可以|應該)(考慮|買|投保|加保)", r"這個(方案|商品)(很)?適合你",
        r"我們(現在)?(就)?(來)?(辦|簽|填)", r"要不要(現在)?(就)?(辦|簽)",
        r"i(would)?recommend", r"you\s*should\s*(buy|take|sign)",
    )
)

OFF_TOPIC_SIGNALS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"(天氣|颱風|下雨)", r"(總統|選舉|政治|政黨)", r"(股票|比特幣|虛擬貨幣)(明天|會不會)",
        r"(寫|幫我寫)(程式|code|python|sql)", r"(晚餐|午餐)吃什麼", r"(球賽|世界盃|nba)",
        r"(講|說)個(笑話|故事)", r"weather", r"tell\s*me\s*a\s*joke",
    )
)


@dataclass(frozen=True, slots=True)
class Detection:
    kind: RiskKind
    policy_rule: str
    severity: str
    evidence: str
    start: int
    end: int


def scan(text: str, rules: Iterable[Rule]) -> list[Detection]:
    """Run a rule pack over `text`, returning matches with *original-text* evidence.

    Folded rules match against a space-stripped copy, so the offsets are mapped back
    to the normalised string to keep `evidence` quotable in a compliance finding.
    """
    normalized = normalize(text)
    lowered = normalized.lower()
    folded_chars: list[int] = []
    folded_parts: list[str] = []
    for index, char in enumerate(lowered):
        if char == " ":
            continue
        folded_parts.append(char)
        folded_chars.append(index)
    folded_text = "".join(folded_parts)

    detections: list[Detection] = []
    for rule in rules:
        haystack = folded_text if rule.folded else normalized
        for match in rule.pattern.finditer(haystack):
            if rule.folded:
                if not folded_chars:
                    continue
                start = folded_chars[match.start()] if match.start() < len(folded_chars) else 0
                last = min(match.end(), len(folded_chars)) - 1
                end = folded_chars[max(last, 0)] + 1
            else:
                start, end = match.start(), match.end()
            evidence = normalized[start:end].strip() or match.group(0)
            detections.append(
                Detection(rule.kind, rule.policy_rule, rule.severity, evidence, start, end)
            )
    return detections


def any_match(text: str, patterns: Sequence[re.Pattern[str]]) -> bool:
    normalized = normalize(text)
    return any(p.search(normalized) for p in patterns)


def matched_topics(text: str, topics: Sequence[str]) -> list[str]:
    """Scenario-configured restricted topics (spec §17 / §32 `restricted_topic`)."""
    folded_text = fold(text)
    return [topic for topic in topics if topic and fold(topic) in folded_text]


SEVERITY_ORDER: dict[str, int] = {
    "safe": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4,
}


def max_severity(values: Iterable[str]) -> str:
    best = "safe"
    for value in values:
        if SEVERITY_ORDER.get(value, 0) > SEVERITY_ORDER.get(best, 0):
            best = value
    return best


__all__ = [
    "COMPLIANCE_RULES",
    "DISCLOSURE_SIGNALS",
    "INJECTION_RULES",
    "OFF_TOPIC_SIGNALS",
    "PII_RULES",
    "RECOMMENDATION_SIGNALS",
    "ROLE_ESCAPE_RULES",
    "SEVERITY_ORDER",
    "UNAUTHORIZED_KNOWLEDGE_RULES",
    "Detection",
    "RiskKind",
    "Rule",
    "any_match",
    "fold",
    "matched_topics",
    "max_severity",
    "normalize",
    "scan",
]
