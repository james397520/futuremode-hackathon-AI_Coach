'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EyeOff, FlaskConical, Lock, Plus, Save, Trash2, Volume2 } from 'lucide-react';
import type { Persona, PersonaTraits } from '@ai-coach/shared';
import { Button, Field, GlassCard, Input, Pill, Select, Slider, Switch, Tabs, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill } from '@/components/status';
import { PERSONA_TRIGGER_RULES, personaById } from '@/lib/fixtures/personas';
import { MOCK_KNOWLEDGE_BASES } from '@/lib/fixtures/knowledge';
import { SCOPE } from '@/lib/fixtures/constants';
import { useCan } from '@/lib/auth-context';
import { titleize } from '@/lib/utils';

type BuilderTab = 'identity' | 'personality' | 'behavior' | 'objections' | 'knowledge' | 'voice' | 'safety';

const TABS: Array<{ value: BuilderTab; label: string }> = [
  { value: 'identity', label: 'Identity' },
  { value: 'personality', label: 'Personality' },
  { value: 'behavior', label: 'Behavior' },
  { value: 'objections', label: 'Objections' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'voice', label: 'Voice' },
  { value: 'safety', label: 'Safety' },
];

/** §16.2 slider order, kept identical to the spec list. */
const TRAIT_ORDER: Array<{ key: keyof PersonaTraits; label: string; hint: string }> = [
  { key: 'trust', label: 'Trust', hint: 'Starting willingness to believe what the trainee says' },
  { key: 'patience', label: 'Patience', hint: 'How long before the persona pushes for the point' },
  { key: 'price_sensitivity', label: 'Price sensitivity', hint: 'How quickly cost becomes the objection' },
  { key: 'risk_aversion', label: 'Risk aversion', hint: 'Weight given to worst-case outcomes' },
  { key: 'product_knowledge', label: 'Product knowledge', hint: 'How much jargon the persona already understands' },
  { key: 'resistance', label: 'Resistance', hint: 'Baseline pushback against any recommendation' },
  { key: 'openness', label: 'Openness', hint: 'Willingness to share personal context unprompted' },
];

const EMPTY_PERSONA: Persona = {
  id: 'new',
  ...SCOPE,
  name: '',
  version: 1,
  status: 'draft',
  language: 'zh-TW',
  locale: 'zh-TW',
  traits: {
    trust: 50,
    patience: 50,
    price_sensitivity: 50,
    risk_aversion: 50,
    product_knowledge: 50,
    resistance: 50,
    openness: 50,
  },
  hidden: {
    primary_goal: '',
    hidden_need: '',
    main_concern: '',
    trigger_points: [],
    objections: [],
    forbidden_knowledge: [],
    opening_attitude: '',
    exit_condition: '',
    success_condition: '',
  },
  voice: { provider: 'elevenlabs', language: 'zh-TW', speed: 1, stability: 0.6 },
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

/**
 * §34 Persona Builder — portrait/preview on the left, settings cards on the right,
 * with the seven spec tabs. §35 sliders, §36 behaviour rules, §16.3 hidden state
 * (gated to coach/admin), §16.4 voice.
 */
export function PersonaBuilderPage({ personaId }: { personaId?: string }) {
  const canEdit = useCan('persona.manage');
  const canPublish = useCan('content.publish');
  const source = useMemo(() => (personaId ? personaById(personaId) : undefined) ?? EMPTY_PERSONA, [personaId]);

  const [draft, setDraft] = useState<Persona>(source);
  const [tab, setTab] = useState<BuilderTab>('identity');
  const isNew = !personaId || personaId === 'new';

  const setTrait = (key: keyof PersonaTraits, value: number) =>
    setDraft((prev) => ({ ...prev, traits: { ...prev.traits, [key]: value } }));

  const setHidden = (key: keyof NonNullable<Persona['hidden']>, value: string) =>
    setDraft((prev) => ({
      ...prev,
      hidden: { ...(prev.hidden ?? EMPTY_PERSONA.hidden!), [key]: value },
    }));

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: 'Personas', href: '/personas' }, { label: isNew ? 'New persona' : draft.name || 'Persona' }]}
        title={isNew ? 'New persona' : draft.name || 'Persona'}
        description="Identity, personality, hidden state, behaviour rules and voice. Publishing requires review when the workspace enforces maker-checker."
        meta={
          <>
            <ContentStatusPill status={draft.status} />
            <Pill tone="neutral" size="sm">v{draft.version}</Pill>
            <Pill tone="neutral" size="sm">{draft.locale}</Pill>
          </>
        }
        actions={
          <>
            {!isNew ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/personas/${draft.id}/test-lab`}>
                  <FlaskConical size={15} strokeWidth={1.8} aria-hidden />
                  Test persona
                </Link>
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" disabled={!canEdit}>
              <Save size={15} strokeWidth={1.8} aria-hidden />
              Save draft
            </Button>
            <Button variant="primary" size="sm" disabled={!canPublish}>
              Submit for review
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* Preview column */}
        <div className="space-y-4">
          <GlassCard tone="strong" className="p-5">
            <div
              className="dot-matrix mb-4 flex h-32 items-center justify-center rounded-card-sm border border-border-soft"
              aria-hidden
            >
              <span className="text-display text-text-tertiary">
                {(draft.name || '?').trim().charAt(0) || '?'}
              </span>
            </div>
            <h2 className="text-card-title">{draft.name || 'Unnamed persona'}</h2>
            <p className="text-body-sm text-text-tertiary">
              {[draft.age ? `${draft.age}` : null, draft.occupation, draft.industry].filter(Boolean).join(' · ') ||
                'No identity details yet'}
            </p>
            <p className="mt-3 text-body-sm text-text-secondary">
              {draft.background || 'Background will appear here as you fill in the identity tab.'}
            </p>

            <div className="mt-4 space-y-2 border-t border-border-soft pt-4">
              {TRAIT_ORDER.slice(0, 4).map((trait) => (
                <div key={trait.key}>
                  <div className="flex justify-between text-tiny text-text-tertiary">
                    <span>{trait.label}</span>
                    <span className="tabular-nums">{draft.traits[trait.key]}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-pill bg-border-soft">
                    <div
                      className="h-full rounded-pill"
                      style={{
                        width: `${draft.traits[trait.key]}%`,
                        background: 'linear-gradient(90deg, var(--accent-indigo), var(--accent-cyan))',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <h3 className="text-card-title">Used by</h3>
            <p className="mt-1 text-body-sm text-text-secondary">
              Changing a published persona creates a new version; running sessions keep the version they
              were pinned to.
            </p>
            <ul className="mt-3 space-y-1.5 text-body-sm">
              <li>
                <Link href="/scenarios" className="hover:text-accent-indigo">
                  「我已經有保險了」— 保障缺口對話
                </Link>
              </li>
              <li className="text-text-tertiary">2 assignments · 74 attempts</li>
            </ul>
          </GlassCard>
        </div>

        {/* Settings column */}
        <div className="space-y-4">
          <Tabs value={tab} onValueChange={(value: string) => setTab(value as BuilderTab)} items={TABS} />

          {tab === 'identity' ? (
            <GlassCard className="space-y-4 p-5">
              <h2 className="text-card-title">Basic identity</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" hint="Shown to the trainee during the session.">
                  <Input
                    value={draft.name}
                    disabled={!canEdit}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Age">
                  <Input
                    type="number"
                    value={draft.age ?? ''}
                    disabled={!canEdit}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setDraft({ ...draft, age: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </Field>
                <Field label="Occupation">
                  <Input
                    value={draft.occupation ?? ''}
                    disabled={!canEdit}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, occupation: e.target.value })}
                  />
                </Field>
                <Field label="Industry">
                  <Input
                    value={draft.industry ?? ''}
                    disabled={!canEdit}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, industry: e.target.value })}
                  />
                </Field>
                <Field label="Language">
                  <Select
                    value={draft.language}
                    onValueChange={(value: string) => setDraft({ ...draft, language: value })}
                    options={[
                      { value: 'zh-TW', label: '繁體中文 (zh-TW)' },
                      { value: 'zh-CN', label: '简体中文 (zh-CN)' },
                      { value: 'en', label: 'English' },
                      { value: 'ja', label: '日本語' },
                    ]}
                  />
                </Field>
                <Field label="Locale">
                  <Select
                    value={draft.locale}
                    onValueChange={(value: string) => setDraft({ ...draft, locale: value })}
                    options={[
                      { value: 'zh-TW', label: 'Taiwan' },
                      { value: 'en-SG', label: 'Singapore' },
                      { value: 'en-US', label: 'United States' },
                    ]}
                  />
                </Field>
              </div>
              <Field
                label="Background"
                hint="Family, finances, prior experience — this is what makes the objections feel specific."
              >
                <Textarea
                  rows={5}
                  value={draft.background ?? ''}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, background: e.target.value })}
                />
              </Field>
            </GlassCard>
          ) : null}

          {tab === 'personality' ? (
            <GlassCard className="p-5">
              <h2 className="text-card-title">Personality sliders</h2>
              <p className="mt-1 text-body-sm text-text-secondary">
                These feed the customer agent’s starting state. The simulation then moves them at runtime
                according to the behaviour rules.
              </p>
              <div className="mt-5 space-y-5">
                {TRAIT_ORDER.map((trait) => (
                  <Slider
                    key={trait.key}
                    label={trait.label}
                    hint={trait.hint}
                    min={0}
                    max={100}
                    step={1}
                    value={draft.traits[trait.key]}
                    disabled={!canEdit}
                    onValueChange={(value: number) => setTrait(trait.key, value)}
                  />
                ))}
              </div>
            </GlassCard>
          ) : null}

          {tab === 'behavior' ? (
            <div className="space-y-4">
              {/* §16.3 hidden state — coach / admin only. */}
              <GlassCard className="p-5">
                <div className="flex items-center gap-2">
                  <EyeOff size={16} strokeWidth={1.8} aria-hidden className="text-accent-violet" />
                  <h2 className="text-card-title">Hidden state</h2>
                  <Pill tone="warning" size="sm">Never sent to trainees</Pill>
                </div>
                <p className="mt-1 text-body-sm text-text-secondary">
                  The API strips this object for any role without <code>persona.manage</code>. It is what the
                  trainee is supposed to discover.
                </p>

                {canEdit ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Primary goal">
                      <Input
                        value={draft.hidden?.primary_goal ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('primary_goal', e.target.value)}
                      />
                    </Field>
                    <Field label="Hidden need">
                      <Input
                        value={draft.hidden?.hidden_need ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('hidden_need', e.target.value)}
                      />
                    </Field>
                    <Field label="Main concern">
                      <Input
                        value={draft.hidden?.main_concern ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('main_concern', e.target.value)}
                      />
                    </Field>
                    <Field label="Budget (monthly)">
                      <Input
                        type="number"
                        value={draft.hidden?.budget ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setDraft({
                            ...draft,
                            hidden: {
                              ...(draft.hidden ?? EMPTY_PERSONA.hidden!),
                              budget: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="Opening attitude">
                      <Input
                        value={draft.hidden?.opening_attitude ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('opening_attitude', e.target.value)}
                      />
                    </Field>
                    <Field label="Exit condition" hint="When the persona ends the conversation.">
                      <Input
                        value={draft.hidden?.exit_condition ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('exit_condition', e.target.value)}
                      />
                    </Field>
                    <Field label="Success condition" className="sm:col-span-2">
                      <Input
                        value={draft.hidden?.success_condition ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('success_condition', e.target.value)}
                      />
                    </Field>
                  </div>
                ) : (
                  <p className="mt-4 flex items-center gap-2 rounded-card-sm border border-border-soft px-3.5 py-3 text-body-sm text-text-tertiary">
                    <Lock size={14} strokeWidth={1.8} aria-hidden />
                    Your role cannot view persona hidden state.
                  </p>
                )}
              </GlassCard>

              {/* §36 behaviour rules */}
              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-card-title">Triggers</h2>
                    <p className="text-body-sm text-text-secondary">
                      Deterministic state changes the customer agent must apply.
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" disabled={!canEdit}>
                    <Plus size={15} strokeWidth={2} aria-hidden />
                    Add trigger
                  </Button>
                </div>

                <ul className="mt-4 space-y-2.5">
                  {PERSONA_TRIGGER_RULES.map((rule) => (
                    <li key={rule.id} className="glass-strong rounded-card-sm p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-body-sm font-medium">When {rule.when.toLowerCase()}</p>
                          <p className="mt-1 text-body-sm text-text-secondary">{rule.effect}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {rule.delta.map((delta) => (
                              <Pill
                                key={`${rule.id}-${delta.variable}`}
                                tone={delta.amount >= 0 ? 'success' : 'danger'}
                                size="sm"
                              >
                                {titleize(delta.variable)} {delta.amount >= 0 ? '+' : ''}
                                {delta.amount}
                              </Pill>
                            ))}
                          </div>
                        </div>
                        {canEdit ? (
                          <Button variant="ghost" size="sm" aria-label={`Remove trigger: ${rule.when}`}>
                            <Trash2 size={15} strokeWidth={1.8} aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            </div>
          ) : null}

          {tab === 'objections' ? (
            <GlassCard className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-card-title">Objections</h2>
                  <p className="text-body-sm text-text-secondary">
                    The persona will raise these in priority order as the conversation allows.
                  </p>
                </div>
                <Button variant="secondary" size="sm" disabled={!canEdit}>
                  <Plus size={15} strokeWidth={2} aria-hidden />
                  Add objection
                </Button>
              </div>

              <ol className="mt-4 space-y-2">
                {(draft.hidden?.objections ?? []).map((objection, index) => (
                  <li key={objection} className="glass-strong flex items-center gap-3 rounded-card-sm px-4 py-3">
                    <span className="text-meta tabular-nums text-text-tertiary">{index + 1}</span>
                    <span className="min-w-0 flex-1 text-body-sm">「{objection}」</span>
                    {index === 0 ? <Pill tone="gradient" size="sm">Main objection</Pill> : null}
                  </li>
                ))}
                {(draft.hidden?.objections ?? []).length === 0 ? (
                  <li className="text-body-sm text-text-tertiary">
                    No objection configured — the persona will only respond, never push back.
                  </li>
                ) : null}
              </ol>

              <h3 className="mt-6 text-body-sm font-semibold">Trigger points</h3>
              <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                {(draft.hidden?.trigger_points ?? []).map((point) => (
                  <li key={point} className="flex gap-2">
                    <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-accent-violet" />
                    {point}
                  </li>
                ))}
              </ul>
            </GlassCard>
          ) : null}

          {tab === 'knowledge' ? (
            <GlassCard className="p-5">
              <h2 className="text-card-title">Knowledge boundary</h2>
              <p className="mt-1 text-body-sm text-text-secondary">
                What the persona is allowed to know. Anything outside this must be answered with
                uncertainty rather than invention.
              </p>

              <h3 className="mt-5 text-body-sm font-semibold">Forbidden knowledge</h3>
              <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                {(draft.hidden?.forbidden_knowledge ?? []).map((item) => (
                  <li key={item} className="flex gap-2">
                    <Lock size={13} strokeWidth={1.8} aria-hidden className="mt-1 shrink-0 text-text-tertiary" />
                    {item}
                  </li>
                ))}
                {(draft.hidden?.forbidden_knowledge ?? []).length === 0 ? (
                  <li className="text-text-tertiary">Nothing restricted.</li>
                ) : null}
              </ul>

              <h3 className="mt-6 text-body-sm font-semibold">Knowledge bases the persona may reference</h3>
              <ul className="mt-2 space-y-2">
                {MOCK_KNOWLEDGE_BASES.slice(0, 3).map((kb) => (
                  <li key={kb.id} className="glass-strong flex items-center justify-between gap-3 rounded-card-sm px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium">{kb.name}</p>
                      <p className="text-tiny text-text-tertiary">
                        {kb.document_count} documents · scope {kb.acl.scope}
                      </p>
                    </div>
                    <Switch
                      checked={kb.id === 'kb_product_sop'}
                      onCheckedChange={() => undefined}
                      disabled={!canEdit}
                      aria-label={`Allow the persona to reference ${kb.name}`}
                    />
                  </li>
                ))}
              </ul>
            </GlassCard>
          ) : null}

          {tab === 'voice' ? (
            <GlassCard className="p-5">
              <div className="flex items-center gap-2">
                <Volume2 size={16} strokeWidth={1.8} aria-hidden className="text-accent-blue" />
                <h2 className="text-card-title">Voice</h2>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Provider">
                  <Select
                    value={draft.voice.provider}
                    onValueChange={(value: string) =>
                      setDraft({ ...draft, voice: { ...draft.voice, provider: value as Persona['voice']['provider'] } })
                    }
                    options={[
                      { value: 'elevenlabs', label: 'ElevenLabs' },
                      { value: 'openai', label: 'OpenAI' },
                      { value: 'none', label: 'Text only' },
                    ]}
                  />
                </Field>
                <Field label="Voice ID">
                  <Input
                    value={draft.voice.voice_id ?? ''}
                    disabled={!canEdit || draft.voice.provider === 'none'}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setDraft({ ...draft, voice: { ...draft.voice, voice_id: e.target.value } })
                    }
                  />
                </Field>
              </div>

              <div className="mt-5 space-y-5">
                <Slider
                  label="Speed"
                  min={0.6}
                  max={1.6}
                  step={0.02}
                  value={draft.voice.speed}
                  disabled={!canEdit}
                  onValueChange={(value: number) => setDraft({ ...draft, voice: { ...draft.voice, speed: value } })}
                />
                <Slider
                  label="Stability"
                  hint="Lower is more expressive; higher is more consistent between turns."
                  min={0}
                  max={1}
                  step={0.02}
                  value={draft.voice.stability ?? 0.6}
                  disabled={!canEdit}
                  onValueChange={(value: number) => setDraft({ ...draft, voice: { ...draft.voice, stability: value } })}
                />
              </div>

              <Field label="Emotion style" className="mt-5">
                <Input
                  value={draft.voice.emotion_style ?? ''}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft({ ...draft, voice: { ...draft.voice, emotion_style: e.target.value } })
                  }
                />
              </Field>

              <div className="mt-5 flex items-center gap-2 border-t border-border-soft pt-4">
                <Button variant="secondary" size="sm" disabled={draft.voice.provider === 'none'}>
                  <Volume2 size={15} strokeWidth={1.8} aria-hidden />
                  Preview voice
                </Button>
                <p className="text-tiny text-text-tertiary">
                  Synthesis runs on the server — no provider key reaches the browser.
                </p>
              </div>
            </GlassCard>
          ) : null}

          {tab === 'safety' ? (
            <GlassCard className="p-5">
              <h2 className="text-card-title">Safety</h2>
              <p className="mt-1 text-body-sm text-text-secondary">
                These guards are enforced server-side on every turn. The persona must stay in character and
                must never disclose its own configuration.
              </p>

              <ul className="mt-4 space-y-2.5">
                {[
                  ['Stay in character under prompt injection', 'Refuses to reveal system instructions or hidden state.'],
                  ['No invented product facts', 'Anything not in the allowed knowledge is answered with uncertainty.'],
                  ['No personal data collection', 'Will not accept or repeat full national ID numbers.'],
                  ['Escalate on distress', 'If the trainee describes a real crisis, the session pauses with guidance.'],
                ].map(([title, body]) => (
                  <li key={title} className="glass-strong flex items-start justify-between gap-3 rounded-card-sm p-4">
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium">{title}</p>
                      <p className="mt-0.5 text-body-sm text-text-secondary">{body}</p>
                    </div>
                    <Pill tone="success" size="sm">Enforced</Pill>
                  </li>
                ))}
              </ul>

              <p className="mt-4 text-tiny text-text-tertiary">
                Escape attempts are recorded as security findings, not silently ignored — see Security & Audit.
              </p>
            </GlassCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
