#!/usr/bin/env python3
"""Seed the specification's demo dataset — spec §59 (核心 Demo 情境).

What this creates
-----------------
One coherent, self-consistent slice of the product, enough to walk the whole
§5.2 loop without touching the UI's mock fixtures:

* one Organization + one b2b Workspace
* four users, one per §9 role: trainee / coach / manager / admin
* the 陳先生 persona from §59, including the hidden state (§16.3)
* an insurance-sales Scenario whose success condition is §59's, verbatim
* a Rubric carrying all ten §26.1 skill weights
* a small KnowledgeBase with real chunk text, citations and compliance rules

Design notes
------------
``apps/api`` is being written in parallel by another team, so this script
imports from ``app.*`` **optimistically** and degrades in a defined way:

1. Build the payload. Plain Python data; always works.
2. Validate it against ``app.domain`` Pydantic models when they are importable.
   This is where a field-name drift between the seed and the contract shows up.
3. Persist, trying in order:
     a. ``app.db.seed.seed_demo(payload)`` — the documented integration hook.
        If the API team implements one function, this script needs no further
        knowledge of the schema. Preferred.
     b. Generic SQLAlchemy insert by reflecting ``app.db.models``: for each
        entity, find the model class, filter the payload down to columns the
        model actually declares, insert in dependency order.
     c. Write ``infra/seed/demo-seed.json`` and say so loudly. Exit code 3.

Nothing here silently half-succeeds. Every unresolved name is reported by its
exact dotted path with what it was needed for.

Usage
-----
    python database/seeds/seed.py                # validate + persist
    python database/seeds/seed.py --dry-run      # validate only, never write
    python database/seeds/seed.py --json-only    # skip persistence, write fixture
    python database/seeds/seed.py --out PATH     # fixture destination
    python database/seeds/seed.py --force        # re-seed over existing demo rows

Run it from anywhere; paths are resolved from this file.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = REPO_ROOT / "apps" / "api"

# apps/api is not installed as a package in every workflow (host run without a
# venv install, `python - < seed.py` inside the container). Make `app.*`
# importable either way before anything tries.
for candidate in (API_ROOT, REPO_ROOT):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

# =============================================================================
# Output helpers
# =============================================================================

_TTY = sys.stdout.isatty()


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _TTY else text


def step(msg: str) -> None:
    print(f"\n{_c('34', '▸')} {msg}")


def ok(msg: str) -> None:
    print(f"  {_c('32', '✓')} {msg}")


def warn(msg: str) -> None:
    print(f"  {_c('33', '!')} {msg}")


def bad(msg: str) -> None:
    print(f"  {_c('31', '✗')} {msg}", file=sys.stderr)


def note(msg: str) -> None:
    print(f"    {_c('2', msg)}")


# =============================================================================
# Optimistic resolution of names owned by another team
# =============================================================================


class Missing:
    """Every ``app.*`` name this script wanted and did not get.

    Collected rather than raised, so one run reports the full list instead of
    failing on the first import and hiding the other nine.
    """

    def __init__(self) -> None:
        self.items: list[tuple[str, str]] = []

    def add(self, dotted: str, needed_for: str) -> None:
        self.items.append((dotted, needed_for))

    def __bool__(self) -> bool:
        return bool(self.items)

    def report(self) -> None:
        if not self.items:
            return
        warn(f"{len(self.items)} name(s) in apps/api were not available:")
        width = max(len(d) for d, _ in self.items)
        for dotted, needed_for in self.items:
            note(f"{dotted.ljust(width)}   needed for: {needed_for}")


MISSING = Missing()


def resolve(dotted: str, needed_for: str) -> Any | None:
    """Import ``pkg.mod:Name`` (or ``pkg.mod``) and return it, or None.

    Records the miss instead of raising. ``ImportError`` and ``AttributeError``
    are the expected outcomes while apps/api is being scaffolded; anything else
    (a syntax error in a half-written module, say) is re-raised because it is a
    real bug the author needs to see.
    """
    module_path, _, attr = dotted.partition(":")
    try:
        module = __import__(module_path, fromlist=["_"])
    except ImportError:
        MISSING.add(dotted, needed_for)
        return None
    if not attr:
        return module
    obj = getattr(module, attr, None)
    if obj is None:
        MISSING.add(dotted, needed_for)
    return obj


# =============================================================================
# Deterministic ids
#
# UUIDv5 over a fixed namespace, so re-running the seed produces the SAME ids.
# That is what makes it idempotent, keeps bookmarked demo URLs working across a
# reset, and lets the browser mock fixtures reference real rows by id.
# =============================================================================

_NS = uuid.uuid5(uuid.NAMESPACE_URL, "https://ai-coach.local/seed/v1")


def sid(*parts: str) -> str:
    # `.hex`, not `str()`: apps/api's IdMixin is String(32) holding UUID hex, so
    # the 36-char hyphenated form overflows the column. Same uuid, same
    # determinism, just the storage format the schema actually declares.
    return uuid.uuid5(_NS, "/".join(parts)).hex


NOW = datetime.now(UTC).replace(microsecond=0).isoformat()

ORG_ID = sid("org")
WS_ID = sid("workspace")
TEAM_ID = sid("team")
KB_ID = sid("kb")
DOC_ID = sid("doc")
PERSONA_ID = sid("persona")
SCENARIO_ID = sid("scenario")
RUBRIC_ID = sid("rubric")

# =============================================================================
# The demo dataset
#
# Fictional organisation and people. Product names, rates and figures below are
# illustrative and deliberately generic — the point is to exercise retrieval,
# citation and compliance checking, not to describe a real policy.
# =============================================================================

ORGANIZATION: dict[str, Any] = {
    "id": ORG_ID,
    # The ORM requires a slug; the shared contract does not declare one, so it
    # is storage-only. Stated rather than generated because it is not derivable
    # from a CJK name, and stable across re-seeds like the ids.
    "_orm_extra": {"slug": "anrui-life-demo"},
    "name": "安睿人壽（示範用虛構公司）",
    "created_at": NOW,
}

WORKSPACE: dict[str, Any] = {
    "id": WS_ID,
    "tenant_id": ORG_ID,
    "_orm_extra": {"slug": "personal-life-training"},
    "name": "個人壽險業務訓練中心",
    "kind": "b2b",
    "created_at": NOW,
    "updated_at": NOW,
}

TEAM: dict[str, Any] = {
    "id": TEAM_ID,
    "tenant_id": ORG_ID,
    "workspace_id": WS_ID,
    "name": "北一區業務二部",
    "department": "個人壽險事業群",
    "created_at": NOW,
    "updated_at": NOW,
}


DEMO_PASSWORD = "demo-only-not-a-secret"

_DEMO_HASH_CACHE: str | None = None


def _demo_password_hash() -> str:
    """Hash the demo password with the API's own hasher.

    Computed once and reused: bcrypt is deliberately slow, and four users would
    otherwise cost four full rounds for no benefit — they share one password by
    design. Falls back to a marker when apps/api is not importable, so building
    the JSON fixture still works on a machine with no API venv; the marker is not
    a valid hash, so it can never accidentally authenticate.
    """
    global _DEMO_HASH_CACHE
    if _DEMO_HASH_CACHE is not None:
        return _DEMO_HASH_CACHE
    hasher = resolve("app.core.security:hash_password", "hashing the demo password")
    if hasher is None:
        _DEMO_HASH_CACHE = "!unhashed-seed-password"
    else:
        _DEMO_HASH_CACHE = hasher(DEMO_PASSWORD)
    return _DEMO_HASH_CACHE


def _user(key: str, email: str, name: str, roles: list[str], in_team: bool = True) -> dict[str, Any]:
    return {
        "id": sid("user", key),
        "tenant_id": ORG_ID,
        "workspace_id": WS_ID,
        "email": email,
        "display_name": name,
        "roles": roles,
        "team_ids": [TEAM_ID] if in_team else [],
        "created_at": NOW,
        "updated_at": NOW,
        # Local-only demo credential. It is never a real secret and never leaves
        # a dev machine; `apps/api/app/core/config.py` refuses to boot outside
        # APP_ENV=local with placeholder secrets, which is the backstop.
        #
        # This used to say "the API is expected to hash this on insert" — but the
        # reflective ORM path writes columns directly and no application code
        # runs, so `password_hash` stayed NULL and every demo login returned 401.
        # Hash it here, at build time, via the API's own hasher so the cost
        # factor and scheme match what the login path verifies against.
        "_demo_password": DEMO_PASSWORD,
        "_orm_extra": {"password_hash": _demo_password_hash()},
    }


# Roles and team membership are join tables, not columns on the user. The
# reflective inserter drops `roles` / `team_ids` from the user row (the model has
# no such columns), so without these the demo users log in with no roles and no
# workspace — authenticated but unable to see anything.
ROLE_ASSIGNMENTS: list[dict[str, Any]] = []
USER_TEAMS: list[dict[str, Any]] = []


def _expand_memberships(users: list[dict[str, Any]]) -> None:
    for user in users:
        for role in user["roles"]:
            ROLE_ASSIGNMENTS.append(
                {
                    "id": sid("role", user["id"], role),
                    "tenant_id": ORG_ID,
                    "workspace_id": WS_ID,
                    "user_id": user["id"],
                    "role": role,
                    "created_at": NOW,
                    "updated_at": NOW,
                }
            )
        for team_id in user["team_ids"]:
            USER_TEAMS.append({"user_id": user["id"], "team_id": team_id})


USERS: list[dict[str, Any]] = [
    _user("trainee", "trainee@demo.ai-coach.local", "林佳蓉", ["trainee"]),
    _user("coach", "coach@demo.ai-coach.local", "王志明", ["coach", "reviewer"]),
    _user("manager", "manager@demo.ai-coach.local", "張淑芬", ["manager", "coach"]),
    _user("admin", "admin@demo.ai-coach.local", "系統管理員", ["admin"], in_team=False),
]

_expand_memberships(USERS)

# -----------------------------------------------------------------------------
# Persona — §59 verbatim where the spec is explicit.
#
# 陳先生 / 38 / engineer / married / two children
# Rational, price-sensitive, family-oriented, skeptical
# Main objection : 「我已經有保險了，為什麼還要多買？」
# Hidden need    : 擔心家庭在重大事故後的財務保障
# -----------------------------------------------------------------------------

PERSONA: dict[str, Any] = {
    "id": PERSONA_ID,
    "tenant_id": ORG_ID,
    "workspace_id": WS_ID,
    "name": "陳先生",
    "version": 1,
    "status": "published",
    "gender": "male",
    "age": 38,
    "occupation": "軟體工程師",
    "industry": "半導體 / 電子製造",
    "background": (
        "38 歲，已婚，兩名小孩（7 歲、4 歲）。新竹科學園區半導體公司資深軟體工程師，"
        "家庭年收入約新台幣 210 萬，房貸餘額約 780 萬、剩 22 年。"
        "公司有團體保險，另有一張十年前投保的終身壽險與一張醫療附約，"
        "自己不清楚保障內容細節，只記得「每年繳三萬多」。"
        "工作理性、習慣看數字，對業務員的推銷話術非常敏感，"
        "會直接追問「這個數字怎麼算出來的」。"
    ),
    "language": "zh-TW",
    "locale": "zh-TW",
    # §16.2 sliders, 0–100. Read together these produce §59's four adjectives:
    # rational (high product_knowledge relative to trust), price-sensitive,
    # family-oriented (see hidden.trigger_points), skeptical (low trust /
    # high resistance).
    "traits": {
        "trust": 32,
        "patience": 55,
        "price_sensitivity": 82,
        "risk_aversion": 68,
        "product_knowledge": 45,
        "resistance": 70,
        "openness": 44,
    },
    # §16.3 — coach/admin only. Never serialised to a trainee-scoped response.
    "hidden": {
        "primary_goal": "在不明顯增加月支出的前提下，確認家庭現有保障到底夠不夠",
        "hidden_need": "擔心家庭在重大事故後的財務保障 —— 若自己失去工作能力，"
        "房貸與兩個小孩的教育費沒有人接手",
        "main_concern": "多繳的保費會壓縮小孩的教育金與房貸提前還款計畫",
        "budget": 3000,
        "trigger_points": [
            "提到小孩未來的教育費用",
            "提到房貸餘額由誰承擔",
            "同事或親友的重大傷病實際案例",
            "用他自己的數字做保障缺口試算",
            "承認現有保單也有做得不錯的地方",
        ],
        "objections": [
            "我已經有保險了，為什麼還要多買？",
            "我公司有團保，這樣還不夠嗎？",
            "一個月三千塊，一年就是三萬六，這個錢我寧願存起來。",
            "你們業務不都是這樣講，最後還是要我買最貴的那張。",
            "我要跟我太太討論一下，你先給我資料。",
        ],
        "forbidden_knowledge": [
            "自己保單的完整條款與給付項目細節（只記得大概保費）",
            "同業商品的費率與比較",
            "業務員的佣金結構",
            "保險法規條文",
        ],
        "opening_attitude": "禮貌但明顯戒備。語速偏快，一開場就想知道「這次要談多久」，"
        "傾向用「我已經有保險了」快速收束話題。",
        "exit_condition": "連續兩次感覺到「被推銷商品」而不是「被了解需求」，"
        "或對方給不出數字依據時，以「我再想想」結束對話。",
        "success_condition": "願意主動提供家庭財務細節（房貸、教育金規劃、團保內容），"
        "並同意讓對方做一次保障缺口試算。",
    },
    "voice": {
        "provider": "elevenlabs",
        "voice_id": "REPLACE_WITH_TENANT_VOICE_ID",
        "language": "zh-TW",
        "speed": 1.05,
        "stability": 0.55,
        "emotion_style": "reserved_analytical",
    },
    "created_at": NOW,
    "updated_at": NOW,
}

# -----------------------------------------------------------------------------
# Scenario — success condition is §59's, unchanged.
# -----------------------------------------------------------------------------

SCENARIO: dict[str, Any] = {
    "id": SCENARIO_ID,
    "tenant_id": ORG_ID,
    "workspace_id": WS_ID,
    "name": "已有保障客戶的保障缺口對談",
    "version": 1,
    "status": "published",
    "description": (
        "客戶已經有保單，並以「我已經有保險了」作為第一道防線。"
        "學員必須先完成需求探索、確認現有保障內容，"
        "再用客戶自己的數字說明缺口，而不是直接推銷新商品。"
    ),
    "industry": "保險 / 個人壽險",
    "training_type": "objection_handling",
    # A scenario points at a persona; it does not pin the persona's version.
    # Version pinning happens on TrainingSession at session-creation time, which
    # is what makes a finished report reproducible (§54 / ADR-0008). Pinning it
    # here would freeze every future session to whatever the persona looked like
    # when the scenario was authored.
    "persona_id": PERSONA_ID,
    "knowledge_base_ids": [KB_ID],
    "difficulty": "medium",
    "mode": "training",
    "opening_context": (
        "陳先生是你的既有客戶轉介。你們約在他公司附近的咖啡廳，他只給你 20 分鐘。"
        "他坐下來第一句話是：「我已經有保險了，為什麼還要多買？」"
    ),
    "learning_objectives": [
        "在提出任何商品前完成需求探索（家庭結構、房貸、團保、現有保單）",
        "用客戶自己的數字說明保障缺口，而非用商品話術",
        "正確區分團體保險與個人保單的保障延續性",
        "處理價格異議時不貶低現有保單、不承諾未來給付",
        "全程不觸發 critical 等級合規風險",
    ],
    "required_knowledge": [
        "定期壽險與終身壽險的差異",
        "重大傷病一次金的給付觸發條件",
        "實支實付醫療的自負額與限額概念",
        "團體保險的離職失效特性",
        "保障缺口的計算方式",
    ],
    "required_talking_points": [
        "詢問家庭結構與經濟責任（房貸餘額、教育金時程）",
        "確認現有保單的保障項目與保額，而不是只問保費",
        "確認團保的保障範圍與離職後是否延續",
        "以客戶自身數字進行一次保障缺口試算",
        "明確說明本次對話不構成投資或稅務建議",
    ],
    "key_objections": [
        "我已經有保險了，為什麼還要多買？",
        "我公司有團保，這樣還不夠嗎？",
        "一個月三千塊，我寧願存起來。",
        "你們業務不都是這樣講。",
        "我要跟我太太討論一下。",
    ],
    "restricted_topics": [
        "保證投資報酬率",
        "稅務規劃建議",
        "同業商品的具體費率比較",
        "醫療診斷或病情判斷",
    ],
    # §59 Success, exactly.
    "success_condition": (
        "完成需求探索 + 正確說明保障 + 不產生 Critical Compliance Risk "
        "+ Trust >= 70 + Overall Score >= 80"
    ),
    "failure_condition": (
        "未完成需求探索即進入商品說明，或出現 critical 合規風險（保證給付／"
        "誤導性陳述），或客戶 resistance 連續上升至 85 以上並結束對話"
    ),
    "time_limit_seconds": 900,
    "max_turns": 40,
    "minimum_score": 80,
    "rubric_id": RUBRIC_ID,
    "created_at": NOW,
    "updated_at": NOW,
}

# Machine-checkable form of the §59 success condition. The prose above is what a
# coach reads; this is what the Evaluator Agent can assert against. Keeping both
# — and keeping them adjacent — is deliberate: §27 forbids a score without
# evidence, and a prose-only condition cannot be evidenced.
SCENARIO_SUCCESS_ASSERTIONS: list[dict[str, Any]] = [
    {"key": "needs_discovery_complete", "kind": "phase_reached", "value": "presentation",
     "description": "需求探索完成 — scenario_phase 至少推進到 presentation"},
    {"key": "coverage_explained_correctly", "kind": "skill_min", "skill": "product_knowledge",
     "value": 70, "description": "正確說明保障 — product_knowledge >= 70 且引用有 citation"},
    {"key": "no_critical_compliance", "kind": "max_compliance_risk", "value": "high",
     "description": "不產生 Critical Compliance Risk（high 可接受，critical 不可）"},
    {"key": "trust_threshold", "kind": "persona_state_min", "field": "trust", "value": 70,
     "description": "Trust >= 70"},
    {"key": "overall_threshold", "kind": "overall_score_min", "value": 80,
     "description": "Overall Score >= 80"},
]

# -----------------------------------------------------------------------------
# Rubric — all ten §26.1 dimensions. Weights sum to 100.
#
# The distribution is opinionated on purpose: this scenario is about discovery
# and objection handling, so those carry the most weight, and closing is scored
# but not the point. A different scenario should ship a different rubric rather
# than reusing this one.
# -----------------------------------------------------------------------------

SKILL_WEIGHTS: dict[str, int] = {
    "needs_discovery": 16,
    "objection_handling": 14,
    "empathy": 11,
    "trust_building": 11,
    "professional_knowledge": 10,
    "compliance": 10,
    "communication_clarity": 9,
    "product_knowledge": 8,
    "closing_ability": 6,
    "goal_achievement": 5,
}
assert sum(SKILL_WEIGHTS.values()) == 100, "rubric weights must sum to 100"

RUBRIC: dict[str, Any] = {
    "id": RUBRIC_ID,
    "tenant_id": ORG_ID,
    "workspace_id": WS_ID,
    "name": "個人壽險 · 保障缺口對談評分表 v1",
    "version": 1,
    "status": "published",
    "weights": SKILL_WEIGHTS,
    "pass_threshold": 80,
    "required_evidence": [
        "每一個維度至少一段 transcript 引用（§27）",
        "合規維度扣分必須指向具體 policy_rule",
        "低於 60 分的維度必須附 better_approach",
    ],
    "forbidden_behaviors": [
        "保證投資報酬或保證給付",
        "以恐嚇方式促成成交",
        "貶低客戶現有保單或同業商品",
        "在客戶未同意前記錄或轉述其健康資訊",
        "回答醫療診斷或病情判斷問題",
    ],
    "created_at": NOW,
    "updated_at": NOW,
}

# -----------------------------------------------------------------------------
# Knowledge base — small but real. Chunk text is what the Knowledge Agent
# retrieves and what every citation in the demo points at (§12.5).
# -----------------------------------------------------------------------------

KNOWLEDGE_BASE: dict[str, Any] = {
    "id": KB_ID,
    "tenant_id": ORG_ID,
    "workspace_id": WS_ID,
    "name": "個人壽險與重大傷病商品知識庫",
    "description": "示範用商品概念與合規紅線摘要。內容為教學用簡化描述，非保單條款。",
    "status": "published",
    "document_count": 1,
    "chunk_count": 6,
    # NOTE (§2.1 correction): this names an OpenAI *API* embedding model. It is
    # not a self-hostable open model and cannot run inside AMD AUP. A private
    # deployment must switch this to an approved open model (BGE / multilingual
    # -e5) and re-embed — the dimension changes, so the Qdrant collection is
    # recreated, not migrated.
    "embedding_model": "text-embedding-3-large",
    # §39 Knowledge Access Control.
    "acl": {
        "scope": "workspace",
        "subject_ids": [WS_ID],
        "permissions": ["view", "use_for_rag"],
    },
    "created_at": NOW,
    "updated_at": NOW,
}

DOCUMENT: dict[str, Any] = {
    "id": DOC_ID,
    "tenant_id": ORG_ID,
    "workspace_id": WS_ID,
    "knowledge_base_id": KB_ID,
    "filename": "個人壽險商品概念與合規紅線.md",
    "source_kind": "manual",
    "size_bytes": 0,  # recomputed below from the chunk text
    "state": "ready",
    "progress": 100,
    "active_version": 1,
    "created_at": NOW,
    "updated_at": NOW,
}

_CHUNK_TEXT: list[tuple[str, str, list[str]]] = [
    (
        "定期壽險與終身壽險",
        "定期壽險在約定年期內提供身故／全殘保障，期滿無給付、無解約金，"
        "因此同樣保額的保費明顯低於終身壽險。終身壽險保障終身並累積保單價值準備金，"
        "但相同保額下的保費通常是定期壽險的數倍。"
        "當客戶的經濟責任集中在特定期間（例如房貸剩餘年期、子女成年前），"
        "以定期壽險補足高額保障是常見的做法，"
        "與客戶既有的終身壽險並非互相取代，而是責任期間的補強。",
        ["壽險", "保障規劃", "定期壽險", "終身壽險"],
    ),
    (
        "重大傷病一次金",
        "重大傷病險以「取得重大傷病證明」作為給付觸發條件，一次性給付約定保額，"
        "給付用途不受限制，可用於支付非健保給付的自費療程、看護費用或家庭生活支出。"
        "與實支實付醫療的差異在於：實支實付是事後憑單據就醫療費用理賠，"
        "重大傷病一次金是確診後即給付現金，用來承接治療期間的收入中斷。"
        "須留意各項目的認定範圍以保單條款與主管機關公告為準。",
        ["重大傷病", "一次金", "收入中斷"],
    ),
    (
        "實支實付醫療的自負額與限額",
        "實支實付醫療針對住院、手術與雜費，依實際支出在各項限額內理賠。"
        "重點在三個數字：住院日額或病房費限額、手術費限額、醫療雜費限額。"
        "自費醫材與新式療法通常落在雜費項目，"
        "因此雜費限額往往比日額更能反映實際自費負擔能力。"
        "說明時應以限額結構解釋，不得暗示「所有費用都會全額理賠」。",
        ["醫療險", "實支實付", "限額"],
    ),
    (
        "團體保險與個人保單的差異",
        "團體保險由企業投保，保費低、核保寬鬆，是很好的基礎保障，"
        "但保障隨僱傭關係存續：離職、退休或公司變更保單條件時即失效或降低，"
        "且保額通常以年薪倍數設計，未依個別家庭責任調整。"
        "個人保單則不因工作變動而中斷。"
        "與客戶討論團保時，正確說法是「團保是基礎、個人保單負責延續性」，"
        "不可暗示團保沒有價值。",
        ["團保", "個人保單", "延續性"],
    ),
    (
        "保障缺口的計算方式",
        "常用的責任基礎法：需求保額 ≈ 未清償負債 ＋ 子女教育費用現值 "
        "＋ 家庭生活費用（配偶預期需支撐年數 × 年支出）－ 現有保障 － 可動用資產。"
        "以房貸餘額 780 萬、兩名子女教育金合計 400 萬、"
        "家庭年支出 90 萬需支撐 10 年、現有壽險保障 300 萬、可動用資產 150 萬計算，"
        "缺口約為 780 ＋ 400 ＋ 900 － 300 － 150 ＝ 1,630 萬。"
        "每一項輸入都必須由客戶自己確認，試算結果須註明假設條件。",
        ["保障缺口", "試算", "責任基礎法"],
    ),
    (
        "合規紅線與禁止話術",
        "禁止：保證投資報酬率或保證給付；以「一定會理賠」描述任何條款；"
        "提供稅務規劃或投資建議；就客戶病情做醫療判斷；"
        "為促成成交而誇大風險或貶低同業商品；"
        "在客戶未同意前記錄、轉述其健康或財務資訊。"
        "應揭露：本次對話為保障需求討論，實際給付以保單條款與核保結果為準；"
        "任何試算為假設情境，非承諾。",
        ["合規", "禁止話術", "揭露義務"],
    ),
]

CHUNKS: list[dict[str, Any]] = []
for index, (section, text, tags) in enumerate(_CHUNK_TEXT):
    CHUNKS.append(
        {
            "id": sid("chunk", str(index)),
            "document_id": DOC_ID,
            # Denormalised onto the row by the ORM: every retrieval query filters
            # by tenant + workspace, and a chunk that cannot be filtered without
            # a join to its document is a chunk that will eventually be returned
            # across a tenant boundary (§39 / §74).
            "_orm_extra": {
                "knowledge_base_id": KB_ID,
                "tenant_id": ORG_ID,
                "workspace_id": WS_ID,
            },
            "document_version": 1,
            "index": index,
            "text": text,
            # Rough CJK estimate: ~1 token per character for zh with most
            # tokenisers. Good enough for a seed; the real value is written by
            # the embedder (§65).
            "token_count": len(text),
            "page": 1 + index // 2,
            "section": section,
            "metadata": {
                "language": "zh-TW",
                "doc_type": "product_concept" if index < 5 else "compliance_policy",
                "reviewed": True,
            },
            "tags": tags,
            "excluded_from_retrieval": False,
        }
    )

DOCUMENT["size_bytes"] = sum(len(c["text"].encode("utf-8")) for c in CHUNKS)

# The compliance rules the Compliance Agent (§19.5) checks this scenario
# against. They point at the chunk above so a finding can cite a policy source
# rather than a hardcoded string.
COMPLIANCE_RULES: list[dict[str, Any]] = [
    {
        "id": sid("rule", "guaranteed_return"),
        "tenant_id": ORG_ID,
        "workspace_id": WS_ID,
        "code": "INS-001",
        "finding_type": "false_promise",
        "severity": "critical",
        "title": "保證報酬或保證給付",
        "pattern_hint": "保證|一定會理賠|穩賺|絕對不會虧",
        "policy_rule": "不得就投資報酬或保險給付作出保證性陳述",
        "source_chunk_id": CHUNKS[5]["id"],
    },
    {
        "id": sid("rule", "tax_advice"),
        "tenant_id": ORG_ID,
        "workspace_id": WS_ID,
        "code": "INS-002",
        "finding_type": "unauthorized_advice",
        "severity": "high",
        "title": "提供稅務或投資建議",
        "pattern_hint": "節稅|遺產稅|投資報酬率|配置比例",
        "policy_rule": "業務人員不得提供稅務規劃或投資建議",
        "source_chunk_id": CHUNKS[5]["id"],
    },
    {
        "id": sid("rule", "medical_judgement"),
        "tenant_id": ORG_ID,
        "workspace_id": WS_ID,
        "code": "INS-003",
        "finding_type": "unauthorized_advice",
        "severity": "high",
        "title": "醫療診斷或病情判斷",
        "pattern_hint": "你這個應該是|不用擔心那個病|一定不會復發",
        "policy_rule": "不得就客戶病情作醫療判斷",
        "source_chunk_id": CHUNKS[5]["id"],
    },
    {
        "id": sid("rule", "pii_without_consent"),
        "tenant_id": ORG_ID,
        "workspace_id": WS_ID,
        "code": "INS-004",
        "finding_type": "privacy_issue",
        "severity": "high",
        "title": "未經同意記錄健康或財務資訊",
        "pattern_hint": "我先幫你記下來|我跟主管說一下你的狀況",
        "policy_rule": "取得客戶明確同意後方可記錄或轉述其健康／財務資訊",
        "source_chunk_id": CHUNKS[5]["id"],
    },
    {
        "id": sid("rule", "disparage_competitor"),
        "tenant_id": ORG_ID,
        "workspace_id": WS_ID,
        "code": "INS-005",
        "finding_type": "misleading_statement",
        "severity": "medium",
        "title": "貶低現有保單或同業商品",
        "pattern_hint": "你那張保單根本沒用|他們家的都很爛",
        "policy_rule": "不得以貶低方式比較同業或客戶既有商品",
        "source_chunk_id": CHUNKS[3]["id"],
    },
]

# =============================================================================
# Payload assembly
#
# Insertion order matters: it is the FK dependency order. `seed_demo` hooks and
# the reflective inserter both consume it in this sequence.
# =============================================================================


def build_payload() -> dict[str, Any]:
    return {
        "_meta": {
            "generator": "database/seeds/seed.py",
            "spec_section": "§59 核心 Demo 情境",
            "generated_at": NOW,
            "idempotent": True,
            "id_scheme": "uuid5 over a fixed namespace — re-running yields identical ids",
        },
        "organizations": [ORGANIZATION],
        "workspaces": [WORKSPACE],
        "teams": [TEAM],
        "users": USERS,
        "knowledge_bases": [KNOWLEDGE_BASE],
        "documents": [DOCUMENT],
        "chunks": CHUNKS,
        "compliance_rules": COMPLIANCE_RULES,
        "rubrics": [RUBRIC],
        "personas": [PERSONA],
        "scenarios": [SCENARIO],
        "scenario_success_assertions": SCENARIO_SUCCESS_ASSERTIONS,
        "role_assignments": ROLE_ASSIGNMENTS,
        "user_teams": USER_TEAMS,
    }


# =============================================================================
# Stage 2 — validate against the Pydantic mirror when it exists
# =============================================================================

# entity key -> candidate class names in app.domain, most likely first.
_DOMAIN_CANDIDATES: dict[str, tuple[str, ...]] = {
    "organizations": ("Organization",),
    "workspaces": ("Workspace",),
    "teams": ("Team",),
    "users": ("User",),
    "role_assignments": ("RoleAssignment",),
    "user_teams": ("user_team",),
    "knowledge_bases": ("KnowledgeBase",),
    "documents": ("KnowledgeDocument", "Document"),
    "chunks": ("Chunk",),
    "rubrics": ("Rubric",),
    "personas": ("Persona",),
    "scenarios": ("Scenario",),
}

# app.domain deliberately keeps one module per entity family rather than a flat
# namespace, and its __init__ does not necessarily re-export everything. Search
# the package first (in case it does), then each submodule.
_DOMAIN_MODULES = (
    "app.domain",
    "app.domain.common",
    "app.domain.tenant",
    "app.domain.identity",
    "app.domain.knowledge",
    "app.domain.persona",
    "app.domain.scenario",
    "app.domain.session",
    "app.domain.evaluation",
    "app.domain.question",
    "app.domain.analytics",
    "app.domain.audit",
)


def _domain_index() -> dict[str, Any]:
    """Flat {class name: class} index across app.domain and its submodules."""
    index: dict[str, Any] = {}
    for module_path in _DOMAIN_MODULES:
        try:
            module = __import__(module_path, fromlist=["_"])
        except ImportError:
            continue
        for name in dir(module):
            if name.startswith("_") or name in index:
                continue
            obj = getattr(module, name)
            # Anything with model_validate is a Pydantic v2 model.
            if isinstance(obj, type) and hasattr(obj, "model_validate"):
                index[name] = obj
    return index


def validate_payload(payload: dict[str, Any]) -> bool:
    """Round-trip each entity through its Pydantic model, if importable.

    This is the highest-value cheap check in the script: it is where a field
    the seed calls ``hidden_need`` and the contract calls ``hiddenNeed`` gets
    caught, before anything touches a database.
    """
    index = _domain_index()
    if not index:
        warn("app.domain is not importable — payload not validated against Pydantic")
        note("This is expected while apps/api/app/domain is being written.")
        return False

    checked = 0
    problems = 0
    for key, candidates in _DOMAIN_CANDIDATES.items():
        model = next((index[n] for n in candidates if n in index), None)
        if model is None:
            MISSING.add(f"app.domain:{candidates[0]}", f"validating {key}")
            continue
        for row in payload.get(key, []):
            # Strip seed-only keys (leading underscore) before validation.
            data = {k: v for k, v in row.items() if not k.startswith("_")}
            try:
                model.model_validate(data)
                checked += 1
            except Exception as exc:  # noqa: BLE001 — we want the message, whatever it is
                problems += 1
                bad(f"{key}: {row.get('name') or row.get('email') or row.get('id')}")
                note(f"{type(exc).__name__}: {str(exc).splitlines()[0]}")

    if problems:
        bad(f"{problems} row(s) failed contract validation")
        note("The seed and the Pydantic contract disagree. Fix the seed if the")
        note("contract is right; if the contract is wrong, change the TypeScript")
        note("first (docs/adr/0002) and mirror it back.")
        return False

    ok(f"{checked} row(s) validated against app.domain")
    return True


# =============================================================================
# Stage 3 — persistence
# =============================================================================


def persist_via_hook(payload: dict[str, Any], force: bool) -> bool:
    """Preferred path: one function in apps/api owns the schema knowledge.

    Expected signature (either sync or returning an awaitable):

        def seed_demo(payload: dict[str, Any], *, force: bool = False) -> int
            '''Insert or upsert the payload. Returns rows written.'''

    Implementing this in ``apps/api/app/db/seed.py`` means this script never
    needs to learn the ORM.
    """
    hook = resolve("app.db.seed:seed_demo", "persisting the demo dataset (preferred path)")
    if hook is None:
        return False

    step("Persisting via app.db.seed.seed_demo()")
    try:
        result = hook(payload, force=force)
    except TypeError:
        result = hook(payload)  # tolerate a hook without the keyword

    if hasattr(result, "__await__"):
        import asyncio

        result = asyncio.run(result)  # type: ignore[arg-type]

    ok(f"seed_demo() completed{f' — {result} rows' if isinstance(result, int) else ''}")
    return True


# entity key -> candidate SQLAlchemy model class names.
_ORM_CANDIDATES: dict[str, tuple[str, ...]] = {
    "organizations": ("Organization",),
    "workspaces": ("Workspace",),
    "teams": ("Team",),
    "users": ("User",),
    "role_assignments": ("RoleAssignment",),
    "user_teams": ("user_team",),
    "knowledge_bases": ("KnowledgeBase",),
    "documents": ("KnowledgeDocument", "Document"),
    "chunks": ("Chunk",),
    "compliance_rules": ("ComplianceRule",),
    "rubrics": ("Rubric",),
    "personas": ("Persona",),
    "scenarios": ("Scenario",),
}


def persist_via_orm(payload: dict[str, Any], force: bool) -> bool:
    """Fallback: reflect app.db.models and insert generically.

    For each entity, the payload dict is narrowed to the columns the model
    actually declares. That is what lets this survive a schema that is close to
    but not identical to shared — an extra column is fine, a renamed one
    is reported.
    """
    models = resolve("app.db.models", "generic ORM insert (fallback path)")
    factory = None
    for dotted in (
        # What apps/api actually exposes. It is a *getter* returning the
        # sessionmaker rather than a module-level singleton, so that the engine
        # is built from settings at call time instead of at import time.
        "app.db.session:get_sessionmaker",
        # Older/other shapes, kept so a rename does not silently fall through to
        # "nothing was inserted" the way it just did.
        "app.db.session:session_factory",
        "app.db.session:async_session_factory",
        "app.db.session:SessionLocal",
        "app.db:session_factory",
    ):
        factory = resolve(dotted, "opening a database session")
        if factory is not None:
            # `get_sessionmaker()` hands back the sessionmaker; the others are
            # already one. Normalise so the caller below does not have to care.
            if dotted.endswith(":get_sessionmaker"):
                factory = factory()
            break

    if models is None or factory is None:
        return False

    step("Persisting via generic ORM insert")
    warn("Using the reflective fallback. Implementing app.db.seed.seed_demo()")
    note("gives you control over upsert semantics and is the preferred path.")

    import asyncio
    import inspect

    async def _run_async() -> int:
        written = 0
        async with factory() as session:  # type: ignore[misc]
            written = await _insert_all_async(session, models, payload, force)
            await session.commit()
        return written

    def _run_sync() -> int:
        written = 0
        with factory() as session:  # type: ignore[misc]
            written = _insert_all_sync(session, models, payload, force)
            session.commit()
        return written

    probe = factory()
    is_async = hasattr(probe, "__aenter__") or inspect.iscoroutine(probe)
    if hasattr(probe, "close") and not is_async:
        probe.close()

    total = asyncio.run(_run_async()) if is_async else _run_sync()
    ok(f"{total} row(s) written")
    return True


def _coerce(value: Any, column: Any) -> Any:
    """Turn JSON scalars into what the driver expects for this column.

    The payload is written to disk as JSON before it is inserted, so timestamps
    arrive as ISO strings. psycopg would parse those; asyncpg will not — it
    raises `invalid input for query argument ... (expected a datetime.date or
    datetime.datetime instance, got 'str')` — so the conversion has to happen
    here rather than being left to the driver.
    """
    if value is None or not isinstance(value, str):
        return value
    python_type: Any
    try:
        python_type = column.type.python_type
    except (NotImplementedError, AttributeError):
        return value
    if python_type is datetime:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return value
        # Postgres TIMESTAMPTZ wants an aware datetime; a naive one from the
        # payload is UTC by construction (see _now()).
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    if python_type is date:
        try:
            return date.fromisoformat(value)
        except ValueError:
            return value
    if python_type is uuid.UUID:
        try:
            return uuid.UUID(value)
        except ValueError:
            return value
    return value


def _narrow(model: Any, row: dict[str, Any], entity: str) -> dict[str, Any] | None:
    """Drop seed-only keys and keys the model has no column for."""
    table = getattr(model, "__table__", None)
    if table is None:
        MISSING.add(f"app.db.models:{model!r}.__table__", f"inserting {entity}")
        return None
    columns = {c.name: c for c in table.columns}
    # `_orm_extra` carries columns the ORM requires but the shared contract does
    # not declare (a URL slug, say). Validation strips every `_`-prefixed key, so
    # these never reach the Pydantic models — which is the point: they are a
    # storage concern, not part of the cross-language contract (ADR-0002).
    merged = {**{k: v for k, v in row.items() if not k.startswith("_")}, **row.get("_orm_extra", {})}
    data = {k: _coerce(v, columns[k]) for k, v in merged.items() if k in columns}
    dropped = set(merged) - set(columns)
    if dropped:
        warn(f"{entity}: model has no column for {sorted(dropped)} — those values are not stored")
    required = {
        c.name
        for c in table.columns
        if not c.nullable and c.default is None and c.server_default is None
    }
    if missing := required - set(data):
        bad(f"{entity}: model requires {sorted(missing)} which the seed does not provide")
        return None
    return data


def _iter_models(models: Any, payload: dict[str, Any], entity_keys: list[str]) -> Any:
    for key in entity_keys:
        candidates = _ORM_CANDIDATES.get(key)
        if candidates is None:
            continue
        model = next((getattr(models, n) for n in candidates if hasattr(models, n)), None)
        if model is None:
            MISSING.add(f"app.db.models:{candidates[0]}", f"inserting {key}")
            continue
        yield key, model, payload.get(key, [])


_ORDER = [
    "organizations",
    "workspaces",
    "teams",
    "users",
    "role_assignments",
    "user_teams",
    "knowledge_bases",
    "documents",
    "chunks",
    "compliance_rules",
    "rubrics",
    "personas",
    "scenarios",
]


def _insert_all_sync(session: Any, models: Any, payload: dict[str, Any], force: bool) -> int:
    written = 0
    for key, model, rows in _iter_models(models, payload, _ORDER):
        for row in rows:
            data = _narrow(model, row, key)
            if data is None:
                continue
            existing = session.get(model, data.get("id"))
            if existing is not None and not force:
                continue
            if existing is not None:
                session.delete(existing)
                session.flush()
            session.add(model(**data))
            written += 1
        session.flush()
    return written


async def _purge_async(session: Any, models: Any, payload: dict[str, Any]) -> None:
    """Delete the demo rows in reverse dependency order.

    Deleting per-entity as we go (the old behaviour) removes a parent while its
    children are still present, so `--force` failed on the first FK it met:
    workspace has knowledge_base rows pointing at it. Clearing the whole set
    back-to-front first is the only order that holds.
    """
    for key, model, rows in _iter_models(models, payload, list(reversed(_ORDER))):
        for row in rows:
            row_id = row.get("id")
            if row_id is None:
                continue
            existing = await session.get(model, row_id)
            if existing is not None:
                await session.delete(existing)
        await session.flush()


async def _insert_all_async(session: Any, models: Any, payload: dict[str, Any], force: bool) -> int:
    if force:
        await _purge_async(session, models, payload)
    written = 0
    for key, model, rows in _iter_models(models, payload, _ORDER):
        for row in rows:
            data = _narrow(model, row, key)
            if data is None:
                continue
            if not force and await session.get(model, data.get("id")) is not None:
                continue
            session.add(model(**data))
            written += 1
        await session.flush()
    return written


def write_fixture(payload: dict[str, Any], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ok(f"wrote {out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out}")


# =============================================================================
# main
# =============================================================================


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Seed the spec §59 demo dataset.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--dry-run", action="store_true", help="build and validate only")
    parser.add_argument("--json-only", action="store_true", help="skip persistence; write fixture")
    parser.add_argument("--force", action="store_true", help="overwrite existing demo rows")
    parser.add_argument(
        "--out",
        type=Path,
        default=REPO_ROOT / "infra" / "seed" / "demo-seed.json",
        help="fixture path (default: infra/seed/demo-seed.json)",
    )
    args = parser.parse_args(argv)

    step("Building the §59 demo payload")
    payload = build_payload()
    counts = ", ".join(
        f"{len(v)} {k}" for k, v in payload.items() if isinstance(v, list) and v
    )
    ok(counts)
    note(f"persona={PERSONA['name']} scenario={SCENARIO['name']!r}")
    note(f"success condition: {SCENARIO['success_condition']}")

    step("Validating against the contract")
    validate_payload(payload)

    if args.dry_run:
        MISSING.report()
        step("Dry run — nothing written")
        return 0

    if not args.json_only:
        step("Persisting")
        if persist_via_hook(payload, args.force) or persist_via_orm(payload, args.force):
            MISSING.report()
            step("Seeded")
            print()
            print("  Sign in as any of:")
            for user in USERS:
                print(f"    {user['email']:<38} {'/'.join(user['roles'])}")
            print(f"\n  Password for all demo users: {DEMO_PASSWORD}")
            print("  Then: Simulations → 已有保障客戶的保障缺口對談 → Start\n")
            return 0

    # ---- fallback -----------------------------------------------------------
    write_fixture(payload, args.out)
    MISSING.report()

    if args.json_only:
        step("Fixture written (--json-only)")
        return 0

    print()
    bad("NOT PERSISTED — no database path was available.")
    note("The payload is valid and has been written to disk, but nothing was")
    note("inserted. apps/api needs one of:")
    note("  • app/db/seed.py exposing  seed_demo(payload, *, force=False)")
    note("  • app/db/models.py + app/db/session.py with a session factory")
    note("Load the fixture yourself once either exists.")
    print()
    return 3


if __name__ == "__main__":
    sys.exit(main())
