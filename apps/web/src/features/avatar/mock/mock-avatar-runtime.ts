'use client';

/**
 * Mock Avatar Runtime — the no-install demo path.
 *
 * `apps/web` already demos the whole simulation with no backend
 * (`features/simulation/mock/mock-event-stream.ts`). This is the avatar half of
 * that: with no engines installed, the right-hand card must still *react* to the
 * conversation, because a face that never changes reads as a broken video feed.
 *
 * It does not fake video. It synthesises the §45 control events that the real
 * runtime would emit — `avatar.expression.transition`, `avatar.state.changed`,
 * `avatar.speaking.started` / `.ended` — from the persona state the simulation
 * is already producing, and lets `avatar-fallback.tsx` animate them. So the
 * §87 demo arc (neutral → skeptical → frustrated → interested) is visible on the
 * portrait with nothing installed at all.
 *
 * §47 timing is honoured here too: the transition is announced ~140ms before the
 * state is committed, so the customer visibly reacts *then* speaks.
 */
import { useEffect, useRef } from 'react';
import type { PersonaSimulationState } from '@ai-coach/shared';

import { useAvatarStore } from '../avatar-store';
import { expressionStateFor } from '../lib/expression';
import type { AvatarExpressionName } from '../types';

/** §47 — expression transition leads the audio by 50–200ms. */
export const MOCK_TRANSITION_LEAD_MS = 140;

/** §87 — the first demo arc, for a scripted preview with no persona stream. */
export const MOCK_AVATAR_DEMO_SEQUENCE: readonly AvatarExpressionName[] = [
  'neutral',
  'skeptical',
  'frustrated',
  'interested',
];

export interface UseMockAvatarDriverOptions {
  /** Only true when there is genuinely no runtime (status `unavailable`). */
  enabled: boolean;
  personaState: PersonaSimulationState | null;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
}

/**
 * Drives the avatar store from persona state alone. Idempotent and cheap: it
 * writes only when the resolved expression actually changes.
 */
export function useMockAvatarDriver(options: UseMockAvatarDriverOptions): void {
  const { enabled, personaState, speaking, listening, thinking } = options;
  const store = useAvatarStore;
  const lastNameRef = useRef<AvatarExpressionName | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const s = store.getState();
    if (s.transport !== 'mock') s.setTransport('mock');
    const next = expressionStateFor({ personaState, speaking, listening, thinking });

    if (lastNameRef.current === next.name) {
      // Same expression, possibly a new intensity — commit it without a
      // transition so the meters and the face stay in step.
      s.setExpression(next);
      return;
    }

    lastNameRef.current = next.name;
    s.beginTransition(next.name);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const inner = store.getState();
      inner.setExpression(next);
      inner.endTransition();
    }, MOCK_TRANSITION_LEAD_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, personaState, speaking, listening, thinking, store]);

  // Speaking is normally announced by the runtime (§45). With no runtime the
  // simulation's own `persona_speaking` status is the source of truth.
  useEffect(() => {
    if (!enabled) return;
    store.getState().setSpeaking(speaking);
  }, [enabled, speaking, store]);
}
