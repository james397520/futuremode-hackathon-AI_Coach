"""`SafetyService` — the authoritative safety layer (spec §40, Part II §55).

    Browser (local pre-check)  ->  advisory only
    SafetyService              ->  authoritative

Part II §55 lets the browser run a first pass (PII patterns, restricted keywords, an
injection heuristic) on a small local model. This service treats that as a *hint*: it
re-runs every check server-side and its verdict wins. A client that claims "safe" is
never believed; a client that claims "unsafe" is recorded but still re-verified, so a
buggy or hostile client can neither bypass nor trigger a block on its own.

Covers §40.1 (prompt injection, jailbreak, out-of-scope, unauthorised tool call, tool
permission policy, output moderation, model abuse) and the detection/masking half of
§40.2 (PII detection, sensitive data masking) — encryption, secrets and signed URLs
are infrastructure concerns owned elsewhere.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from enum import StrEnum
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.patterns import (
    COMPLIANCE_RULES,
    INJECTION_RULES,
    PII_RULES,
    ROLE_ESCAPE_RULES,
    UNAUTHORIZED_KNOWLEDGE_RULES,
    Detection,
    RiskKind,
    fold,
    matched_topics,
    max_severity,
    normalize,
    scan,
)
from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.services.base import BaseService
from app.services.exceptions import SafetyBlockedError
from app.services.repository import Repository, RepositoryPort

log = structlog.get_logger(__name__)

MASK = "[已遮蔽]"
MASK_EN = "[MASKED]"

#: Detections that stop a turn outright rather than merely flagging it.
BLOCKING_KINDS: frozenset[RiskKind] = frozenset(
    {RiskKind.PROMPT_INJECTION, RiskKind.JAILBREAK, RiskKind.TOOL_ABUSE}
)


class SafetyFlag(StrEnum):
    """Values are kept identical to `app.agents.intent.SafetyFlag` on purpose: the
    intent pipeline folds this service's flags straight into its decision."""

    PROMPT_INJECTION = "prompt_injection"
    JAILBREAK = "jailbreak"
    ROLE_ESCAPE = "role_escape"
    ANSWER_KEY_REQUEST = "answer_key_request"
    UNAUTHORIZED_KNOWLEDGE = "unauthorized_knowledge"
    PII_IN_INPUT = "pii_in_input"
    RESTRICTED_TOPIC = "restricted_topic"
    TOOL_ABUSE = "tool_abuse"


_FLAG_FOR_KIND: dict[RiskKind, SafetyFlag] = {
    RiskKind.PROMPT_INJECTION: SafetyFlag.PROMPT_INJECTION,
    RiskKind.JAILBREAK: SafetyFlag.JAILBREAK,
    RiskKind.ROLE_ESCAPE: SafetyFlag.ROLE_ESCAPE,
    RiskKind.DIRECT_ANSWER_REQUEST: SafetyFlag.ANSWER_KEY_REQUEST,
    RiskKind.UNAUTHORIZED_KNOWLEDGE: SafetyFlag.UNAUTHORIZED_KNOWLEDGE,
    RiskKind.PII: SafetyFlag.PII_IN_INPUT,
    RiskKind.TOOL_ABUSE: SafetyFlag.TOOL_ABUSE,
}


class PiiMatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule: str
    evidence: str
    start: int
    end: int


class Screening(BaseModel):
    """Result of an input screen. Consumed by `IntentPipeline._apply_screening`."""

    model_config = ConfigDict(extra="forbid")

    blocked: bool = False
    flags: list[SafetyFlag] = Field(default_factory=list)
    severity: str = "safe"
    #: text with PII masked — safe to log, store or send to a model
    masked_text: str = ""
    pii: list[PiiMatch] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    restricted_topics: list[str] = Field(default_factory=list)
    #: what the browser claimed, for telemetry only (Part II §55)
    client_claim: str | None = None
    client_agreed: bool = True
    reason: str = ""


class ModerationVerdict(BaseModel):
    """Output moderation for anything the platform is about to *emit* (§40.1)."""

    model_config = ConfigDict(extra="forbid")

    allowed: bool = True
    severity: str = "safe"
    reasons: list[str] = Field(default_factory=list)
    masked_text: str = ""


class ToolPolicyVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allowed: bool = False
    reason: str = ""


#: §40.1 tool permission policy. The agent layer has no tool-calling surface today;
#: this allow-list is the gate any future tool must pass, keyed by role.
TOOL_POLICY: dict[str, tuple[str, ...]] = {
    "retrieval.search": ("trainee", "coach", "manager", "admin", "reviewer"),
    "knowledge.read": ("trainee", "coach", "manager", "admin", "reviewer"),
    "question.generate": ("coach", "admin"),
    "mining.run": ("coach", "admin"),
    "report.export": ("coach", "manager", "admin", "reviewer"),
    "session.replay": ("trainee", "coach", "manager", "admin", "reviewer"),
}


class SafetyService(BaseService):
    """`Service(db_session, ctx)`."""

    def __init__(
        self,
        db: Any,
        ctx: RequestContext,
        *,
        repo: RepositoryPort | None = None,
        abuse_window: int = 20,
    ) -> None:
        super().__init__(db, ctx)
        self.repo: RepositoryPort = repo or Repository(
            db, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )
        self._abuse_window = abuse_window
        self._recent_flags: list[SafetyFlag] = []

    # ------------------------------------------------------------------
    # input screening
    # ------------------------------------------------------------------
    async def screen_input(
        self,
        text: str,
        *,
        restricted_topics: Sequence[str] = (),
        locale: str = "zh-TW",
        client_claim: str | None = None,
    ) -> Screening:
        """Authoritative input screen. Signature matches `agents.intent.SafetyPort`."""
        body = normalize(text)
        detections: list[Detection] = [
            *scan(body, INJECTION_RULES),
            *scan(body, ROLE_ESCAPE_RULES),
            *scan(body, UNAUTHORIZED_KNOWLEDGE_RULES),
            *scan(body, PII_RULES),
        ]
        flags: list[SafetyFlag] = []
        for detection in detections:
            flag = _FLAG_FOR_KIND.get(detection.kind)
            if flag is not None and flag not in flags:
                flags.append(flag)

        topics = matched_topics(body, restricted_topics)
        if topics and SafetyFlag.RESTRICTED_TOPIC not in flags:
            flags.append(SafetyFlag.RESTRICTED_TOPIC)

        blocked = any(detection.kind in BLOCKING_KINDS for detection in detections)
        severity = max_severity([d.severity for d in detections] or ["safe"])
        masked, pii = self.mask_pii(body, locale=locale)

        self._recent_flags.extend(flags)
        self._recent_flags = self._recent_flags[-self._abuse_window :]
        if self.detect_abuse():
            blocked = True
            severity = "critical"

        screening = Screening(
            blocked=blocked,
            flags=flags,
            severity=severity,
            masked_text=masked,
            pii=pii,
            evidence=[d.evidence for d in detections][:10],
            restricted_topics=topics,
            client_claim=client_claim,
            client_agreed=_client_agrees(client_claim, blocked),
            reason=(
                "server-side detection: "
                + ", ".join(sorted({str(d.kind) for d in detections}))
                if detections
                else ""
            ),
        )
        if blocked:
            # Audited as `denied` so §42 shows the attempt even though the session
            # continues in character (§8.2).
            self.audit(
                "safety.input_blocked",
                "session_input",
                result="denied",
                risk=severity,
                flags=[str(f) for f in flags],
            )
        return screening

    def precheck_hint(self, client_payload: Any) -> str | None:
        """Extract the browser's claim from a client command. **Advisory only.**"""
        if client_payload is None:
            return None
        if isinstance(client_payload, str):
            return client_payload
        return str(
            getattr(client_payload, "verdict", None)
            or (client_payload.get("verdict") if isinstance(client_payload, dict) else "")
            or ""
        ) or None

    def require_safe(self, screening: Screening) -> None:
        """For non-conversational entry points (upload titles, question prompts…)."""
        if screening.blocked:
            raise SafetyBlockedError(
                "input was blocked by the safety layer", detail={"flags": screening.flags}
            )

    # ------------------------------------------------------------------
    # PII (§40.2)
    # ------------------------------------------------------------------
    def mask_pii(self, text: str, *, locale: str = "zh-TW") -> tuple[str, list[PiiMatch]]:
        """Mask every PII span, right-to-left so offsets stay valid."""
        body = normalize(text)
        matches = sorted(scan(body, PII_RULES), key=lambda d: d.start, reverse=True)
        token = MASK if locale.startswith("zh") else MASK_EN
        found: list[PiiMatch] = []
        for detection in matches:
            found.append(
                PiiMatch(
                    rule=detection.policy_rule,
                    evidence=detection.evidence,
                    start=detection.start,
                    end=detection.end,
                )
            )
            body = body[: detection.start] + token + body[detection.end :]
        found.reverse()
        return body, found

    def detect_pii(self, text: str) -> list[PiiMatch]:
        _masked, found = self.mask_pii(text)
        return found

    def scrub_for_logging(self, text: str) -> str:
        """§49.5: telemetry must never carry sensitive content."""
        masked, _ = self.mask_pii(text)
        return masked

    # ------------------------------------------------------------------
    # output moderation (§40.1)
    # ------------------------------------------------------------------
    async def moderate_output(
        self,
        text: str,
        *,
        restricted_topics: Sequence[str] = (),
        forbidden_knowledge: Sequence[str] = (),
        locale: str = "zh-TW",
    ) -> ModerationVerdict:
        """Screen anything the platform is about to show or say."""
        body = normalize(text)
        reasons: list[str] = []
        severities: list[str] = []

        for detection in scan(body, COMPLIANCE_RULES):
            reasons.append(f"{detection.kind}:{detection.evidence[:40]}")
            severities.append(detection.severity)
        pii = self.detect_pii(body)
        if pii:
            reasons.extend(f"pii:{match.rule}" for match in pii)
            severities.append("high")
        topics = matched_topics(body, restricted_topics)
        reasons.extend(f"restricted_topic:{topic}" for topic in topics)
        if topics:
            severities.append("medium")
        folded = fold(body)
        for item in forbidden_knowledge:
            if item and fold(item) in folded:
                reasons.append(f"forbidden_knowledge:{item[:30]}")
                severities.append("critical")
        if _leaks_system_prompt(body):
            reasons.append("system_prompt_leak")
            severities.append("critical")

        severity = max_severity(severities or ["safe"])
        masked, _ = self.mask_pii(body, locale=locale)
        allowed = severity not in ("high", "critical")
        if not allowed:
            self.audit(
                "safety.output_blocked", "agent_output", result="denied", risk=severity
            )
        return ModerationVerdict(
            allowed=allowed, severity=severity, reasons=reasons, masked_text=masked
        )

    # ------------------------------------------------------------------
    # tool policy + abuse (§40.1)
    # ------------------------------------------------------------------
    def check_tool_call(self, tool_name: str) -> ToolPolicyVerdict:
        """Unauthorised tool-call prevention: deny by default."""
        allowed_roles = TOOL_POLICY.get(tool_name)
        if allowed_roles is None:
            self.audit(
                "safety.tool_denied", f"tool:{tool_name}", result="denied", risk="high"
            )
            return ToolPolicyVerdict(
                allowed=False, reason=f"tool '{tool_name}' is not on the allow-list"
            )
        if not self.has_role(*allowed_roles):
            self.audit(
                "safety.tool_denied", f"tool:{tool_name}", result="denied", risk="medium"
            )
            return ToolPolicyVerdict(
                allowed=False,
                reason=f"role {sorted(self.roles)} may not call '{tool_name}'",
            )
        return ToolPolicyVerdict(allowed=True, reason="")

    def detect_abuse(self) -> bool:
        """Model-abuse detection: repeated injection attempts in one session."""
        attempts = sum(
            1
            for flag in self._recent_flags
            if flag in (SafetyFlag.PROMPT_INJECTION, SafetyFlag.JAILBREAK)
        )
        return attempts >= 3

    # ------------------------------------------------------------------
    # retention (§40.2) — the policy; `workers.retention_jobs` executes it
    # ------------------------------------------------------------------
    def retention_policy(self) -> dict[str, int]:
        """Days to keep each class of data. Overridable per tenant in settings."""
        from contextlib import suppress

        defaults = {
            "transcript_days": 365,
            "audio_days": 30,
            "evaluation_days": 1095,
            "audit_days": 1825,
            "mining_draft_days": 90,
        }
        with suppress(Exception):
            settings = _settings()
            for key in defaults:
                value = getattr(settings, f"retention_{key}", None)
                if value is not None:
                    defaults[key] = int(value)
        return defaults


def _settings() -> Any:
    from app.core.config import get_settings

    return get_settings()


_SYSTEM_PROMPT_MARKERS = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\[SECURITY\]",
        r"required_output_schema",
        r"UNTRUSTED DATA",
        r"你是一位\*\*真實的客戶\*\*",
        r"system prompt",
    )
)


def _leaks_system_prompt(text: str) -> bool:
    return any(pattern.search(text) for pattern in _SYSTEM_PROMPT_MARKERS)


def _client_agrees(client_claim: str | None, blocked: bool) -> bool:
    if client_claim is None:
        return True
    claim_unsafe = fold(client_claim) in {"unsafe", "blocked", "risky", "flagged"}
    return claim_unsafe == blocked


__all__ = [
    "BLOCKING_KINDS",
    "MASK",
    "TOOL_POLICY",
    "ModerationVerdict",
    "PiiMatch",
    "SafetyFlag",
    "SafetyService",
    "Screening",
    "ToolPolicyVerdict",
]
