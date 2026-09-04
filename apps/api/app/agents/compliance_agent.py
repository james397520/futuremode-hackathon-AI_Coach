"""Compliance Agent — §19.5, §32, §40.1.

Two-tier detector:

* **Rule tier** (`fast_path`) — the shared regex pack in `app.agents.patterns`. Runs
  on every turn, needs no model, and is the tier the orchestrator uses *before* the
  persona speaks so an injection or a guaranteed-return promise is caught even if the
  model layer is unavailable.
* **Model tier** (`run`) — catches the paraphrased cases regexes miss (an implied
  promise, an omitted disclosure). Its findings are only kept when the quoted evidence
  really occurs in the audited text: a finding the agent cannot point at is dropped,
  so the §32 "transcript evidence" column can never be fabricated.

`ComplianceFindingType` in shared-types has no `jailbreak` member, so jailbreak
detections are reported as `prompt_injection` carrying the policy rule
`AI-SAFETY-JAILBREAK` (see `patterns.RiskKind`).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from enum import StrEnum
from typing import Any, Final

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import Agent
from app.agents.llm_client import ModelPurpose
from app.agents.patterns import (
    COMPLIANCE_RULES,
    DISCLOSURE_SIGNALS,
    INJECTION_RULES,
    PII_RULES,
    RECOMMENDATION_SIGNALS,
    ROLE_ESCAPE_RULES,
    RiskKind,
    any_match,
    fold,
    matched_topics,
    max_severity,
    normalize,
    scan,
)
from app.agents.prompts.common import data_block, schema_block, untrusted_block
from app.agents.prompts.compliance import compliance_system_prompt

log = structlog.get_logger(__name__)


class FindingType(StrEnum):
    """Mirrors `ComplianceFindingType` in packages/shared-types/src/entities.ts."""

    FALSE_PROMISE = "false_promise"
    MISLEADING_STATEMENT = "misleading_statement"
    UNSUPPORTED_CLAIM = "unsupported_claim"
    PRIVACY_ISSUE = "privacy_issue"
    UNAUTHORIZED_ADVICE = "unauthorized_advice"
    SENSITIVE_INFORMATION = "sensitive_information"
    MISSING_DISCLOSURE = "missing_disclosure"
    PROMPT_INJECTION = "prompt_injection"
    RESTRICTED_TOPIC = "restricted_topic"


class Subject(StrEnum):
    TRAINEE = "trainee"
    PERSONA = "persona"
    SYSTEM = "system"


#: RiskKind -> published finding type. Jailbreak and tool abuse fold into
#: `prompt_injection` because the contract has no separate member for them.
KIND_TO_TYPE: Final[dict[RiskKind, FindingType]] = {
    RiskKind.FALSE_PROMISE: FindingType.FALSE_PROMISE,
    RiskKind.MISLEADING_STATEMENT: FindingType.MISLEADING_STATEMENT,
    RiskKind.UNSUPPORTED_CLAIM: FindingType.UNSUPPORTED_CLAIM,
    RiskKind.PII: FindingType.PRIVACY_ISSUE,
    RiskKind.UNAUTHORIZED_ADVICE: FindingType.UNAUTHORIZED_ADVICE,
    RiskKind.SENSITIVE_INFORMATION: FindingType.SENSITIVE_INFORMATION,
    RiskKind.MISSING_DISCLOSURE: FindingType.MISSING_DISCLOSURE,
    RiskKind.PROMPT_INJECTION: FindingType.PROMPT_INJECTION,
    RiskKind.JAILBREAK: FindingType.PROMPT_INJECTION,
    RiskKind.TOOL_ABUSE: FindingType.PROMPT_INJECTION,
    RiskKind.ROLE_ESCAPE: FindingType.PROMPT_INJECTION,
    RiskKind.DIRECT_ANSWER_REQUEST: FindingType.PROMPT_INJECTION,
    RiskKind.RESTRICTED_TOPIC: FindingType.RESTRICTED_TOPIC,
    RiskKind.UNAUTHORIZED_KNOWLEDGE: FindingType.SENSITIVE_INFORMATION,
}

#: Explanations + corrections for the rule tier, so a rule-only finding is as useful
#: as a model one (spec §32 requires explanation + suggested correction).
RULE_GUIDANCE: Final[dict[FindingType, tuple[str, str]]] = {
    FindingType.FALSE_PROMISE: (
        "對商品績效或核保結果作出保證，屬於不得為之的承諾。",
        "改為說明「依商品條款與宣告利率，實際結果可能變動」，並提供歷史數據來源。",
    ),
    FindingType.MISLEADING_STATEMENT: (
        "以誤導性類比或省略重要條件描述商品，可能使客戶誤判風險。",
        "明確區分商品與存款的差異，並主動說明可能的損失情境。",
    ),
    FindingType.UNSUPPORTED_CLAIM: (
        "使用最高級或比較級宣稱但未提供可查證依據。",
        "若要比較，須引用可查證的公開資料來源與比較基準日。",
    ),
    FindingType.PRIVACY_ISSUE: (
        "對話中出現個人資料，可能違反個資法與內部遮蔽規範。",
        "不要在演練中使用真實個資；必要欄位以遮蔽格式表示。",
    ),
    FindingType.UNAUTHORIZED_ADVICE: (
        "提供超出授權範圍的財務、稅務、法律或醫療具體指示。",
        "改為說明一般性原則，並建議客戶洽詢具備資格的專業人士。",
    ),
    FindingType.SENSITIVE_INFORMATION: (
        "涉及敏感個人資訊或未公開的內部資料。",
        "移除敏感內容，僅使用已核准對外的說法。",
    ),
    FindingType.MISSING_DISCLOSURE: (
        "已進行商品推薦但未揭露風險、費用或除外責任。",
        "在推薦後補上風險、費用與除外責任說明，並確認客戶理解。",
    ),
    FindingType.PROMPT_INJECTION: (
        "輸入含有操控 AI 或跳脫角色設定的企圖。",
        "系統已忽略該指令並維持模擬情境；此事件已記錄以供審計。",
    ),
    FindingType.RESTRICTED_TOPIC: (
        "命中本情境明訂的禁談主題。",
        "將話題導回本次演練核准的商品與需求範圍。",
    ),
}


class ComplianceFindingDraft(BaseModel):
    """Mirrors the `ComplianceFinding` entity's authored fields (§32)."""

    model_config = ConfigDict(extra="forbid")

    type: FindingType
    severity: str = "medium"                  # ComplianceRisk
    subject: Subject = Subject.TRAINEE
    timestamp_ms: int = 0
    transcript_turn_id: str | None = None
    evidence: str = ""
    policy_rule: str | None = None
    explanation: str = ""
    suggested_correction: str | None = None
    detector: str = "rule"                    # rule | model

    def dedupe_key(self) -> tuple[str, str, str]:
        return (str(self.type), str(self.subject), fold(self.evidence)[:40])


class ComplianceResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    findings: list[ComplianceFindingDraft] = Field(default_factory=list)
    overall_risk: str = "safe"
    #: hard stop: the turn must not reach the persona agent
    blocked: bool = False
    injection_detected: bool = False
    rejected_model_findings: int = 0

    @property
    def has_critical(self) -> bool:
        return any(f.severity in ("high", "critical") for f in self.findings)


class ComplianceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trainee_text: str = ""
    persona_text: str = ""
    trainee_turn_id: str | None = None
    persona_turn_id: str | None = None
    timestamp_ms: int = 0
    locale: str = "zh-TW"
    restricted_topics: list[str] = Field(default_factory=list)
    compliance_rules: list[str] = Field(default_factory=list)
    required_disclosures: list[str] = Field(default_factory=list)
    #: transcript context, so an omitted disclosure can be judged over the session
    disclosure_made_earlier: bool = False


class ComplianceAgent(Agent[ComplianceRequest, ComplianceResult]):
    name = "compliance"
    purpose = ModelPurpose.COMPLIANCE
    output_model = ComplianceResult
    optional = True
    default_temperature = 0.0
    default_max_tokens = 1200

    # -- rule tier ---------------------------------------------------------
    def fast_path(self, request: ComplianceRequest) -> ComplianceResult:
        """Model-free pre-check. Safe to run on the hot path of every turn."""
        findings: list[ComplianceFindingDraft] = []
        findings += self._rule_findings(
            request.trainee_text,
            Subject.TRAINEE,
            request.trainee_turn_id,
            request,
            rules=(*INJECTION_RULES, *ROLE_ESCAPE_RULES, *COMPLIANCE_RULES, *PII_RULES),
        )
        findings += self._restricted(request.trainee_text, Subject.TRAINEE, request)
        findings += self._missing_disclosure(request)
        injection = any(
            f.type is FindingType.PROMPT_INJECTION
            and f.policy_rule
            and f.policy_rule.startswith("AI-SAFETY")
            for f in findings
        )
        deduped = _dedupe(findings)
        return ComplianceResult(
            findings=deduped,
            overall_risk=max_severity([f.severity for f in deduped]),
            blocked=any(
                f.severity == "critical" and f.type is FindingType.PROMPT_INJECTION
                for f in deduped
            )
            or any(
                f.policy_rule in ("AI-SAFETY-INJECTION", "AI-SAFETY-JAILBREAK", "AI-SAFETY-TOOL-POLICY")
                and f.severity in ("high", "critical")
                for f in deduped
            ),
            injection_detected=injection,
        )

    def audit_persona_output(self, request: ComplianceRequest) -> ComplianceResult:
        """Post-check of the AI persona's own utterance (spec §40.1 output moderation)."""
        findings = self._rule_findings(
            request.persona_text,
            Subject.PERSONA,
            request.persona_turn_id,
            request,
            rules=(*COMPLIANCE_RULES, *PII_RULES),
        )
        findings += self._restricted(request.persona_text, Subject.PERSONA, request)
        deduped = _dedupe(findings)
        return ComplianceResult(
            findings=deduped,
            overall_risk=max_severity([f.severity for f in deduped]),
        )

    def _rule_findings(
        self,
        text: str,
        subject: Subject,
        turn_id: str | None,
        request: ComplianceRequest,
        *,
        rules: Sequence[Any],
    ) -> list[ComplianceFindingDraft]:
        if not text.strip():
            return []
        out: list[ComplianceFindingDraft] = []
        for detection in scan(text, rules):
            finding_type = KIND_TO_TYPE.get(detection.kind)
            if finding_type is None:
                continue
            explanation, correction = RULE_GUIDANCE.get(finding_type, ("", None))
            out.append(
                ComplianceFindingDraft(
                    type=finding_type,
                    severity=detection.severity,
                    subject=subject,
                    timestamp_ms=request.timestamp_ms,
                    transcript_turn_id=turn_id,
                    evidence=detection.evidence,
                    policy_rule=detection.policy_rule,
                    explanation=explanation,
                    suggested_correction=correction,
                    detector="rule",
                )
            )
        return out

    def _restricted(
        self, text: str, subject: Subject, request: ComplianceRequest
    ) -> list[ComplianceFindingDraft]:
        hits = matched_topics(text, request.restricted_topics)
        explanation, correction = RULE_GUIDANCE[FindingType.RESTRICTED_TOPIC]
        return [
            ComplianceFindingDraft(
                type=FindingType.RESTRICTED_TOPIC,
                severity="medium",
                subject=subject,
                timestamp_ms=request.timestamp_ms,
                transcript_turn_id=(
                    request.trainee_turn_id if subject is Subject.TRAINEE
                    else request.persona_turn_id
                ),
                evidence=topic,
                policy_rule="SCENARIO-RESTRICTED-TOPIC",
                explanation=explanation,
                suggested_correction=correction,
                detector="rule",
            )
            for topic in hits
        ]

    def _missing_disclosure(self, request: ComplianceRequest) -> list[ComplianceFindingDraft]:
        """A recommendation with no risk/fee/exclusion language anywhere near it."""
        text = request.trainee_text
        if not text.strip() or request.disclosure_made_earlier:
            return []
        if not any_match(text, RECOMMENDATION_SIGNALS):
            return []
        if any_match(text, DISCLOSURE_SIGNALS):
            return []
        missing = [d for d in request.required_disclosures if fold(d) not in fold(text)]
        explanation, correction = RULE_GUIDANCE[FindingType.MISSING_DISCLOSURE]
        return [
            ComplianceFindingDraft(
                type=FindingType.MISSING_DISCLOSURE,
                severity="medium",
                subject=Subject.TRAINEE,
                timestamp_ms=request.timestamp_ms,
                transcript_turn_id=request.trainee_turn_id,
                evidence=normalize(text)[:120],
                policy_rule="DISCLOSURE-01 推薦時應揭露風險與費用",
                explanation=(
                    explanation
                    + (f" 未提及：{', '.join(missing[:4])}" if missing else "")
                ),
                suggested_correction=correction,
                detector="rule",
            )
        ]

    # -- model tier --------------------------------------------------------
    def system_prompt(self) -> str:
        return compliance_system_prompt(self.locale)

    def build_user_prompt(self, request: ComplianceRequest) -> str:
        return "\n\n".join(
            [
                data_block(
                    "policy",
                    {
                        "compliance_rules": request.compliance_rules,
                        "restricted_topics": request.restricted_topics,
                        "required_disclosures": request.required_disclosures,
                        "disclosure_made_earlier": request.disclosure_made_earlier,
                    },
                ),
                untrusted_block("trainee_utterance", request.trainee_text),
                untrusted_block("ai_customer_utterance", request.persona_text),
                schema_block(self._schema(), name=self.output_model.__name__),
            ]
        )

    async def run(self, request: ComplianceRequest) -> ComplianceResult:
        """Rule tier + model tier, merged. Rule findings always survive."""
        rules_result = self.fast_path(request)
        persona_result = self.audit_persona_output(request)
        baseline = [*rules_result.findings, *persona_result.findings]

        model_result = await self.safe_run_model(request)
        kept: list[ComplianceFindingDraft] = []
        rejected = 0
        if model_result is not None:
            for finding in model_result.findings:
                if self._evidence_is_real(finding, request):
                    kept.append(finding.model_copy(update={"detector": "model"}))
                else:
                    rejected += 1
        if rejected:
            log.warning("compliance.model_finding_rejected", count=rejected)

        merged = _dedupe([*baseline, *kept])
        return ComplianceResult(
            findings=merged,
            overall_risk=max_severity([f.severity for f in merged]),
            blocked=rules_result.blocked,
            injection_detected=rules_result.injection_detected,
            rejected_model_findings=rejected,
        )

    async def safe_run_model(self, request: ComplianceRequest) -> ComplianceResult | None:
        """The model leg, degrading to None (spec §49.4) — rules still apply."""
        try:
            return await self._invoke_structured(self._messages(request))
        except Exception as exc:  # noqa: BLE001 - never let the model tier fail a turn
            log.warning("compliance.model_leg_failed", error=repr(exc))
            return None

    @staticmethod
    def _evidence_is_real(finding: ComplianceFindingDraft, request: ComplianceRequest) -> bool:
        """No quote, no finding (spec §32 requires transcript evidence)."""
        quote = fold(finding.evidence)
        if len(quote) < 3:
            return False
        return quote in fold(request.trainee_text) or quote in fold(request.persona_text)


def _dedupe(findings: Sequence[ComplianceFindingDraft]) -> list[ComplianceFindingDraft]:
    order = {"safe": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    best: dict[tuple[str, str, str], ComplianceFindingDraft] = {}
    for finding in findings:
        key = finding.dedupe_key()
        current = best.get(key)
        if current is None or order.get(finding.severity, 0) > order.get(current.severity, 0):
            best[key] = finding
    return sorted(
        best.values(),
        key=lambda f: (-order.get(f.severity, 0), str(f.type)),
    )


def to_domain_finding(
    draft: ComplianceFindingDraft, *, session_id: str, finding_id: str | None = None
) -> dict[str, Any]:
    """Shape a draft as the `ComplianceFinding` entity (§32) for persistence."""
    return {
        "id": finding_id or f"cf_{uuid.uuid4().hex[:12]}",
        "session_id": session_id,
        "type": str(draft.type),
        "severity": draft.severity,
        "timestamp_ms": draft.timestamp_ms,
        "transcript_turn_id": draft.transcript_turn_id,
        "evidence": draft.evidence,
        "policy_rule": draft.policy_rule,
        "explanation": draft.explanation,
        "suggested_correction": draft.suggested_correction,
        "reviewer_status": "open",
    }


__all__ = [
    "KIND_TO_TYPE",
    "RULE_GUIDANCE",
    "ComplianceAgent",
    "ComplianceFindingDraft",
    "ComplianceRequest",
    "ComplianceResult",
    "FindingType",
    "Subject",
    "to_domain_finding",
]
