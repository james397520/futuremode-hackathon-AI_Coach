/**
 * Objective progress — spec §21 ("progress toward objective").
 *
 * Two independent, honestly-labelled signals:
 *
 *  1. **Phase progress** comes straight from the server's `scenario_phase`
 *     (§20). The UI never guesses it.
 *  2. **Talking-point coverage** is a client-side *text* heuristic over the
 *     trainee's own turns. It is a reading aid ("did I mention the mortgage
 *     gap yet?"), never a score, and the UI labels it as detected-in-transcript
 *     rather than as an assessment. The authoritative scoring is the Evaluator
 *     agent's `score.updated` / `Evaluation` (§26 / §27).
 */
import type { ScenarioPhase, TranscriptTurn } from '@ai-coach/shared-types';

import { PHASE_ORDER } from './labels';

const COVERAGE_THRESHOLD = 0.6;

/** Split into comparable tokens: latin words plus individual CJK characters. */
function tokenise(text: string): string[] {
  const cleaned = text.replace(/[\s,，。、；；:：（）()「」【】"'?？!！/\\-]+/g, ' ');
  const tokens: string[] = [];
  for (const chunk of cleaned.split(' ')) {
    if (!chunk) continue;
    if (/^[\x20-\x7f]+$/.test(chunk)) {
      if (chunk.length >= 2) tokens.push(chunk.toLowerCase());
    } else {
      for (const char of Array.from(chunk)) {
        if (char.trim()) tokens.push(char);
      }
    }
  }
  return tokens;
}

export interface TalkingPointCoverage {
  point: string;
  covered: boolean;
  ratio: number;
}

export function coverTalkingPoints(
  points: readonly string[],
  turns: readonly TranscriptTurn[],
): TalkingPointCoverage[] {
  const spoken = new Set(
    turns
      .filter((turn) => turn.speaker === 'trainee')
      .flatMap((turn) => tokenise(turn.text)),
  );

  return points.map((point) => {
    const tokens = tokenise(point);
    const distinct = Array.from(new Set(tokens));
    if (distinct.length === 0) return { point, covered: false, ratio: 0 };
    const hits = distinct.filter((token) => spoken.has(token)).length;
    const ratio = hits / distinct.length;
    return { point, covered: ratio >= COVERAGE_THRESHOLD, ratio };
  });
}

/** 0–1 progress through the scenario phases, from the server-provided phase. */
export function phaseProgress(phase: ScenarioPhase | undefined): number {
  if (!phase) return 0;
  const index = PHASE_ORDER.indexOf(phase);
  if (index < 0) return 0;
  return index / (PHASE_ORDER.length - 1);
}

export interface ObjectiveProgress {
  /** 0–100, an even blend of phase progress and talking-point coverage. */
  overall: number;
  phase: number;
  coverage: number;
  coveredCount: number;
  totalCount: number;
  points: TalkingPointCoverage[];
}

export function objectiveProgress(
  phase: ScenarioPhase | undefined,
  points: readonly string[],
  turns: readonly TranscriptTurn[],
): ObjectiveProgress {
  const covered = coverTalkingPoints(points, turns);
  const coveredCount = covered.filter((c) => c.covered).length;
  const coverage = points.length === 0 ? 0 : coveredCount / points.length;
  const phaseValue = phaseProgress(phase);
  const overall = points.length === 0 ? phaseValue : (phaseValue + coverage) / 2;
  return {
    overall: Math.round(overall * 100),
    phase: Math.round(phaseValue * 100),
    coverage: Math.round(coverage * 100),
    coveredCount,
    totalCount: points.length,
    points: covered,
  };
}
