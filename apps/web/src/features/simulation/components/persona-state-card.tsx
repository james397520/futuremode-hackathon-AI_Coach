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
        <CardTitle eyebrow="目前狀態">等待模擬人物回應中</CardTitle>
        <p className="mt-2 text-body-sm text-text-secondary">
          信任度、興趣、抗拒與耐心會在模擬引擎回報後立即顯示。
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
        eyebrow="目前狀態"
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
        <TonePill tone="blue" fill={13} title="上一輪偵測到的意圖">
          {humaniseSlug(state.intent)}
        </TonePill>
      </div>

      {/* §22 — four hairline meters, value always the last received number. */}
      <div className="mt-4 grid gap-3.5">
        <Meter label="信任度" value={state.trust} tone="mint" live={updating} />
        <Meter label="興趣" value={state.interest} tone="blue" live={updating} />
        <Meter label="抗拒程度" value={state.resistance} tone="warning" live={updating} />
        <Meter label="耐心" value={state.patience} tone="cyan" live={updating} />
        {typeof state.time_pressure === 'number' ? (
          <Meter label="時間壓力" value={state.time_pressure} tone="violet" live={updating} />
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
            {state.hidden_need_revealed ? '隱藏需求已揭露' : '隱藏需求尚未浮現'}
          </p>
          <p className="mt-0.5 text-tiny text-text-tertiary">
            {state.hidden_need_revealed
              ? '客戶已說出真正在意的事——順著這點繼續發展。'
              : '繼續探索：客戶提出的異議通常不是真正的顧慮。'}
          </p>
        </div>
      </div>

      <dl className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-soft)' }}>
        <KeyValue
          label="目前目標"
          value={<span className="max-w-[60%] text-right">{state.current_goal || '—'}</span>}
        />
        {typeof state.budget === 'number' ? (
          <KeyValue label="心中預算" value={`${state.budget.toLocaleString()} / 月`} mono />
        ) : null}
      </dl>

      <p className="mt-3 flex items-start gap-1.5 text-tiny text-text-tertiary">
        <SparkleIcon size={11} className="mt-[2px] shrink-0" />
        此為情境引擎依對話產生的模擬人物狀態，並非對真實人物情緒的推斷。
      </p>
    </GlassCard>
  );
}
