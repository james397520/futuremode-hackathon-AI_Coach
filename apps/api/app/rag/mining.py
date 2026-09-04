"""Knowledge Mining — 隱性知識活化 (spec §13, §4.2).

    Transcript -> anonymization -> segmentation -> objection/intent extraction
              -> best-response mining -> **human review** -> publish to playbook

    所有「最佳話術」正式發布前需 human review。 (spec §13)

That last line is enforced structurally: `MiningRun.publish()` refuses to run without
an explicit reviewer decision, and every produced asset starts life in
`ContentStatus.review_required`. There is no code path from "the model suggested a
golden phrase" to "trainees are being taught it".

Anonymisation runs **before** any text reaches a model (§40.2 PII detection/masking),
using the same rule pack as the compliance agent, and the run records whether a
suspected leak survived so a reviewer can reject the batch.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from enum import StrEnum
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import Agent
from app.agents.llm_client import LlmPort, ModelPurpose
from app.agents.patterns import PII_RULES, normalize, scan
from app.agents.prompts.common import data_block, schema_block, untrusted_block
from app.agents.prompts.mining import mining_system_prompt

log = structlog.get_logger(__name__)

REDACTED = "[REDACTED]"


class AssetKind(StrEnum):
    """§13 產出."""

    GOLDEN_PHRASE = "golden_phrase"
    OBJECTION_PATTERN = "objection_pattern"
    BEST_PRACTICE = "best_practice"
    ANTI_PATTERN = "anti_pattern"
    RUBRIC_EVIDENCE = "rubric_evidence"
    SCENARIO_SEED = "scenario_seed"


class ReviewStatus(StrEnum):
    """Subset of `ContentStatus` (shared) that mining assets can hold."""

    GENERATED = "generated"
    REVIEW_REQUIRED = "review_required"
    APPROVED = "approved"
    PUBLISHED = "published"
    REJECTED = "archived"


class ReviewRequiredError(RuntimeError):
    """Raised when something tries to publish un-reviewed mining output (§13)."""


class TranscriptSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int
    speaker: str                     # trainee | customer | manager | unknown
    text: str
    #: coarse topic label from segmentation, e.g. "price_objection"
    topic: str = ""
    turn_ids: list[str] = Field(default_factory=list)


class MinedAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: f"ma_{uuid.uuid4().hex[:12]}")
    kind: AssetKind
    title: str = ""
    body: str = ""
    #: the anonymised source line this was derived from — required for review
    source_quote: str = ""
    segment_indexes: list[int] = Field(default_factory=list)
    skill: str | None = None
    objection_kind: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    compliance_note: str | None = None
    status: ReviewStatus = ReviewStatus.REVIEW_REQUIRED
    reviewer_id: str | None = None
    review_note: str | None = None


class MiningOutput(BaseModel):
    """Structured model output (spec §66)."""

    model_config = ConfigDict(extra="forbid")

    assets: list[MinedAsset] = Field(default_factory=list)
    pii_leak_suspected: bool = False
    note: str = ""


class MiningRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_label: str = ""
    locale: str = "zh-TW"
    #: raw transcript text OR pre-split turns
    raw_text: str = ""
    turns: list[tuple[str, str]] = Field(default_factory=list)
    manager_notes: list[str] = Field(default_factory=list)
    outcome: str = ""                # won | lost | unknown
    target_skills: list[str] = Field(default_factory=list)


class AnonymisationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    replacements: int = 0
    kinds: list[str] = Field(default_factory=list)
    residual_suspected: bool = False


# ---------------------------------------------------------------------------
# 1. anonymisation
# ---------------------------------------------------------------------------
_NAME_HONORIFIC = re.compile(r"([一-鿿]{1,3})\s*(先生|小姐|太太|女士|經理|專員|課長|協理)")
_COMPANY = re.compile(r"([一-鿿 A-Za-z]{2,12})(股份有限公司|有限公司|保險公司|銀行)")


def anonymise(text: str) -> AnonymisationResult:
    """Mask PII before anything else touches the transcript (§40.2, §13)."""
    body = normalize(text)
    kinds: list[str] = []
    replacements = 0

    detections = sorted(scan(body, PII_RULES), key=lambda d: d.start, reverse=True)
    for detection in detections:
        body = body[: detection.start] + REDACTED + body[detection.end :]
        replacements += 1
        if detection.policy_rule not in kinds:
            kinds.append(detection.policy_rule)

    body, count = _NAME_HONORIFIC.subn(rf"{REDACTED}\2", body)
    replacements += count
    if count:
        kinds.append("PII-NAME")
    body, count = _COMPANY.subn(rf"{REDACTED}\2", body)
    replacements += count
    if count:
        kinds.append("PII-COMPANY")

    residual = bool(scan(body, PII_RULES))
    return AnonymisationResult(
        text=body, replacements=replacements, kinds=kinds, residual_suspected=residual
    )


# ---------------------------------------------------------------------------
# 2. segmentation + 3. objection/intent extraction
# ---------------------------------------------------------------------------
_SPEAKER_LINE = re.compile(
    r"^\s*(業務|銷售|學員|顧問|客戶|客人|主管|經理|A|B|Agent|Sales|Customer|Client|Manager)"
    r"\s*[:：]\s*(.+)$",
    re.IGNORECASE,
)
_SPEAKER_MAP = {
    "業務": "trainee", "銷售": "trainee", "學員": "trainee", "顧問": "trainee",
    "a": "trainee", "agent": "trainee", "sales": "trainee",
    "客戶": "customer", "客人": "customer", "b": "customer",
    "customer": "customer", "client": "customer",
    "主管": "manager", "經理": "manager", "manager": "manager",
}

TOPIC_PATTERNS: dict[str, tuple[str, ...]] = {
    "price_objection": ("太貴", "保費", "負擔", "預算", "便宜", "expensive", "budget"),
    "spouse_consult": ("跟老公", "跟太太", "跟家人", "討論", "商量", "my wife", "my husband"),
    "trust_in_company": ("你們公司", "會不會倒", "信用", "評等", "reliable"),
    "competitor_comparison": ("別家", "同業", "其他公司", "比較", "compare"),
    "risk_aversion": ("風險", "會不會賠", "本金", "虧", "risk"),
    "liquidity": ("解約", "領回", "急用", "流動", "withdraw"),
    "needs_discovery": ("想了解", "你目前", "最在意", "規劃", "what matters"),
    "closing": ("要不要辦", "簽", "填資料", "sign", "proceed"),
    "empathy": ("我理解", "辛苦", "難怪", "我懂", "understand"),
}


def segment(request: MiningRequest) -> list[TranscriptSegment]:
    """Split a transcript into speaker-attributed, topic-labelled segments."""
    segments: list[TranscriptSegment] = []
    if request.turns:
        pairs = [(speaker, text) for speaker, text in request.turns]
    else:
        pairs = []
        for line in (request.raw_text or "").splitlines():
            if not line.strip():
                continue
            match = _SPEAKER_LINE.match(line)
            if match:
                speaker = _SPEAKER_MAP.get(match.group(1).lower(), "unknown")
                pairs.append((speaker, match.group(2).strip()))
            elif pairs:
                previous_speaker, previous_text = pairs[-1]
                pairs[-1] = (previous_speaker, f"{previous_text} {line.strip()}")
            else:
                pairs.append(("unknown", line.strip()))
    for index, (speaker, text) in enumerate(pairs):
        segments.append(
            TranscriptSegment(
                index=index, speaker=speaker, text=text, topic=classify_topic(text)
            )
        )
    return segments


def classify_topic(text: str) -> str:
    lowered = normalize(text).lower()
    for topic, keywords in TOPIC_PATTERNS.items():
        if any(keyword.lower() in lowered for keyword in keywords):
            return topic
    return ""


def extract_objections(segments: Sequence[TranscriptSegment]) -> list[dict[str, Any]]:
    """Customer turns that raise an objection, paired with the trainee's answer."""
    objection_topics = {
        "price_objection",
        "spouse_consult",
        "trust_in_company",
        "competitor_comparison",
        "risk_aversion",
        "liquidity",
    }
    out: list[dict[str, Any]] = []
    for index, segment_item in enumerate(segments):
        if segment_item.speaker != "customer" or segment_item.topic not in objection_topics:
            continue
        response = next(
            (s for s in segments[index + 1 : index + 3] if s.speaker == "trainee"), None
        )
        out.append(
            {
                "objection_kind": segment_item.topic,
                "customer_line": segment_item.text,
                "customer_index": segment_item.index,
                "response": response.text if response is not None else "",
                "response_index": response.index if response is not None else None,
            }
        )
    return out


def mine_best_responses(
    segments: Sequence[TranscriptSegment], objections: Sequence[dict[str, Any]]
) -> list[MinedAsset]:
    """Deterministic first pass: the responses that *look* like good practice.

    Heuristic, on purpose — it produces a candidate list a reviewer can act on even
    when no model is configured, and it gives the model pass something to improve on
    rather than a blank page.
    """
    assets: list[MinedAsset] = []
    for objection in objections:
        response = str(objection.get("response") or "").strip()
        if len(response) < 8:
            continue
        acknowledges = classify_topic(response) == "empathy" or any(
            marker in response for marker in ("我理解", "我懂", "難怪", "辛苦", "understand")
        )
        asks_back = response.rstrip().endswith(("?", "？")) or "可以跟我說" in response
        quantifies = bool(re.search(r"\d", response))
        score = 0.3 + 0.25 * acknowledges + 0.2 * asks_back + 0.15 * quantifies
        assets.append(
            MinedAsset(
                kind=AssetKind.GOLDEN_PHRASE if score >= 0.6 else AssetKind.BEST_PRACTICE,
                title=f"處理「{objection['objection_kind']}」的回應",
                body=response,
                source_quote=response,
                segment_indexes=[
                    int(objection["customer_index"]),
                    *(
                        [int(objection["response_index"])]
                        if objection.get("response_index") is not None
                        else []
                    ),
                ],
                objection_kind=str(objection["objection_kind"]),
                skill="objection_handling",
                confidence=round(min(score, 0.95), 3),
            )
        )
        assets.append(
            MinedAsset(
                kind=AssetKind.OBJECTION_PATTERN,
                title=str(objection["objection_kind"]),
                body=str(objection["customer_line"]),
                source_quote=str(objection["customer_line"]),
                segment_indexes=[int(objection["customer_index"])],
                objection_kind=str(objection["objection_kind"]),
                confidence=0.7,
            )
        )
    return assets


# ---------------------------------------------------------------------------
# model pass
# ---------------------------------------------------------------------------
class MiningAgent(Agent[MiningRequest, MiningOutput]):
    name = "knowledge"
    purpose = ModelPurpose.MINING
    output_model = MiningOutput
    optional = True
    default_temperature = 0.2
    default_max_tokens = 2500

    def system_prompt(self) -> str:
        return mining_system_prompt(self.locale)

    def build_user_prompt(self, request: MiningRequest) -> str:
        transcript = "\n".join(f"{s.speaker}: {s.text}" for s in segment(request))
        return "\n\n".join(
            [
                data_block(
                    "context",
                    {
                        "source_label": request.source_label,
                        "outcome": request.outcome,
                        "target_skills": request.target_skills,
                    },
                ),
                untrusted_block("anonymised_transcript", transcript, max_chars=18000),
                untrusted_block("manager_notes", "\n".join(request.manager_notes)),
                schema_block(self._schema(), name=self.output_model.__name__),
            ]
        )

    async def run(self, request: MiningRequest) -> MiningOutput:
        output = await self._invoke_structured(self._messages(request))
        # Every model-produced asset re-enters the review queue regardless of what the
        # model claimed about its status.
        return output.model_copy(
            update={
                "assets": [
                    asset.model_copy(
                        update={
                            "status": ReviewStatus.REVIEW_REQUIRED,
                            "reviewer_id": None,
                        }
                    )
                    for asset in output.assets
                ]
            }
        )


# ---------------------------------------------------------------------------
# the run: pipeline + review gate
# ---------------------------------------------------------------------------
class MiningRun(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: f"mr_{uuid.uuid4().hex[:12]}")
    source_label: str = ""
    segments: list[TranscriptSegment] = Field(default_factory=list)
    objections: list[dict[str, Any]] = Field(default_factory=list)
    assets: list[MinedAsset] = Field(default_factory=list)
    anonymisation: AnonymisationResult | None = None
    pii_leak_suspected: bool = False
    #: nothing in this run may reach the playbook until a human decides
    review_complete: bool = False

    def pending(self) -> list[MinedAsset]:
        return [a for a in self.assets if a.status is ReviewStatus.REVIEW_REQUIRED]

    def review(
        self,
        *,
        reviewer_id: str,
        approved_asset_ids: Sequence[str],
        rejected_asset_ids: Sequence[str] = (),
        note: str | None = None,
    ) -> MiningRun:
        """Record a human decision (§13 human review, §38 approval workflow)."""
        if not reviewer_id:
            raise ReviewRequiredError("reviewer_id is required to review mining output")
        approved = set(approved_asset_ids)
        rejected = set(rejected_asset_ids)
        overlap = approved & rejected
        if overlap:
            raise ValueError(f"asset cannot be both approved and rejected: {sorted(overlap)}")
        assets: list[MinedAsset] = []
        for asset in self.assets:
            if asset.id in approved:
                assets.append(
                    asset.model_copy(
                        update={
                            "status": ReviewStatus.APPROVED,
                            "reviewer_id": reviewer_id,
                            "review_note": note,
                        }
                    )
                )
            elif asset.id in rejected:
                assets.append(
                    asset.model_copy(
                        update={
                            "status": ReviewStatus.REJECTED,
                            "reviewer_id": reviewer_id,
                            "review_note": note,
                        }
                    )
                )
            else:
                assets.append(asset)
        decided = {a.id for a in assets if a.status is not ReviewStatus.REVIEW_REQUIRED}
        return self.model_copy(
            update={
                "assets": assets,
                "review_complete": decided >= {a.id for a in self.assets},
            }
        )

    def publish(self) -> list[MinedAsset]:
        """Return the assets that may enter the playbook.

        Refuses when anything is still un-reviewed, or when anonymisation flagged a
        residual PII suspicion — publishing a transcript-derived phrase that still
        contains customer data would be a §40.2 incident.
        """
        outstanding = self.pending()
        if outstanding:
            raise ReviewRequiredError(
                f"{len(outstanding)} mining asset(s) are still awaiting human review; "
                "nothing can be published (spec §13)"
            )
        if self.pii_leak_suspected:
            raise ReviewRequiredError(
                "anonymisation flagged residual PII; a reviewer must clear the batch first"
            )
        return [
            asset.model_copy(update={"status": ReviewStatus.PUBLISHED})
            for asset in self.assets
            if asset.status is ReviewStatus.APPROVED
        ]


class KnowledgeMiner:
    """Runs the §13 pipeline. The model pass is optional and never authoritative."""

    def __init__(self, *, llm: LlmPort | None = None, locale: str = "zh-TW") -> None:
        self._agent = MiningAgent(llm, locale=locale) if llm is not None else None
        self.locale = locale

    async def mine(self, request: MiningRequest) -> MiningRun:
        anonymised = anonymise(request.raw_text or "\n".join(t for _s, t in request.turns))
        safe_request = request.model_copy(
            update={
                "raw_text": anonymised.text if request.raw_text else "",
                "turns": [
                    (speaker, anonymise(text).text) for speaker, text in request.turns
                ],
                "manager_notes": [anonymise(note).text for note in request.manager_notes],
            }
        )
        segments = segment(safe_request)
        objections = extract_objections(segments)
        assets = mine_best_responses(segments, objections)

        pii_suspected = anonymised.residual_suspected
        if self._agent is not None:
            output = await self._agent.safe_run(safe_request)
            if output is not None:
                assets.extend(self._verify(output.assets, segments))
                pii_suspected = pii_suspected or output.pii_leak_suspected

        run = MiningRun(
            source_label=request.source_label,
            segments=segments,
            objections=objections,
            assets=_dedupe(assets),
            anonymisation=anonymised,
            pii_leak_suspected=pii_suspected,
        )
        log.info(
            "mining.run_created",
            run_id=run.id,
            segments=len(segments),
            assets=len(run.assets),
            pii_suspected=pii_suspected,
        )
        return run

    @staticmethod
    def _verify(
        assets: Sequence[MinedAsset], segments: Sequence[TranscriptSegment]
    ) -> list[MinedAsset]:
        """Drop model assets whose `source_quote` is not in the real transcript.

        Same rule as the evaluator's evidence check: a "golden phrase" nobody actually
        said is not knowledge, it is invention.
        """
        haystack = " ".join(normalize(s.text) for s in segments)
        folded = re.sub(r"\s+", "", haystack)
        kept: list[MinedAsset] = []
        for asset in assets:
            quote = re.sub(r"\s+", "", normalize(asset.source_quote))
            if asset.kind is AssetKind.SCENARIO_SEED and not quote:
                # scenario seeds are syntheses, not quotes
                kept.append(asset)
                continue
            if len(quote) >= 4 and quote in folded:
                kept.append(asset)
            else:
                log.warning("mining.unverifiable_quote", kind=str(asset.kind))
        return kept


def _dedupe(assets: Sequence[MinedAsset]) -> list[MinedAsset]:
    best: dict[tuple[str, str], MinedAsset] = {}
    for asset in assets:
        key = (str(asset.kind), re.sub(r"\s+", "", normalize(asset.body))[:60])
        current = best.get(key)
        if current is None or asset.confidence > current.confidence:
            best[key] = asset
    return sorted(best.values(), key=lambda a: (str(a.kind), -a.confidence))


def to_playbook_entries(assets: Sequence[MinedAsset]) -> list[dict[str, Any]]:
    """Shape published assets for the playbook / scenario-seed consumers (§13)."""
    return [
        {
            "id": asset.id,
            "kind": str(asset.kind),
            "title": asset.title,
            "body": asset.body,
            "source_quote": asset.source_quote,
            "skill": asset.skill,
            "objection_kind": asset.objection_kind,
            "confidence": asset.confidence,
            "status": str(asset.status),
            "reviewer_id": asset.reviewer_id,
            "compliance_note": asset.compliance_note,
        }
        for asset in assets
        if asset.status is ReviewStatus.PUBLISHED
    ]


__all__ = [
    "REDACTED",
    "AnonymisationResult",
    "AssetKind",
    "KnowledgeMiner",
    "MinedAsset",
    "MiningAgent",
    "MiningOutput",
    "MiningRequest",
    "MiningRun",
    "ReviewRequiredError",
    "ReviewStatus",
    "TranscriptSegment",
    "anonymise",
    "classify_topic",
    "extract_objections",
    "mine_best_responses",
    "segment",
    "to_playbook_entries",
]
