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
  { value: 'identity', label: '身分設定' },
  { value: 'personality', label: '個性' },
  { value: 'behavior', label: '行為' },
  { value: 'objections', label: '異議' },
  { value: 'knowledge', label: '知識' },
  { value: 'voice', label: '語音' },
  { value: 'safety', label: '安全' },
];

/** §16.2 slider order, kept identical to the spec list. */
const TRAIT_ORDER: Array<{ key: keyof PersonaTraits; label: string; hint: string }> = [
  { key: 'trust', label: '信任度', hint: '一開始願意相信學員說法的程度' },
  { key: 'patience', label: '耐心', hint: '多久之後會開始催學員講重點' },
  { key: 'price_sensitivity', label: '價格敏感度', hint: '多快會把費用變成主要異議' },
  { key: 'risk_aversion', label: '風險趨避', hint: '對最壞情況的在意程度' },
  { key: 'product_knowledge', label: '產品知識', hint: '客戶本身聽得懂多少專業術語' },
  { key: 'resistance', label: '抗拒程度', hint: '面對任何建議時的基本抗拒強度' },
  { key: 'openness', label: '開放程度', hint: '沒被追問也願意主動透露個人狀況的程度' },
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
        breadcrumbs={[{ label: '客戶角色', href: '/personas' }, { label: isNew ? '新增客戶角色' : draft.name || '客戶角色' }]}
        title={isNew ? '新增客戶角色' : draft.name || '客戶角色'}
        description="身分、個性、隱藏設定、行為規則與語音。當工作區啟用雙人覆核時，發布前必須先送審。"
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
                  測試角色
                </Link>
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" disabled={!canEdit}>
              <Save size={15} strokeWidth={1.8} aria-hidden />
              儲存草稿
            </Button>
            <Button variant="primary" size="sm" disabled={!canPublish}>
              送出審核
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* Preview column */}
        <div className="space-y-4">
          <GlassCard className="p-5">
            <div
              className="dot-matrix mb-4 flex h-32 items-center justify-center rounded-card-sm border border-border-soft"
              aria-hidden
            >
              <span className="text-display text-text-tertiary">
                {(draft.name || '?').trim().charAt(0) || '?'}
              </span>
            </div>
            <h2 className="text-card-title">{draft.name || '未命名的客戶角色'}</h2>
            <p className="text-body-sm text-text-tertiary">
              {[draft.age ? `${draft.age}` : null, draft.occupation, draft.industry].filter(Boolean).join(' · ') ||
                '尚未填寫身分資料'}
            </p>
            <p className="mt-3 text-body-sm text-text-secondary">
              {draft.background || '在「身分設定」分頁填寫後，背景描述會顯示在這裡。'}
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
                        background: 'var(--accent-indigo)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <h3 className="text-card-title">使用情況</h3>
            <p className="mt-1 text-body-sm text-text-secondary">
              修改已發布的客戶角色會產生新版本；進行中的練習仍會沿用當初綁定的版本。
            </p>
            <ul className="mt-3 space-y-1.5 text-body-sm">
              <li>
                <Link href="/scenarios" className="hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                  「我已經有保險了」— 保障缺口對話
                </Link>
              </li>
              <li className="text-text-tertiary">2 項指派 · 74 次練習</li>
            </ul>
          </GlassCard>
        </div>

        {/* Settings column */}
        <div className="space-y-4">
          <Tabs value={tab} onValueChange={(value: string) => setTab(value as BuilderTab)} items={TABS} />

          {tab === 'identity' ? (
            <GlassCard className="space-y-4 p-5">
              <h2 className="text-card-title">基本身分</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="姓名" hint="練習過程中會顯示給學員。">
                  <Input
                    value={draft.name}
                    disabled={!canEdit}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="年齡">
                  <Input
                    type="number"
                    value={draft.age ?? ''}
                    disabled={!canEdit}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setDraft({ ...draft, age: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </Field>
                <Field label="職業">
                  <Input
                    value={draft.occupation ?? ''}
                    disabled={!canEdit}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, occupation: e.target.value })}
                  />
                </Field>
                <Field label="產業">
                  <Input
                    value={draft.industry ?? ''}
                    disabled={!canEdit}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, industry: e.target.value })}
                  />
                </Field>
                <Field label="語言">
                  <Select
                    value={draft.language}
                    onValueChange={(value: string) => setDraft({ ...draft, language: value })}
                    options={[
                      { value: 'zh-TW', label: '繁體中文 (zh-TW)' },
                      { value: 'zh-CN', label: '简体中文 (zh-CN)' },
                      { value: 'en', label: '英文' },
                      { value: 'ja', label: '日本語' },
                    ]}
                  />
                </Field>
                <Field label="地區">
                  <Select
                    value={draft.locale}
                    onValueChange={(value: string) => setDraft({ ...draft, locale: value })}
                    options={[
                      { value: 'zh-TW', label: '台灣' },
                      { value: 'en-SG', label: '新加坡' },
                      { value: 'en-US', label: '美國' },
                    ]}
                  />
                </Field>
              </div>
              <Field
                label="背景"
                hint="家庭、財務、過往經驗 — 這些細節能讓異議聽起來更具體。"
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
              <h2 className="text-card-title">個性調整</h2>
              <p className="mt-1 text-body-sm text-text-secondary">
                這些數值是客戶代理人的起始狀態，練習進行時模擬會依照行為規則調整它們。
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
                  <h2 className="text-card-title">隱藏設定</h2>
                  <Pill tone="warning" size="sm">不會傳送給學員</Pill>
                </div>
                <p className="mt-1 text-body-sm text-text-secondary">
                  沒有 <code>persona.manage</code> 權限的角色，API 會先移除這個物件。這正是學員該自己問出來的內容。
                </p>

                {canEdit ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="主要目標">
                      <Input
                        value={draft.hidden?.primary_goal ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('primary_goal', e.target.value)}
                      />
                    </Field>
                    <Field label="隱藏需求">
                      <Input
                        value={draft.hidden?.hidden_need ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('hidden_need', e.target.value)}
                      />
                    </Field>
                    <Field label="主要顧慮">
                      <Input
                        value={draft.hidden?.main_concern ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('main_concern', e.target.value)}
                      />
                    </Field>
                    <Field label="每月預算">
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
                    <Field label="開場態度">
                      <Input
                        value={draft.hidden?.opening_attitude ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('opening_attitude', e.target.value)}
                      />
                    </Field>
                    <Field label="結束條件" hint="客戶在什麼情況下會結束這場對話。">
                      <Input
                        value={draft.hidden?.exit_condition ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('exit_condition', e.target.value)}
                      />
                    </Field>
                    <Field label="成功條件" className="sm:col-span-2">
                      <Input
                        value={draft.hidden?.success_condition ?? ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHidden('success_condition', e.target.value)}
                      />
                    </Field>
                  </div>
                ) : (
                  <p className="mt-4 flex items-center gap-2 rounded-card-sm border border-border-soft px-3.5 py-3 text-body-sm text-text-tertiary">
                    <Lock size={14} strokeWidth={1.8} aria-hidden />
                    你目前的角色權限無法檢視客戶角色的隱藏設定。
                  </p>
                )}
              </GlassCard>

              {/* §36 behaviour rules */}
              <GlassCard className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-card-title">觸發規則</h2>
                    <p className="text-body-sm text-text-secondary">
                      客戶代理人必須確實套用的狀態變化。
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" disabled={!canEdit}>
                    <Plus size={15} strokeWidth={2} aria-hidden />
                    新增觸發規則
                  </Button>
                </div>

                <ul className="mt-4 space-y-2.5">
                  {PERSONA_TRIGGER_RULES.map((rule) => (
                    <li key={rule.id} className="border border-border-soft bg-glass-card rounded-card-sm p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-body-sm font-medium">觸發條件：{rule.when}</p>
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
                          <Button variant="ghost" size="sm" aria-label={`刪除觸發規則：${rule.when}`}>
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
                  <h2 className="text-card-title">異議</h2>
                  <p className="text-body-sm text-text-secondary">
                    對話允許時，客戶會依照優先順序提出這些異議。
                  </p>
                </div>
                <Button variant="secondary" size="sm" disabled={!canEdit}>
                  <Plus size={15} strokeWidth={2} aria-hidden />
                  新增異議
                </Button>
              </div>

              <ol className="mt-4 space-y-2">
                {(draft.hidden?.objections ?? []).map((objection, index) => (
                  <li key={objection} className="border border-border-soft bg-glass-card flex items-center gap-3 rounded-card-sm px-4 py-3">
                    <span className="text-meta tabular-nums text-text-tertiary">{index + 1}</span>
                    <span className="min-w-0 flex-1 text-body-sm">「{objection}」</span>
                    {index === 0 ? <Pill tone="gradient" size="sm">主要異議</Pill> : null}
                  </li>
                ))}
                {(draft.hidden?.objections ?? []).length === 0 ? (
                  <li className="text-body-sm text-text-tertiary">
                    尚未設定任何異議 — 客戶只會被動回應，不會提出質疑。
                  </li>
                ) : null}
              </ol>

              <h3 className="mt-6 text-body-sm font-semibold">觸發點</h3>
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
              <h2 className="text-card-title">知識邊界</h2>
              <p className="mt-1 text-body-sm text-text-secondary">
                客戶被允許知道的範圍。超出範圍的問題必須以不確定的語氣回應，不能自行編造。
              </p>

              <h3 className="mt-5 text-body-sm font-semibold">不可知道的資訊</h3>
              <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                {(draft.hidden?.forbidden_knowledge ?? []).map((item) => (
                  <li key={item} className="flex gap-2">
                    <Lock size={13} strokeWidth={1.8} aria-hidden className="mt-1 shrink-0 text-text-tertiary" />
                    {item}
                  </li>
                ))}
                {(draft.hidden?.forbidden_knowledge ?? []).length === 0 ? (
                  <li className="text-text-tertiary">沒有任何限制。</li>
                ) : null}
              </ul>

              <h3 className="mt-6 text-body-sm font-semibold">客戶角色可參考的知識庫</h3>
              <ul className="mt-2 space-y-2">
                {MOCK_KNOWLEDGE_BASES.slice(0, 3).map((kb) => (
                  <li key={kb.id} className="border border-border-soft bg-glass-card flex items-center justify-between gap-3 rounded-card-sm px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-body-sm font-medium">{kb.name}</p>
                      <p className="text-tiny text-text-tertiary">
                        {kb.document_count} 份文件 · 範圍 {kb.acl.scope}
                      </p>
                    </div>
                    <Switch
                      checked={kb.id === 'kb_product_sop'}
                      onCheckedChange={() => undefined}
                      disabled={!canEdit}
                      aria-label={`允許客戶角色參考 ${kb.name}`}
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
                <h2 className="text-card-title">語音</h2>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="語音服務">
                  <Select
                    value={draft.voice.provider}
                    onValueChange={(value: string) =>
                      setDraft({ ...draft, voice: { ...draft.voice, provider: value as Persona['voice']['provider'] } })
                    }
                    options={[
                      { value: 'elevenlabs', label: 'ElevenLabs' },
                      { value: 'openai', label: 'OpenAI' },
                      { value: 'none', label: '純文字（不發聲）' },
                    ]}
                  />
                </Field>
                <Field label="語音 ID">
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
                  label="語速"
                  min={0.6}
                  max={1.6}
                  step={0.02}
                  value={draft.voice.speed}
                  disabled={!canEdit}
                  onValueChange={(value: number) => setDraft({ ...draft, voice: { ...draft.voice, speed: value } })}
                />
                <Slider
                  label="穩定度"
                  hint="數值越低情緒起伏越大，越高則每一輪之間越一致。"
                  min={0}
                  max={1}
                  step={0.02}
                  value={draft.voice.stability ?? 0.6}
                  disabled={!canEdit}
                  onValueChange={(value: number) => setDraft({ ...draft, voice: { ...draft.voice, stability: value } })}
                />
              </div>

              <Field label="情緒風格" className="mt-5">
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
                  試聽語音
                </Button>
                <p className="text-tiny text-text-tertiary">
                  語音合成在伺服器端執行 — 服務商金鑰不會傳到瀏覽器。
                </p>
              </div>
            </GlassCard>
          ) : null}

          {tab === 'safety' ? (
            <GlassCard className="p-5">
              <h2 className="text-card-title">安全</h2>
              <p className="mt-1 text-body-sm text-text-secondary">
                這些防護會在每一輪對話由伺服器端強制執行。客戶必須維持人設，且絕不能透露自己的設定內容。
              </p>

              <ul className="mt-4 space-y-2.5">
                {[
                  ['遇到提示注入仍維持人設', '拒絕透露系統指令或隱藏設定。'],
                  ['不編造商品事實', '不在授權知識範圍內的內容，一律以不確定的語氣回應。'],
                  ['不蒐集個人資料', '不會接受或複述完整的身分證字號。'],
                  ['遇到情緒危機時上報', '若學員描述的是真實的危機狀況，練習會暫停並提供指引。'],
                ].map(([title, body]) => (
                  <li key={title} className="border border-border-soft bg-glass-card flex items-start justify-between gap-3 rounded-card-sm p-4">
                    <div className="min-w-0">
                      <p className="text-body-sm font-medium">{title}</p>
                      <p className="mt-0.5 text-body-sm text-text-secondary">{body}</p>
                    </div>
                    <Pill tone="success" size="sm">已強制執行</Pill>
                  </li>
                ))}
              </ul>

              <p className="mt-4 text-tiny text-text-tertiary">
                跳脫人設的嘗試會記錄為安全事件，不會被靜默忽略 — 詳見「安全與稽核」。
              </p>
            </GlassCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
