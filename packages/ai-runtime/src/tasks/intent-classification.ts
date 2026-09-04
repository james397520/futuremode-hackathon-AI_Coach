/**
 * Local intent classification — spec §53.
 *
 * AUTHORITY: **advisory hint only.**
 *
 * > 結果送到 server orchestrator 作輔助。
 *
 * The four labels (`objection`, `question`, `off_topic`, `close_intent`) are sent
 * to the server orchestrator as a *hint*, alongside the user's turn. The
 * orchestrator — which has the scenario, the persona state, the difficulty engine
 * and the full transcript — decides what the turn actually was. Concretely, this
 * result must never:
 *   - drive a persona state transition on its own,
 *   - be recorded as the turn's classification in a report or evaluation,
 *   - short-circuit sending the turn to the server.
 *
 * What it is genuinely good for: reacting *before* the round trip completes —
 * priming the Coach card, pre-fetching the objection-handling knowledge panel,
 * showing the "thinking about your objection" affordance. If the hint turns out to
 * be wrong, the server's answer arrives a moment later and overrides it, and
 * nothing was lost.
 *
 * `send_to_server` on the hint payload exists so this contract is explicit at the
 * call site rather than implied by a comment.
 */
import type {
  AuthorityLevel,
  IntentLabel,
  IntentResult,
  TaskOutcome,
  TaskRunner,
} from '../backends/types';
import { INTENT_LABELS } from '../backends/types';

export const INTENT_AUTHORITY: AuthorityLevel = 'advisory';

/** Characters considered. A turn longer than this is clipped, not rejected. */
export const MAX_INTENT_CHARS = 2_000;

/**
 * Below this the label is not worth acting on even speculatively. Chosen so a
 * near-uniform distribution over four labels (~0.25 each) never triggers UI.
 */
export const INTENT_MIN_CONFIDENCE = 0.45;

export interface IntentTaskOptions {
  serverOnly?: boolean;
  localOnly?: boolean;
  /** Override the confidence floor for `actionable`. */
  minConfidence?: number;
}

/** The shape sent to the orchestrator. Deliberately self-describing. */
export interface IntentHint {
  label: IntentLabel;
  confidence: number;
  scores: Record<IntentLabel, number>;
  model_id: string;
  backend: string;
  /** Always 'advisory' from a local tier (§53). */
  authority: AuthorityLevel;
  /** True when this came from the browser rather than the orchestrator itself. */
  client_side: boolean;
}

export async function classifyIntent(
  runner: TaskRunner,
  text: string,
  options: IntentTaskOptions = {},
): Promise<TaskOutcome<IntentResult>> {
  const input = typeof text === 'string' ? text.trim().slice(0, MAX_INTENT_CHARS) : '';
  if (input.length === 0) {
    // An empty turn is a `question` with zero confidence rather than an error —
    // the caller is a composer and gets called on every pause.
    return {
      ok: true,
      value: {
        label: 'question',
        confidence: 0,
        scores: { objection: 0, question: 0, off_topic: 0, close_intent: 0 },
        model_id: 'none',
        backend: 'server',
        authority: INTENT_AUTHORITY,
        local: false,
      },
      backend: 'server',
      elapsed_ms: 0,
      degraded: false,
      attempts: [],
    };
  }

  return runner.runTask<IntentResult>(
    'intent_classification',
    async (backend) => {
      const result = await backend.classifyIntent(input);
      return {
        ...result,
        // A local classification is a hint; the orchestrator's own is authoritative.
        authority: backend.kind === 'server' ? 'authoritative' : INTENT_AUTHORITY,
        local: backend.kind !== 'server',
      };
    },
    {
      label: 'intent_classification',
      ...(options.serverOnly ? { serverOnly: true } : {}),
      ...(options.localOnly ? { localOnly: true } : {}),
    },
  );
}

/**
 * Whether the UI should act on this hint at all. Two conditions: the model was
 * confident enough, and the label is not the catch-all.
 */
export function isActionableHint(
  result: IntentResult,
  minConfidence = INTENT_MIN_CONFIDENCE,
): boolean {
  if (result.confidence < minConfidence) return false;
  if (result.label === 'off_topic') return false;
  return true;
}

/**
 * Build the payload to attach to the turn sent to the server orchestrator.
 *
 * Returns `null` when the hint is not worth sending — a low-confidence guess is
 * noise in the orchestrator's prompt, and sending it would risk anchoring the
 * server's own classification on a bad local one.
 */
export function toOrchestratorHint(
  result: IntentResult,
  minConfidence = INTENT_MIN_CONFIDENCE,
): IntentHint | null {
  if (!result.local) return null; // the server already knows its own answer
  if (result.confidence < minConfidence) return null;
  return {
    label: result.label,
    confidence: Number(result.confidence.toFixed(4)),
    scores: result.scores,
    model_id: result.model_id,
    backend: result.backend,
    authority: INTENT_AUTHORITY,
    client_side: true,
  };
}

/** The label the UI should show, in plain language. */
export function describeIntent(label: IntentLabel): string {
  switch (label) {
    case 'objection':
      return 'Objection';
    case 'question':
      return 'Question';
    case 'off_topic':
      return 'Off topic';
    case 'close_intent':
      return 'Closing signal';
    default:
      return 'Unclassified';
  }
}

export function isIntentLabel(value: unknown): value is IntentLabel {
  return typeof value === 'string' && (INTENT_LABELS as readonly string[]).includes(value);
}
