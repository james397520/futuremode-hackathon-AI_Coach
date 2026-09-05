"""Input understanding pipeline — spec §21, §8.1, §8.2, Part II §53/§55.

    Input -> Intent Classification -> Scope Check -> Safety Check
          -> Context Resolution -> Clarify / Redirect / Continue

Design notes
------------
* **Rules first, model second.** The deterministic pass (`app.agents.patterns`)
  handles the safety-critical categories — injection, jailbreak, role escape,
  answer-key extraction, unauthorised knowledge, restricted topics. Those decisions
  must be reproducible and must not depend on a model being reachable, so they are
  never delegated. The LLM is consulted only to disambiguate *benign* input.
* **The client-side hint is advisory.** The browser may run a small WebGPU intent
  classifier (Part II §53) and send `client.intent_hint`. It can raise our confidence
  when it agrees with the server, and it is recorded for telemetry — but it can never
  change the label, relax a safety flag, or turn `block` into `continue`. The server
  is authoritative (Part II §55).
* Typos, missing subjects and voice-transcription noise are normal input, not errors
  (spec §21): the text is NFKC-folded and fuzzy-compared against a small phrase table
  before anything is called "unintelligible".
"""

from __future__ import annotations

import difflib
import re
from collections.abc import Sequence
from enum import StrEnum
from typing import Any, ClassVar, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import Agent
from app.agents.llm_client import LlmPort, ModelPurpose
from app.agents.patterns import (
    INJECTION_RULES,
    OFF_TOPIC_SIGNALS,
    PII_RULES,
    ROLE_ESCAPE_RULES,
    UNAUTHORIZED_KNOWLEDGE_RULES,
    Detection,
    RiskKind,
    any_match,
    fold,
    matched_topics,
    normalize,
    scan,
)
from app.agents.prompts.common import data_block, schema_block, untrusted_block
from app.agents.prompts.intent import intent_system_prompt

log = structlog.get_logger(__name__)


class IntentLabel(StrEnum):
    GREETING = "greeting"
    SMALL_TALK = "small_talk"
    QUESTION = "question"
    NEEDS_PROBE = "needs_probe"
    PRODUCT_EXPLANATION = "product_explanation"
    PRICE_OBJECTION = "price_objection"
    OBJECTION_OTHER = "objection_other"
    EMPATHY_RESPONSE = "empathy_response"
    CLOSING_ATTEMPT = "closing_attempt"
    AGREEMENT = "agreement"
    OFF_TOPIC = "off_topic"
    DIRECT_ANSWER_REQUEST = "direct_answer_request"
    PERSONA_BREAK = "persona_break"
    PROMPT_INJECTION = "prompt_injection"
    UNAUTHORIZED_KNOWLEDGE = "unauthorized_knowledge"
    INCOMPLETE = "incomplete"
    AMBIGUOUS = "ambiguous"
    EXIT_INTENT = "exit_intent"
    OTHER = "other"


class InputAction(StrEnum):
    CONTINUE = "continue"
    CLARIFY = "clarify"
    REDIRECT = "redirect"
    BLOCK = "block"


class ScopeVerdict(StrEnum):
    IN_SCOPE = "in_scope"
    OUT_OF_SCOPE = "out_of_scope"
    RESTRICTED = "restricted"


class SafetyFlag(StrEnum):
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


class ClientIntentHint(BaseModel):
    """`client.intent_hint` from the browser's local model — advisory only."""

    model_config = ConfigDict(extra="ignore")

    intent: str
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    source: str = "browser"


class IntentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    locale: str = "zh-TW"
    mode: str = "training"                       # SessionMode
    scenario_phase: str = "opening"              # ScenarioPhase
    allowed_scope: list[str] = Field(default_factory=list)
    restricted_topics: list[str] = Field(default_factory=list)
    #: last few (speaker, text) pairs, oldest first — used for context resolution
    recent_turns: list[tuple[str, str]] = Field(default_factory=list)
    client_hint: ClientIntentHint | None = None


class IntentDecision(BaseModel):
    """Structured verdict consumed by the orchestrator (spec §66)."""

    model_config = ConfigDict(extra="forbid")

    label: IntentLabel = IntentLabel.OTHER
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    action: InputAction = InputAction.CONTINUE
    scope: ScopeVerdict = ScopeVerdict.IN_SCOPE
    safety_flags: list[SafetyFlag] = Field(default_factory=list)
    normalized_text: str = ""
    candidate_intents: list[str] = Field(default_factory=list)
    #: what the ambiguous reference resolved to, e.g. "premium of plan A"
    resolved_reference: str | None = None
    clarifying_question: str | None = None
    rationale: str = ""
    #: telemetry for the browser model's usefulness; never used to override
    client_hint_intent: str | None = None
    client_hint_agreed: bool = False
    #: evidence spans for the compliance agent / audit trail
    detections: list[str] = Field(default_factory=list)

    @property
    def is_blocked(self) -> bool:
        return self.action is InputAction.BLOCK

    @property
    def breaks_persona(self) -> bool:
        return self.label in (IntentLabel.PERSONA_BREAK, IntentLabel.DIRECT_ANSWER_REQUEST) or bool(
            {SafetyFlag.ROLE_ESCAPE, SafetyFlag.ANSWER_KEY_REQUEST} & set(self.safety_flags)
        )

    @property
    def needs_knowledge(self) -> bool:
        return self.label in (
            IntentLabel.QUESTION,
            IntentLabel.PRICE_OBJECTION,
            IntentLabel.OBJECTION_OTHER,
            IntentLabel.PRODUCT_EXPLANATION,
            IntentLabel.AMBIGUOUS,
        )


# ---------------------------------------------------------------------------
# deterministic classifier
# ---------------------------------------------------------------------------
_KEYWORDS: tuple[tuple[IntentLabel, tuple[str, ...]], ...] = (
    (IntentLabel.PRICE_OBJECTION, ("太貴", "好貴", "負擔不起", "沒預算", "便宜一點", "打折",
                                   "保費太高", "繳不出", "too expensive", "cheaper")),
    (IntentLabel.EXIT_INTENT, ("我再想想", "我先不要", "不用了", "改天", "我要走了", "沒興趣",
                               "not interested", "maybe later")),
    (IntentLabel.AGREEMENT, ("好啊", "可以啊", "那就這樣", "我同意", "聽起來不錯", "sounds good",
                             "okay let's", "我要辦")),
    (IntentLabel.CLOSING_ATTEMPT, ("我們今天就", "要不要現在", "幫你辦", "簽一下", "填一下資料",
                                   "sign", "let's proceed")),
    (IntentLabel.EMPATHY_RESPONSE, ("我理解", "我了解你", "辛苦了", "難怪你會", "我聽得出來",
                                    "i understand", "that sounds")),
    (IntentLabel.NEEDS_PROBE, ("請問你", "想了解你", "你目前", "你有沒有", "方便問", "你最在意",
                               "may i ask", "what matters")),
    (IntentLabel.PRODUCT_EXPLANATION, ("這個方案", "保障內容", "給付", "年期", "報酬", "利率",
                                       "this plan", "coverage")),
    (IntentLabel.GREETING, ("你好", "您好", "嗨", "早安", "午安", "hello", "hi ")),
    (IntentLabel.OBJECTION_OTHER, ("我要跟家人討論", "我怕", "我擔心", "會不會有問題", "風險",
                                   "i'm worried", "my wife", "我老公", "我太太")),
)

#: Sentences whose reference cannot be resolved without context (spec §8.1).
_AMBIGUOUS_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p)
    for p in (
        r"^(那)?(這個|那個|它)?(到底)?(划|劃)算嗎",
        r"^(這樣)?(好|可以|ok|行)嗎[?？]?$",
        r"^(那)?怎麼(說|辦|算)[?？]?$",
        r"^(有|會)差(很多|多少)嗎",
        r"^值得嗎",
        r"^(is|isit)(this)?worthit",
        # Referent-free evaluations a salesperson actually says mid-pitch. Each
        # names nothing — no product, no number, no term — so the customer has to
        # ask which part is meant (§8.1) rather than guess.
        r"^(那)?(這個|那個|這樣|那樣)(怎麼樣|怎樣|如何|好嗎|ok嗎|可以嗎)[?？]?$",
        r"^(那)?(這樣|那樣)(呢|咧)[?？]?$",
        r"^(那)?(要|會|大概)(多少|幾)(錢)?[?？]?$",
        r"^(那)?(有|會)差嗎[?？]?$",
        r"^(那)?這樣(算|夠)(嗎|不夠)[?？]?$",
    )
)

_AMBIGUOUS_CANDIDATES: dict[str, tuple[str, ...]] = {
    "zh-TW": ("價格 / 保費", "保障範圍", "投資報酬", "風險與除外"),
    "zh-CN": ("价格 / 保费", "保障范围", "投资报酬", "风险与除外"),
    "en-US": ("price / premium", "coverage", "expected return", "risk & exclusions"),
}

_CLARIFY_TEMPLATES: dict[str, str] = {
    "zh-TW": "你剛剛說的「{text}」，是想問哪一部分呢？{options}",
    "zh-CN": "你刚刚说的「{text}」，是想问哪一部分呢？{options}",
    "en-US": "When you say “{text}”, which part do you mean? {options}",
}

_FILLERS = {"嗯", "呃", "然後", "那個", "就是", "um", "uh", "er", "hmm", "..."}

#: Small phrase table for fuzzy typo recovery. Only used to *route*, never to rewrite
#: what the trainee said (the transcript always keeps the original text).
_TYPO_ANCHORS: dict[str, IntentLabel] = {
    "太貴了": IntentLabel.PRICE_OBJECTION,
    "我再想想": IntentLabel.EXIT_INTENT,
    "保障範圍": IntentLabel.PRODUCT_EXPLANATION,
    "我要跟家人討論": IntentLabel.OBJECTION_OTHER,
    "直接告訴我答案": IntentLabel.DIRECT_ANSWER_REQUEST,
}


class RuleIntentClassifier:
    """Deterministic pass. Returns a decision plus whether the model should refine it."""

    #: below this the LLM (when available) is asked to refine benign input
    refine_below: ClassVar[float] = 0.6

    def classify(self, request: IntentRequest) -> IntentDecision:
        raw = request.text or ""
        text = normalize(raw)
        folded = fold(text)
        decision = IntentDecision(normalized_text=text)

        detections: list[Detection] = [
            *scan(text, INJECTION_RULES),
            *scan(text, ROLE_ESCAPE_RULES),
            *scan(text, UNAUTHORIZED_KNOWLEDGE_RULES),
            *scan(text, PII_RULES),
        ]
        flags: list[SafetyFlag] = []
        for det in detections:
            flag = _FLAG_FOR_KIND.get(det.kind)
            if flag and flag not in flags:
                flags.append(flag)
        decision.safety_flags = flags
        decision.detections = [d.evidence for d in detections][:8]

        restricted = matched_topics(text, request.restricted_topics)
        if restricted:
            decision.safety_flags.append(SafetyFlag.RESTRICTED_TOPIC)
            decision.scope = ScopeVerdict.RESTRICTED

        # --- safety-critical routing (never delegated to a model) ----------
        if {SafetyFlag.PROMPT_INJECTION, SafetyFlag.JAILBREAK, SafetyFlag.TOOL_ABUSE} & set(flags):
            decision.label = IntentLabel.PROMPT_INJECTION
            decision.action = InputAction.BLOCK
            decision.confidence = 0.95
            decision.rationale = "injection/jailbreak pattern matched; server-side hard block"
            return decision
        if SafetyFlag.UNAUTHORIZED_KNOWLEDGE in flags:
            decision.label = IntentLabel.UNAUTHORIZED_KNOWLEDGE
            decision.action = InputAction.REDIRECT
            decision.scope = ScopeVerdict.RESTRICTED
            decision.confidence = 0.9
            decision.rationale = "request targets data outside the trainee's authorisation"
            return decision
        if SafetyFlag.ANSWER_KEY_REQUEST in flags:
            decision.label = IntentLabel.DIRECT_ANSWER_REQUEST
            decision.action = InputAction.REDIRECT
            decision.confidence = 0.9
            decision.rationale = "trainee asked for the answer key; persona must deflect in character"
            return decision
        if SafetyFlag.ROLE_ESCAPE in flags:
            decision.label = IntentLabel.PERSONA_BREAK
            decision.action = InputAction.REDIRECT
            decision.confidence = 0.9
            decision.rationale = "role-escape attempt; persona stays in character (§21)"
            return decision
        if restricted:
            decision.label = IntentLabel.OFF_TOPIC
            decision.action = InputAction.REDIRECT
            decision.confidence = 0.85
            decision.rationale = f"restricted topic hit: {', '.join(restricted)}"
            return decision

        # --- benign routing ------------------------------------------------
        stripped = folded.strip(" .,!?")
        if not stripped or stripped in {f for f in _FILLERS} or len(stripped) <= 1:
            decision.label = IntentLabel.INCOMPLETE
            decision.action = InputAction.CLARIFY
            decision.confidence = 0.8
            decision.clarifying_question = self._clarify(request, text, ())
            decision.rationale = "input carried no content"
            return decision

        if any(p.search(folded) for p in _AMBIGUOUS_PATTERNS):
            options = _AMBIGUOUS_CANDIDATES.get(
                request.locale, _AMBIGUOUS_CANDIDATES["zh-TW"]
            )
            decision.label = IntentLabel.AMBIGUOUS
            decision.action = InputAction.CLARIFY
            decision.confidence = 0.75
            decision.candidate_intents = list(options)
            decision.resolved_reference = self._resolve_reference(request)
            decision.clarifying_question = self._clarify(request, text, options)
            decision.rationale = "referent missing; candidates offered in character (§8.1)"
            return decision

        if any_match(text, OFF_TOPIC_SIGNALS) and not self._in_allowed_scope(
            folded, request.allowed_scope
        ):
            decision.label = IntentLabel.OFF_TOPIC
            decision.action = InputAction.REDIRECT
            decision.scope = ScopeVerdict.OUT_OF_SCOPE
            decision.confidence = 0.8
            decision.rationale = "off-topic; persona redirects naturally, never a canned refusal (§8.2)"
            return decision

        for label, keywords in _KEYWORDS:
            if any(fold(keyword) in folded for keyword in keywords):
                decision.label = label
                decision.action = InputAction.CONTINUE
                decision.confidence = 0.72
                decision.rationale = f"keyword route -> {label}"
                return decision

        fuzzy = self._fuzzy_label(folded)
        if fuzzy is not None:
            decision.label = fuzzy
            decision.action = InputAction.CONTINUE
            decision.confidence = 0.6
            decision.rationale = "fuzzy match against phrase anchors (typo tolerance)"
            return decision

        if text.endswith(("?", "？")) or folded.startswith(("請問", "可以問", "what", "how", "why")):
            decision.label = IntentLabel.QUESTION
            decision.confidence = 0.55
            decision.action = InputAction.CONTINUE
            decision.rationale = "interrogative form"
            return decision

        decision.label = IntentLabel.OTHER
        decision.confidence = 0.35
        decision.action = InputAction.CONTINUE
        decision.rationale = "no rule matched; eligible for model refinement"
        return decision

    # -- helpers -----------------------------------------------------------
    @staticmethod
    def _in_allowed_scope(folded: str, allowed_scope: Sequence[str]) -> bool:
        return any(fold(item) in folded for item in allowed_scope if item)

    @staticmethod
    def _fuzzy_label(folded: str) -> IntentLabel | None:
        anchors = list(_TYPO_ANCHORS)
        match = difflib.get_close_matches(folded, [fold(a) for a in anchors], n=1, cutoff=0.72)
        if not match:
            return None
        for anchor in anchors:
            if fold(anchor) == match[0]:
                return _TYPO_ANCHORS[anchor]
        return None

    @staticmethod
    def _resolve_reference(request: IntentRequest) -> str | None:
        """Context resolution: what was the last concrete thing discussed?"""
        for speaker, text in reversed(request.recent_turns):
            folded = fold(text)
            for topic in ("保費", "月繳", "年繳", "保障", "給付", "報酬", "利率", "解約金"):
                if fold(topic) in folded:
                    return f"{speaker}:{topic}"
        return None

    @staticmethod
    def _clarify(request: IntentRequest, text: str, options: Sequence[str]) -> str:
        template = _CLARIFY_TEMPLATES.get(request.locale) or _CLARIFY_TEMPLATES["zh-TW"]
        rendered_options = " / ".join(options) if options else ""
        return template.format(text=text[:40], options=rendered_options).strip()


# ---------------------------------------------------------------------------
# optional model refinement
# ---------------------------------------------------------------------------
class IntentAgent(Agent[IntentRequest, IntentDecision]):
    """Refines *benign, low-confidence* input only. Never sees a blocked turn."""

    name = "orchestrator"
    purpose = ModelPurpose.INTENT
    output_model = IntentDecision
    optional = True
    default_temperature = 0.0
    default_max_tokens = 400

    def system_prompt(self) -> str:
        return intent_system_prompt(self.locale)

    def build_user_prompt(self, request: IntentRequest) -> str:
        history = "\n".join(f"{speaker}: {text}" for speaker, text in request.recent_turns[-6:])
        parts = [
            data_block(
                "context",
                {
                    "mode": request.mode,
                    "scenario_phase": request.scenario_phase,
                    "allowed_scope": request.allowed_scope,
                    "restricted_topics": request.restricted_topics,
                },
            ),
            untrusted_block("recent_transcript", history),
            untrusted_block("trainee_input", request.text),
        ]
        if request.client_hint is not None:
            parts.append(
                data_block(
                    "client_hint (ADVISORY ONLY — browser model, may be wrong)",
                    request.client_hint.model_dump(),
                )
            )
        parts.append(schema_block(self._schema(), name=self.output_model.__name__))
        return "\n\n".join(parts)

    async def run(self, request: IntentRequest) -> IntentDecision:
        return await self._invoke_structured(self._messages(request))


@runtime_checkable
class SafetyPort(Protocol):
    """Structural port for the authoritative `SafetyService` (spec §40).

    Declared here (not imported from `app.services`) to keep `agents` free of a
    dependency on the service layer; `SafetyService` satisfies it structurally.
    """

    async def screen_input(
        self, text: str, *, restricted_topics: Sequence[str] = (), locale: str = "zh-TW"
    ) -> Any: ...


class IntentPipeline:
    """The §21 pipeline. Deterministic first, model second, safety service last word."""

    def __init__(
        self,
        *,
        llm: LlmPort | None = None,
        locale: str = "zh-TW",
        safety: SafetyPort | None = None,
        classifier: RuleIntentClassifier | None = None,
        use_model_refinement: bool = True,
    ) -> None:
        self.classifier = classifier or RuleIntentClassifier()
        self.locale = locale
        self.safety = safety
        self._agent = (
            IntentAgent(llm, locale=locale) if (llm is not None and use_model_refinement) else None
        )

    async def resolve(self, request: IntentRequest) -> IntentDecision:
        decision = self.classifier.classify(request)

        # 1. model refinement, benign + low confidence only
        if (
            self._agent is not None
            and decision.action is InputAction.CONTINUE
            and not decision.safety_flags
            and decision.confidence < RuleIntentClassifier.refine_below
        ):
            refined = await self._agent.safe_run(request)
            if refined is not None:
                decision = self._merge(decision, refined)

        # 2. authoritative safety layer (browser + rules were advisory/fast paths)
        if self.safety is not None:
            screening = await self.safety.screen_input(
                request.text,
                restricted_topics=request.restricted_topics,
                locale=request.locale,
            )
            decision = self._apply_screening(decision, screening)

        # 3. client hint: advisory only
        decision = self._apply_client_hint(decision, request.client_hint)
        return decision

    # -- merging rules -----------------------------------------------------
    @staticmethod
    def _merge(rule_based: IntentDecision, refined: IntentDecision) -> IntentDecision:
        """The model may sharpen the label; it may never weaken safety."""
        merged = rule_based.model_copy(deep=True)
        merged.label = refined.label
        merged.confidence = max(rule_based.confidence, min(refined.confidence, 0.9))
        merged.candidate_intents = refined.candidate_intents or rule_based.candidate_intents
        merged.clarifying_question = refined.clarifying_question or rule_based.clarifying_question
        merged.resolved_reference = refined.resolved_reference or rule_based.resolved_reference
        merged.rationale = f"{rule_based.rationale} | model: {refined.rationale}"[:400]
        # A model may escalate to clarify/redirect/block, never de-escalate.
        order = {
            InputAction.CONTINUE: 0,
            InputAction.CLARIFY: 1,
            InputAction.REDIRECT: 2,
            InputAction.BLOCK: 3,
        }
        merged.action = max(rule_based.action, refined.action, key=lambda a: order[a])
        for flag in refined.safety_flags:
            if flag not in merged.safety_flags:
                merged.safety_flags.append(flag)
        return merged

    @staticmethod
    def _apply_screening(decision: IntentDecision, screening: Any) -> IntentDecision:
        """Fold `SafetyService.screen_input` output in. The service is authoritative."""
        if screening is None:
            return decision
        blocked = bool(getattr(screening, "blocked", False))
        flags = getattr(screening, "flags", ()) or ()
        for raw_flag in flags:
            value = str(getattr(raw_flag, "value", raw_flag))
            try:
                flag = SafetyFlag(value)
            except ValueError:
                continue
            if flag not in decision.safety_flags:
                decision.safety_flags.append(flag)
        if blocked:
            decision.action = InputAction.BLOCK
            if decision.label not in (
                IntentLabel.PROMPT_INJECTION,
                IntentLabel.UNAUTHORIZED_KNOWLEDGE,
            ):
                decision.label = IntentLabel.PROMPT_INJECTION
            decision.rationale = (decision.rationale + " | blocked by SafetyService")[:400]
        return decision

    @staticmethod
    def _apply_client_hint(
        decision: IntentDecision, hint: ClientIntentHint | None
    ) -> IntentDecision:
        if hint is None:
            return decision
        decision.client_hint_intent = hint.intent
        agreed = fold(hint.intent) == fold(str(decision.label))
        decision.client_hint_agreed = agreed
        # Agreement is worth a small confidence nudge and nothing else. Disagreement
        # changes nothing: the server decides (Part II §55).
        if agreed and decision.action is InputAction.CONTINUE:
            decision.confidence = min(1.0, decision.confidence + 0.1 * hint.confidence)
        return decision


__all__ = [
    "ClientIntentHint",
    "InputAction",
    "IntentAgent",
    "IntentDecision",
    "IntentLabel",
    "IntentPipeline",
    "IntentRequest",
    "RuleIntentClassifier",
    "SafetyFlag",
    "SafetyPort",
    "ScopeVerdict",
]
