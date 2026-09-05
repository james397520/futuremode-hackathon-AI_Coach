/**
 * Local safety pre-check — spec §55.
 *
 * AUTHORITY: **advisory, first pass only.**
 *
 * > The server Safety Agent remains the authoritative layer.
 *
 * That is not a caveat, it is the design. This module exists to catch the obvious
 * cases in the browser so a trainee gets instant feedback and so we avoid shipping
 * an account number to the API in the first place. It is a pattern matcher: it has
 * no model, no context, and no knowledge of the scenario, the persona, or the
 * compliance regime in force. It **must never** be used to:
 *   - approve content (a `pass: true` result means "nothing obvious found", not
 *     "safe"),
 *   - suppress or replace the server-side safety verdict,
 *   - gate a compliance report or an audit record.
 *
 * Because it is pure JavaScript with no model, it is the one task that runs at full
 * capability on every device — including one with WebGPU disabled by policy and no
 * local model cache. The heuristic is identical on all three tiers; only the
 * *authoritative* verdict differs, and that always comes from the server.
 *
 * Privacy: nothing here leaves the browser. Findings carry stable rule ids and
 * character offsets, plus a redacted excerpt — never the raw match.
 */
import type { ComputeBackend } from '@ai-coach/shared';

import type {
  AuthorityLevel,
  SafetyCategory,
  SafetyFinding,
  SafetyResult,
  SafetySeverity,
  TaskOutcome,
  TaskRunner,
} from '../backends/types';

export const SAFETY_PRECHECK_AUTHORITY: AuthorityLevel = 'advisory';

/** Replacement token used by `maskFindings`. */
export const MASK_TOKEN = '[REDACTED]';

interface SafetyRule {
  id: string;
  category: SafetyCategory;
  severity: SafetySeverity;
  pattern: RegExp;
  /** Extra validation for patterns that need it (e.g. Luhn on card numbers). */
  validate?: (match: string) => boolean;
}

/* ------------------------------------------------------------------ *
 * PII patterns
 * ------------------------------------------------------------------ */

function luhnValid(input: string): boolean {
  const digits = input.replace(/[^0-9]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const code = digits.charCodeAt(i) - 48;
    if (code < 0 || code > 9) return false;
    let value = code;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Taiwan national ID: one letter (area), then 1 or 2 (sex), then 8 digits, with a
 * mod-10 checksum. The platform is zh-TW first, so this is the highest-value PII
 * pattern we have.
 */
function twNationalIdValid(input: string): boolean {
  const value = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z][12][0-9]{8}$/.test(value)) return false;
  const letterMap = 'ABCDEFGHJKLMNPQRSTUVXYWZIO';
  const first = value.charAt(0);
  const index = letterMap.indexOf(first);
  if (index < 0) return false;
  const letterValue = index + 10;
  let sum = Math.floor(letterValue / 10) + (letterValue % 10) * 9;
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  for (let i = 0; i < 8; i += 1) {
    const digit = Number(value.charAt(i + 1));
    if (!Number.isFinite(digit)) return false;
    sum += digit * (weights[i] ?? 0);
  }
  sum += Number(value.charAt(9));
  return sum % 10 === 0;
}

const PII_RULES: readonly SafetyRule[] = [
  {
    id: 'pii.email',
    category: 'pii',
    severity: 'medium',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    id: 'pii.credit_card',
    category: 'pii',
    severity: 'high',
    // Digit groups of 13–19 with optional separators, confirmed by Luhn so we do
    // not flag every order number.
    pattern: /\b(?:[0-9][ -]?){12,18}[0-9]\b/g,
    validate: luhnValid,
  },
  {
    id: 'pii.tw_national_id',
    category: 'pii',
    severity: 'high',
    pattern: /\b[A-Za-z][12][0-9]{8}\b/g,
    validate: twNationalIdValid,
  },
  {
    id: 'pii.us_ssn',
    category: 'pii',
    severity: 'high',
    pattern: /\b(?!000|666|9[0-9]{2})[0-9]{3}-(?!00)[0-9]{2}-(?!0000)[0-9]{4}\b/g,
  },
  {
    id: 'pii.phone',
    category: 'pii',
    severity: 'low',
    // Taiwan mobile / landline and generic international forms.
    pattern:
      /(?:\+?886[ -]?|\b0)(?:9[0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{3}|[2-8][ -]?[0-9]{3,4}[ -]?[0-9]{4})\b|\+[1-9][0-9]{1,3}[ -][0-9]{6,12}\b/g,
  },
  {
    id: 'pii.iban',
    category: 'pii',
    severity: 'high',
    pattern: /\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{4}){3,7}\b/g,
  },
  {
    id: 'pii.bank_account',
    category: 'pii',
    severity: 'medium',
    pattern:
      /(?:帳號|account\s*(?:no\.?|number)|銀行帳戶)\s*[:：]?\s*[0-9]{8,16}\b/gi,
  },
  {
    id: 'pii.address_tw',
    category: 'pii',
    severity: 'low',
    pattern: /[一-鿿]{2,}(?:市|縣)[一-鿿]{1,}(?:區|鄉|鎮|市)[一-鿿0-9]{2,}(?:路|街|大道)[0-9]+號/g,
  },
  {
    id: 'pii.secret_token',
    category: 'pii',
    severity: 'high',
    // API keys and bearer tokens pasted into a message by mistake.
    pattern:
      /\b(?:sk|pk|rk)[-_](?:live|test|prod)?[-_]?[A-Za-z0-9]{16,}\b|\bBearer\s+[A-Za-z0-9._-]{20,}\b|\bghp_[A-Za-z0-9]{20,}\b/g,
  },
];

/* ------------------------------------------------------------------ *
 * Restricted keywords (§38 compliance vocabulary, first pass)
 * ------------------------------------------------------------------ */

const RESTRICTED_RULES: readonly SafetyRule[] = [
  {
    id: 'restricted.guaranteed_return',
    category: 'restricted_keyword',
    severity: 'high',
    pattern:
      /\b(?:guaranteed|guarantee[sd]?)\s+(?:return|profit|income|yield|payout)s?\b|保證(?:獲利|報酬|收益|賺錢)|穩賺|保本保息/gi,
  },
  {
    id: 'restricted.no_risk',
    category: 'restricted_keyword',
    severity: 'high',
    pattern: /\b(?:zero|no|without)\s+risk\b|\brisk[- ]free\b|完全無風險|零風險/gi,
  },
  {
    id: 'restricted.insider',
    category: 'restricted_keyword',
    severity: 'high',
    pattern: /\binsider\s+(?:info|information|tip)s?\b|內線消息|內部消息/gi,
  },
  {
    id: 'restricted.tax_evasion',
    category: 'restricted_keyword',
    severity: 'high',
    pattern: /\b(?:tax\s+evasion|evade\s+tax(?:es)?|hide\s+(?:from|it\s+from)\s+the\s+tax)\b|逃漏稅|避稅規劃/gi,
  },
  {
    id: 'restricted.pressure_tactic',
    category: 'restricted_keyword',
    severity: 'medium',
    pattern:
      /\b(?:sign\s+(?:now|today)\s+or|last\s+chance|only\s+today|act\s+now\s+or)\b|今天不簽就沒有了|最後一天優惠/gi,
  },
  {
    id: 'restricted.medical_claim',
    category: 'restricted_keyword',
    severity: 'medium',
    pattern: /\b(?:cure[sd]?|treats?)\s+(?:cancer|diabetes|covid)\b|療效保證|包治百病/gi,
  },
  {
    id: 'restricted.impersonation',
    category: 'restricted_keyword',
    severity: 'medium',
    pattern:
      /\b(?:on\s+behalf\s+of\s+the\s+(?:regulator|authority|government)|financial\s+supervisory\s+commission)\b|金管會核准|政府保證/gi,
  },
];

/* ------------------------------------------------------------------ *
 * Prompt-injection heuristics
 * ------------------------------------------------------------------ */

const INJECTION_RULES: readonly SafetyRule[] = [
  {
    id: 'injection.ignore_instructions',
    category: 'prompt_injection',
    severity: 'high',
    pattern:
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instruction|prompt|rule|direction|message)s?\b|忽略(?:上述|之前|所有)(?:指令|指示|規則)/gi,
  },
  {
    id: 'injection.reveal_system_prompt',
    category: 'prompt_injection',
    severity: 'high',
    pattern:
      /\b(?:reveal|show|print|repeat|output|dump)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:system\s+prompt|initial\s+instructions|hidden\s+rules|developer\s+message)\b|(?:顯示|列出|告訴我)(?:你的)?(?:系統提示|初始指令)/gi,
  },
  {
    id: 'injection.role_override',
    category: 'prompt_injection',
    severity: 'medium',
    pattern:
      /\b(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are|act\s+as\s+(?:a\s+)?(?:dan|jailbroken|unrestricted))\b|\b(?:pretend|imagine)\s+you\s+have\s+no\s+(?:rules|restrictions|guidelines)\b|你現在是|從現在開始你是/gi,
  },
  {
    id: 'injection.chat_markers',
    category: 'prompt_injection',
    severity: 'medium',
    // Fake turn delimiters used to smuggle a new system turn into a transcript.
    pattern:
      /<\|(?:im_start|im_end|system|endoftext)\|>|\[\/?(?:INST|SYS)\]|^\s*(?:system|assistant)\s*:\s*/gim,
  },
  {
    id: 'injection.tool_exfiltration',
    category: 'prompt_injection',
    severity: 'high',
    pattern:
      /\b(?:send|post|upload|exfiltrate)\s+(?:the\s+)?(?:transcript|conversation|knowledge\s*base|documents?)\s+to\s+(?:https?:\/\/|[A-Za-z0-9.-]+\.[a-z]{2,})/gi,
  },
  {
    id: 'injection.encoded_payload',
    category: 'prompt_injection',
    severity: 'low',
    // A long unbroken base64-ish blob is a classic obfuscation vector.
    pattern: /\b[A-Za-z0-9+/]{120,}={0,2}\b/g,
  },
];

/* ------------------------------------------------------------------ *
 * Sensitive phrases (masked, not blocked)
 * ------------------------------------------------------------------ */

const SENSITIVE_RULES: readonly SafetyRule[] = [
  {
    id: 'sensitive.health',
    category: 'sensitive_phrase',
    severity: 'low',
    pattern:
      /\b(?:hiv|cancer|diabetes|depression|pregnan(?:t|cy)|disabilit(?:y|ies))\b|癌症|愛滋|憂鬱症|懷孕|身心障礙/gi,
  },
  {
    id: 'sensitive.credential_hint',
    category: 'sensitive_phrase',
    severity: 'medium',
    pattern: /\b(?:password|passcode|pin\s*code|otp)\s*(?:is|=|:|：)\s*\S+/gi,
  },
  {
    id: 'sensitive.salary',
    category: 'sensitive_phrase',
    severity: 'low',
    pattern: /\b(?:my|his|her|their)\s+(?:salary|income)\s+is\b|年收入(?:大約|約)?[0-9]/gi,
  },
];

const ALL_RULES: readonly SafetyRule[] = [
  ...PII_RULES,
  ...RESTRICTED_RULES,
  ...INJECTION_RULES,
  ...SENSITIVE_RULES,
];

const SEVERITY_WEIGHT: Record<SafetySeverity, number> = {
  info: 0.02,
  low: 0.1,
  medium: 0.3,
  high: 0.6,
};

const BLOCKING_SEVERITIES: readonly SafetySeverity[] = ['medium', 'high'];

/** Upper bound on input length. Longer text is scanned in a prefix window. */
export const MAX_PRECHECK_CHARS = 20_000;

/**
 * Run the pattern pass. Pure, synchronous, no I/O, no browser API. Identical on
 * the main thread, in the worker, and (as a cross-check) conceptually on the
 * server — but the server's own Safety Agent is the authority (§55).
 */
export function runSafetyHeuristics(input: string): {
  pass: boolean;
  findings: SafetyFinding[];
  risk: number;
  masked: string;
} {
  const text = typeof input === 'string' ? input : String(input ?? '');
  if (text.length === 0) {
    return { pass: true, findings: [], risk: 0, masked: '' };
  }
  const window = text.length > MAX_PRECHECK_CHARS ? text.slice(0, MAX_PRECHECK_CHARS) : text;

  const findings: SafetyFinding[] = [];
  for (const rule of ALL_RULES) {
    // Clone so the module-level regexes stay stateless across calls.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    if (!re.global) {
      const single = re.exec(window);
      if (single && (!rule.validate || rule.validate(single[0]))) {
        findings.push(toFinding(rule, single.index, single[0]));
      }
      continue;
    }
    let match: RegExpExecArray | null;
    let guard = 0;
    while ((match = re.exec(window)) !== null) {
      // Bounded: a pathological pattern must not spin forever.
      guard += 1;
      if (guard > 200) break;
      const value = match[0];
      if (value.length === 0) {
        re.lastIndex += 1;
        continue;
      }
      if (!rule.validate || rule.validate(value)) {
        findings.push(toFinding(rule, match.index, value));
      }
    }
  }

  findings.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = dedupeOverlaps(findings);

  let risk = 0;
  for (const finding of merged) {
    risk += SEVERITY_WEIGHT[finding.severity];
  }
  risk = Math.min(1, Number(risk.toFixed(4)));

  const pass = !merged.some((f) => BLOCKING_SEVERITIES.includes(f.severity));

  return { pass, findings: merged, risk, masked: maskFindings(text, merged) };
}

function toFinding(rule: SafetyRule, start: number, value: string): SafetyFinding {
  return {
    category: rule.category,
    rule: rule.id,
    severity: rule.severity,
    start,
    end: start + value.length,
    redacted: redact(value),
  };
}

/**
 * Keep only enough of a match to be recognisable in a UI hint. We never return the
 * raw value, because a finding may itself be shipped to the audit log.
 */
export function redact(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);
  const head = trimmed.slice(0, 2);
  const tail = trimmed.slice(-2);
  return `${head}${'*'.repeat(Math.min(8, Math.max(1, trimmed.length - 4)))}${tail}`;
}

/** Drop findings fully contained inside an earlier, higher-severity finding. */
function dedupeOverlaps(findings: readonly SafetyFinding[]): SafetyFinding[] {
  const out: SafetyFinding[] = [];
  for (const finding of findings) {
    const swallowed = out.some(
      (kept) =>
        kept.start <= finding.start &&
        kept.end >= finding.end &&
        SEVERITY_WEIGHT[kept.severity] >= SEVERITY_WEIGHT[finding.severity],
    );
    if (!swallowed) out.push(finding);
  }
  return out;
}

/**
 * §55 sensitive-phrase masking. Replaces every finding span with `MASK_TOKEN`,
 * right-to-left so earlier offsets stay valid.
 */
export function maskFindings(text: string, findings: readonly SafetyFinding[]): string {
  if (findings.length === 0) return text;
  const spans = [...findings]
    .filter((f) => f.start >= 0 && f.end > f.start && f.start < text.length)
    .sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const span of spans) {
    if (span.end > lastStart) continue; // overlapping span already masked
    out = `${out.slice(0, span.start)}${MASK_TOKEN}${out.slice(Math.min(span.end, out.length))}`;
    lastStart = span.start;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Task module
 * ------------------------------------------------------------------ */

/**
 * The task entry point used by the runtime façade.
 *
 * Unlike the other three tasks this one cannot really "fail over": the heuristic is
 * the same code on every tier. It still goes through the `TaskRunner` so that the
 * reported `backend` and telemetry stay consistent with the rest of the runtime,
 * and so a future model-assisted pre-check can slot in without an API change.
 */
export async function safetyPrecheck(
  runner: TaskRunner,
  text: string,
): Promise<TaskOutcome<SafetyResult>> {
  return runner.runTask('safety_precheck', async (backend) => backend.safetyPrecheck(text), {
    label: 'safety_precheck',
  });
}

/**
 * The always-available floor. Callable synchronously with no runtime, no worker and
 * no network — used by the composer's inline hint (§55) and as the implementation
 * every backend delegates to.
 */
export function safetyPrecheckLocal(
  text: string,
  backend: ComputeBackend = 'wasm',
): SafetyResult {
  const result = runSafetyHeuristics(text);
  return {
    ...result,
    backend,
    // Always advisory. The server Safety Agent is authoritative (§55).
    authority: SAFETY_PRECHECK_AUTHORITY,
    local: true,
  };
}
