"""Prompt library — one module per agent (spec §19).

All prompts live here as constants (never inlined in agent logic) so that they can be
reviewed, diffed and version-pinned like any other content asset. Every system prompt
carries `INJECTION_GUARD` and a locale clause; user-facing output defaults to
Traditional Chinese for the demo locale but is parameterised by `locale`.
"""

from app.agents.prompts.coach import coach_system_prompt
from app.agents.prompts.common import (
    INJECTION_GUARD,
    data_block,
    locale_clause,
    mode_clause,
    schema_block,
    untrusted_block,
)
from app.agents.prompts.compliance import compliance_system_prompt
from app.agents.prompts.customer import (
    CLARIFY_IN_PERSONA,
    OUT_OF_SCOPE_REDIRECTS,
    ROLE_ESCAPE_DEFLECTIONS,
    customer_system_prompt,
    pick_deflection,
)
from app.agents.prompts.evaluator import NO_EVIDENCE_NOTE, evaluator_system_prompt
from app.agents.prompts.intent import intent_system_prompt
from app.agents.prompts.knowledge import (
    CLARIFY_QUESTIONS,
    REDIRECT_SCOPES,
    UNCERTAINTY_STATEMENTS,
    knowledge_system_prompt,
    localised,
)
from app.agents.prompts.mining import mining_system_prompt, question_gen_system_prompt
from app.agents.prompts.scenario import event_narration_system_prompt, event_text

__all__ = [
    "CLARIFY_IN_PERSONA",
    "CLARIFY_QUESTIONS",
    "INJECTION_GUARD",
    "NO_EVIDENCE_NOTE",
    "OUT_OF_SCOPE_REDIRECTS",
    "REDIRECT_SCOPES",
    "ROLE_ESCAPE_DEFLECTIONS",
    "UNCERTAINTY_STATEMENTS",
    "coach_system_prompt",
    "compliance_system_prompt",
    "customer_system_prompt",
    "data_block",
    "evaluator_system_prompt",
    "event_narration_system_prompt",
    "event_text",
    "intent_system_prompt",
    "knowledge_system_prompt",
    "locale_clause",
    "localised",
    "mining_system_prompt",
    "mode_clause",
    "pick_deflection",
    "question_gen_system_prompt",
    "schema_block",
    "untrusted_block",
]
