'use client';

/**
 * Persona live state — spec §22 (Part II) and §20 (Part I).
 *
 * **This card is driven entirely by the `PersonaSimulationState` payload of the
 * `persona.state.updated` event.** Nothing here is inferred, interpolated,
 * extrapolated or animated toward a guessed target: the meters transition
 * between values the server actually sent, and before the first event arrives
 * the card says it is waiting rather than showing zeros as if they were data.
 *
 * Visual rules: 4px hairline meters, no speedometer, no dashboard (§22 / §99).
 */
import type { PersonaSimulationState } from '@ai-coach/shared';

import { humaniseSlug } from '../lib/format';
import {
  COMPLIANCE_RISK_LABEL,
  COMPLIANCE_RISK_TONE,
  EMOTION_LABEL,
  EMOTION_TONE,
  PHASE_LABEL,
} from '../lib/labels';
import { insetSurface, toneText } from '../lib/tone';
import { CardTitle, KeyValue, Meter, TonePill } from './atoms';
import { AlertIcon, CheckIcon, ShieldIcon, SparkleIcon } from './icons';
import { cn, GlassCard, Skeleton } from './kit';

export interface PersonaStateCardProps {
  state: PersonaSimulationState | null;
  /** True while a fresh `persona.state.updated` is settling (drives the shimmer). */
  updating?: boolean;
  className?: string;
}

export function PersonaStateCard({ state, updating = false, className }: PersonaStateCardProps) {
  if (!state) {
    return (
      <GlassCard className={cn('sim-float-in p-5', className)}>
        <CardTitle eyebrow="Current state">Waiting for the persona</CardTitle>
        <p className="mt-2 text-body-sm text-text-secondary">
          Trust, interest, resistance and patience appear as soon as the simulation reports them.
        </p>
        <div className="mt-4 grid gap-3">
          <Skeleton className="h-3 w-full rounded-pill" />
          <Skeleton className="h-3 w-4/5 rounded-pill" />
          <Skeleton className="h-3 w-3/5 rounded-pill" />
        </div>
      </GlassCard>
    );
  }

  const emotionTone = EMOTION_TONE[state.emotion] ?? 'neutral';
  const riskTone = COMPLIANCE_RISK_TONE[state.compliance_risk] ?? 'neutral';

  return (
    <GlassCard className={cn('sim-float-in sim-lift p-5', className)}>
      <CardTitle
        eyebrow="Current state"
        action={
          <TonePill tone={riskTone} fill={16} icon={<ShieldIcon size={11} />}>
            {COMPLIANCE_RISK_LABEL[state.compliance_risk] ?? state.compliance_risk}
          </TonePill>
        }
      >
        {EMOTION_LABEL[state.emotion] ?? state.emotion}
      </CardTitle>

      <div className="mt-3 flex flex-wrap gap-2">
        <TonePill tone={emotionTone} fill={16}>
          {EMOTION_LABEL[state.emotion] ?? state.emotion}
        </TonePill>
        <TonePill tone="indigo" fill={14}>
          {PHASE_LABEL[state.scenario_phase] ?? state.scenario_phase}
        </TonePill>
        <TonePill tone="blue" fill={13} title="Intent detected in the last turn">
          {humaniseSlug(state.intent)}
        </TonePill>
      </div>

      {/* §22 — four hairline meters, value always the last received number. */}
      <div className="mt-4 grid gap-3.5">
        <Meter label="Trust" value={state.trust} tone="mint" live={updating} />
        <Meter label="Interest" value={state.interest} tone="blue" live={updating} />
        <Meter label="Resistance" value={state.resistance} tone="warning" live={updating} />
        <Meter label="Patience" value={state.patience} tone="cyan" live={updating} />
        {typeof state.time_pressure === 'number' ? (
          <Meter label="Time pressure" value={state.time_pressure} tone="violet" live={updating} />
        ) : null}
      </div>

      <div
        className="mt-4 flex items-start gap-2 rounded-card-sm border p-3"
        style={insetSurface(state.hidden_need_revealed ? 'mint' : 'neutral', 9)}
      >
        <span
          style={{ color: toneText(state.hidden_need_revealed ? 'mint' : 'neutral') }}
          className="mt-[2px]"
        >
          {state.hidden_need_revealed ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
        </span>
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-text-primary">
            {state.hidden_need_revealed ? 'Hidden need revealed' : 'Hidden need not surfaced yet'}
          </p>
          <p className="mt-0.5 text-tiny text-text-tertiary">
            {state.hidden_need_revealed
              ? 'The customer has voiced what actually worries them — build on it.'
              : 'Keep exploring: the stated objection is probably not the real concern.'}
          </p>
        </div>
      </div>

      <dl className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-soft)' }}>
        <KeyValue
          label="Current goal"
          value={<span className="max-w-[60%] text-right">{state.current_goal || '—'}</span>}
        />
        {typeof state.budget === 'number' ? (
          <KeyValue label="Budget in mind" value={`${state.budget.toLocaleString()} / month`} mono />
        ) : null}
      </dl>

      <p className="mt-3 flex items-start gap-1.5 text-tiny text-text-tertiary">
        <SparkleIcon size={11} className="mt-[2px] shrink-0" />
        Simulated persona state produced by the scenario engine from the conversation. It is not an
        inference about a real person&apos;s emotions.
      </p>
    </GlassCard>
  );
}
