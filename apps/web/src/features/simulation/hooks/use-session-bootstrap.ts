'use client';

/**
 * Session bootstrap — everything the page needs before the socket opens.
 *
 * With a backend configured it composes the view model from the typed endpoint
 * helpers in `@/lib/api-client` (`getSession` → `getScenario` + `getPersona`,
 * the last two in parallel). With no backend it loads the §59 demo fixture so
 * the page is always demoable. A failure produces an inline, retryable state —
 * never a blank page or a thrown render (§94).
 */
import { useCallback, useEffect, useState } from 'react';
import type { Persona, PersonaTraits, Scenario, SessionMode, TrainingSession } from '@ai-coach/shared';

import { resolvePersonaGender } from '@/features/avatar';
import { endpoints } from '@/lib/api-client';

import { hasBackend } from '../lib/env';
import type { SessionBootstrap } from '../lib/types';
import { createMockBootstrap } from '../mock/mock-session';
import { useSessionActions } from '../store/session-store';

export interface SessionBootstrapResult {
  bootstrap: SessionBootstrap | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/** §16.2 persona sliders → the short trait chips shown on the scenario card. */
const TRAIT_LABELS: Record<keyof PersonaTraits, { high: string; low: string }> = {
  trust: { high: '信任度高', low: '存有戒心' },
  patience: { high: '有耐心', low: '沒耐心' },
  price_sensitivity: { high: '對價格敏感', low: '看重價值' },
  risk_aversion: { high: '保守避險', low: '願意承擔風險' },
  product_knowledge: { high: '熟悉產品', low: '初次接觸產品' },
  resistance: { high: '抗拒心強', low: '態度開放' },
  openness: { high: '樂於嘗試', low: '有所保留' },
};

export function summariseTraits(traits: PersonaTraits | undefined, limit = 4): string[] {
  if (!traits) return [];
  const scored: Array<{ label: string; distance: number }> = [];
  for (const key of Object.keys(TRAIT_LABELS) as Array<keyof PersonaTraits>) {
    const value = traits[key];
    if (typeof value !== 'number') continue;
    if (value >= 65) scored.push({ label: TRAIT_LABELS[key].high, distance: value - 50 });
    else if (value <= 35) scored.push({ label: TRAIT_LABELS[key].low, distance: 50 - value });
  }
  return scored
    .sort((a, b) => b.distance - a.distance)
    .slice(0, limit)
    .map((entry) => entry.label);
}

function composeBootstrap(
  session: TrainingSession,
  scenario: Scenario,
  persona: Persona,
): SessionBootstrap {
  const startedAt = Date.parse(session.started_at);
  return {
    sessionId: session.session_id,
    mode: session.mode,
    runtime: session.runtime,
    voiceEnabled: session.voice_enabled,
    scoreLiveEnabled: session.score_live_enabled,
    startedAtMs: Number.isFinite(startedAt) ? startedAt : Date.now(),
    turnCount: session.turn_count,
    scenario: {
      id: scenario.id,
      name: scenario.name,
      version: session.scenario_version || scenario.version,
      category: scenario.industry,
      industry: scenario.industry,
      trainingType: scenario.training_type,
      difficulty: scenario.difficulty,
      openingContext: scenario.opening_context,
      learningObjectives: scenario.learning_objectives ?? [],
      requiredTalkingPoints: scenario.required_talking_points ?? [],
      keyObjections: scenario.key_objections ?? [],
      restrictedTopics: scenario.restricted_topics ?? [],
      successCondition: scenario.success_condition,
      timeLimitSeconds: scenario.time_limit_seconds,
      maxTurns: scenario.max_turns,
      minimumScore: scenario.minimum_score,
    },
    persona: {
      id: persona.id,
      name: persona.name,
      version: session.persona_version || persona.version,
      age: persona.age,
      occupation: persona.occupation,
      background: persona.background,
      // Never leak `persona.hidden` into the trainee's view (§16.3).
      subtitle: [persona.occupation, persona.industry].filter(Boolean).join(' · ') || undefined,
      avatarUrl: persona.avatar_url,
      gender: resolvePersonaGender(persona),
      traitSummary: summariseTraits(persona.traits),
      language: persona.language,
    },
  };
}

export function useSessionBootstrap(
  sessionId: string,
  /** Route-level override, e.g. the voice page forcing voice on. */
  modeOverride?: SessionMode,
): SessionBootstrapResult {
  const actions = useSessionActions();
  const [bootstrap, setBootstrap] = useState<SessionBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!sessionId) return undefined;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const apply = (data: SessionBootstrap): void => {
      if (cancelled) return;
      const resolved: SessionBootstrap = modeOverride ? { ...data, mode: modeOverride } : data;
      setBootstrap(resolved);
      actions.initSession(resolved.sessionId || sessionId, resolved.mode);
      actions.applyBootstrap(resolved);
      setLoading(false);
    };

    if (!hasBackend) {
      // No API configured → scripted demo (§59).
      apply(createMockBootstrap(sessionId, modeOverride ?? 'training'));
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        // One request. The envelope already pins the scenario and persona to
        // this session (§54), so re-fetching them separately was both redundant
        // and a permission error: a trainee has `session.read` but not
        // `scenario.read`, so the extra calls 403'd for the only role that
        // actually runs simulations.
        const envelope = await endpoints.getSession(sessionId);
        if (cancelled) return;
        apply(composeBootstrap(envelope.session, envelope.scenario, envelope.persona));
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : '無法載入這場練習，請再試一次。';
        setError(message);
        setLoading(false);
        actions.setBootstrapError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actions, attempt, modeOverride, sessionId]);

  return { bootstrap, loading, error, retry };
}
