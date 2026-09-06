'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Play, Save } from 'lucide-react';
import { Button, Field, GlassCard, Input, Pill, Select, StepProgress, Switch, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DifficultyPill, ModePill } from '@/components/status';
import { SCENARIO_WIZARD_STEPS, scenarioById } from '@/lib/fixtures/scenarios';
import { MOCK_PERSONAS, personaById } from '@/lib/fixtures/personas';
import { MOCK_KNOWLEDGE_BASES } from '@/lib/fixtures/knowledge';
import { MOCK_RUBRICS, RUBRIC_LIFE_CORE, SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { useCan } from '@/lib/auth-context';
import { formatDuration } from '@/lib/utils';

/**
 * §17 Scenario Builder — the nine-step wizard, driven by `StepProgress`
 * (horizontal glass stepper). Every field in the §17 field list has a home in
 * one of the steps, and step 8 is a real preview rather than a summary table.
 */
export function ScenarioBuilderPage({ scenarioId }: { scenarioId: string }) {
  const canEdit = useCan('scenario.manage');
  const canPublish = useCan('content.publish');
  const isNew = scenarioId === 'new';

  const source = useMemo(() => scenarioById(scenarioId), [scenarioId]);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(source?.name ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [industry, setIndustry] = useState(source?.industry ?? '');
  const [trainingType, setTrainingType] = useState(source?.training_type ?? '');
  const [personaId, setPersonaId] = useState(source?.persona_id ?? MOCK_PERSONAS[0]?.id ?? '');
  const [difficulty, setDifficulty] = useState(source?.difficulty ?? 'medium');
  const [mode, setMode] = useState(source?.mode ?? 'training');
  const [openingContext, setOpeningContext] = useState(source?.opening_context ?? '');
  const [selectedKbs, setSelectedKbs] = useState<string[]>(source?.knowledge_base_ids ?? []);
  const [adaptive, setAdaptive] = useState(true);
  const [rubricId, setRubricId] = useState(source?.rubric_id ?? RUBRIC_LIFE_CORE.id);

  const persona = personaById(personaId);
  const total = SCENARIO_WIZARD_STEPS.length;
  const currentStep = SCENARIO_WIZARD_STEPS[step];

  const toggleKb = (kbId: string) =>
    setSelectedKbs((prev) => (prev.includes(kbId) ? prev.filter((id) => id !== kbId) : [...prev, kbId]));

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: '情境', href: '/scenarios' },
          { label: isNew ? '新增情境' : name || '情境' },
          { label: '編輯器' },
        ]}
        title={isNew ? '新增情境' : name || '情境編輯器'}
        description={`第 ${step + 1} / ${total} 步 — ${currentStep?.label ?? ''}`}
        meta={
          <>
            {source ? <ContentStatusPill status={source.status} /> : <ContentStatusPill status="draft" />}
            <DifficultyPill difficulty={difficulty} />
            <ModePill mode={mode} />
            {source ? <Pill tone="neutral" size="sm">v{source.version}</Pill> : null}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={!canEdit}>
              <Save size={15} strokeWidth={1.8} aria-hidden />
              儲存草稿
            </Button>
            <Button variant="primary" size="sm" disabled={!canPublish || step < total - 1}>
              發布
            </Button>
          </>
        }
      />

      <GlassCard className="p-5">
        <StepProgress
          orientation="horizontal"
          aria-label="情境編輯步驟"
          steps={SCENARIO_WIZARD_STEPS.map((wizardStep) => ({ id: wizardStep.id, label: wizardStep.label }))}
          current={step}
        />
      </GlassCard>

      <GlassCard className="p-6">
        {step === 0 ? (
          <section className="space-y-4">
            <h2 className="text-section">基本資料</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="名稱" hint="學員在情境庫中看到的名稱。">
                <Input value={name} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
              </Field>
              <Field label="產業">
                <Input value={industry} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIndustry(e.target.value)} />
              </Field>
              <Field label="訓練類型">
                <Input value={trainingType} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTrainingType(e.target.value)} />
              </Field>
              <Field label="難度" hint="難度引擎仍可能在練習過程中自動調整。">
                <Select
                  value={difficulty}
                  onValueChange={(value: string) => setDifficulty(value as typeof difficulty)}
                  options={[
                    { value: 'easy', label: '初階' },
                    { value: 'medium', label: '中階' },
                    { value: 'hard', label: '進階' },
                    { value: 'expert', label: '專家' },
                  ]}
                />
              </Field>
            </div>
            <Field label="說明">
              <Textarea rows={4} value={description} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)} />
            </Field>
            <Field label="模式" hint="評測模式會關閉提示、教練卡片與知識庫查看。">
              <Select
                value={mode}
                onValueChange={(value: string) => setMode(value as typeof mode)}
                options={[
                  { value: 'training', label: '訓練模式 — 可使用教練輔助' },
                  { value: 'assessment', label: '評測模式 — 無任何輔助' },
                ]}
              />
            </Field>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="space-y-4">
            <h2 className="text-section">選擇知識庫</h2>
            <p className="text-body-sm text-text-secondary">
              檢索範圍只限於這裡勾選的知識庫，並會再與學員自身的存取權限取交集。工作區以外的資料一律無法取得。
            </p>
            <ul className="space-y-2">
              {MOCK_KNOWLEDGE_BASES.map((kb) => (
                <li key={kb.id} className="border border-border-soft bg-glass-card flex items-start justify-between gap-3 rounded-card-sm p-4">
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium">{kb.name}</p>
                    <p className="mt-0.5 text-body-sm text-text-secondary">{kb.description}</p>
                    <p className="mt-1 text-tiny text-text-tertiary">
                      {kb.document_count} 份文件 · {kb.chunk_count.toLocaleString('en-US')} 個片段 · 範圍{' '}
                      {kb.acl.scope} · {kb.embedding_model}
                    </p>
                  </div>
                  <Switch
                    checked={selectedKbs.includes(kb.id)}
                    onCheckedChange={() => toggleKb(kb.id)}
                    disabled={!canEdit}
                    aria-label={`檢索時使用 ${kb.name}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4">
            <h2 className="text-section">選擇客戶角色</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {MOCK_PERSONAS.filter((option) => option.status !== 'archived').map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPersonaId(option.id)}
                    aria-pressed={personaId === option.id}
                    className={`w-full rounded-card-sm border px-4 py-3.5 text-left transition-transform duration-150 ease-out-soft hover:-translate-y-px ${
                      personaId === option.id ? 'border-accent-indigo bg-glass-card' : 'border-border-soft'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-body-sm font-medium">{option.name}</p>
                      {personaId === option.id ? (
                        <Check size={15} strokeWidth={2.2} aria-hidden className="shrink-0 text-accent-indigo" />
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-tiny text-text-tertiary">
                      {[option.age ? `${option.age}` : null, option.occupation].filter(Boolean).join(' · ')} · v
                      {option.version}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {persona ? (
              <p className="text-body-sm text-text-secondary">
                已選擇：<span className="font-medium">{persona.name}</span> — 主要異議「
                {persona.hidden?.objections[0] ?? '尚未設定'}」
              </p>
            ) : null}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-4">
            <h2 className="text-section">定義情境</h2>
            <Field label="開場情境" hint="時間、地點、氣氛 — 學員一開始面對的是什麼場面。">
              <Textarea rows={3} value={openingContext} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setOpeningContext(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="學習目標" hint="每行一項。">
                <Textarea rows={5} defaultValue={(source?.learning_objectives ?? []).join('\n')} disabled={!canEdit} />
              </Field>
              <Field label="必談重點" hint="每行一項。">
                <Textarea rows={5} defaultValue={(source?.required_talking_points ?? []).join('\n')} disabled={!canEdit} />
              </Field>
              <Field label="必備知識" hint="每行一項。">
                <Textarea rows={4} defaultValue={(source?.required_knowledge ?? []).join('\n')} disabled={!canEdit} />
              </Field>
              <Field label="主要異議" hint="每行一項。">
                <Textarea rows={4} defaultValue={(source?.key_objections ?? []).join('\n')} disabled={!canEdit} />
              </Field>
              <Field label="成功條件">
                <Textarea rows={2} defaultValue={source?.success_condition ?? ''} disabled={!canEdit} />
              </Field>
              <Field label="失敗條件">
                <Textarea rows={2} defaultValue={source?.failure_condition ?? ''} disabled={!canEdit} />
              </Field>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="space-y-4">
            <h2 className="text-section">動態行為</h2>
            <p className="text-body-sm text-text-secondary">
              §18 難度引擎 — 情境在進行中可以自動調整到什麼程度。
            </p>
            <Switch
              checked={adaptive}
              onCheckedChange={setAdaptive}
              disabled={!canEdit}
              label="允許練習過程中動態調整難度"
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="時間上限（秒）">
                <Input type="number" defaultValue={source?.time_limit_seconds ?? 900} disabled={!canEdit} />
              </Field>
              <Field label="最多輪數">
                <Input type="number" defaultValue={source?.max_turns ?? 40} disabled={!canEdit} />
              </Field>
              <Field label="及格分數">
                <Input type="number" defaultValue={source?.minimum_score ?? 80} disabled={!canEdit} />
              </Field>
            </div>
            <ul className="space-y-2">
              {[
                ['學員進度超前時提高難度', '客戶會再提出更深一層的異議。'],
                ['連續兩次失手後降低難度', '客戶會給出更明確的訊號，而不是直接結束對話。'],
                ['評測模式維持固定難度', '評測情境一律關閉動態調整。'],
              ].map(([title, body]) => (
                <li key={title} className="border border-border-soft bg-glass-card rounded-card-sm p-4">
                  <p className="text-body-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-body-sm text-text-secondary">{body}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="space-y-4">
            <h2 className="text-section">評分規準</h2>
            <Field label="評分規準" hint="報告會鎖定練習當下所使用的規準版本。">
              <Select
                value={rubricId}
                onValueChange={setRubricId}
                options={MOCK_RUBRICS.map((rubric) => ({
                  value: rubric.id,
                  label: `${rubric.name} v${rubric.version} — 及格門檻 ${rubric.pass_threshold}`,
                }))}
              />
            </Field>

            {(() => {
              const rubric = MOCK_RUBRICS.find((entry) => entry.id === rubricId) ?? RUBRIC_LIFE_CORE;
              return (
                <>
                  <ul className="grid gap-x-6 gap-y-1.5 text-body-sm sm:grid-cols-2">
                    {Object.entries(rubric.weights).map(([skill, weight]) => (
                      <li key={skill} className="flex items-center justify-between gap-3">
                        <span className="truncate text-text-secondary">
                          {SKILL_LABEL[skill as keyof typeof SKILL_LABEL] ?? skill}
                        </span>
                        <span className="shrink-0 tabular-nums text-text-tertiary">{weight}%</span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="meta-label">必要佐證</p>
                      <ul className="mt-2 space-y-1 text-body-sm text-text-secondary">
                        {rubric.required_evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="meta-label text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]">禁止行為</p>
                      <ul className="mt-2 space-y-1 text-body-sm text-text-secondary">
                        {rubric.forbidden_behaviors.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              );
            })()}
          </section>
        ) : null}

        {step === 6 ? (
          <section className="space-y-4">
            <h2 className="text-section">合規與安全</h2>
            <Field label="受限主題" hint="每行一項。對話中提到就會產生一筆合規事件。">
              <Textarea rows={4} defaultValue={(source?.restricted_topics ?? []).join('\n')} disabled={!canEdit} />
            </Field>
            <ul className="space-y-2">
              {[
                ['合規政策', 'Insurance TW 2026 — 沿用工作區設定。'],
                ['個資處理', '識別資訊在匯入時就會遮蔽，不會存進逐字稿。'],
                ['注入偵測', '已啟用 — 每次嘗試都會記錄為安全事件。'],
                ['重大違規處理', '評測情境一旦出現重大違規，立即判定為不通過。'],
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
          </section>
        ) : null}

        {step === 7 ? (
          <section className="space-y-4">
            <h2 className="text-section">預覽與測試</h2>
            <p className="text-body-sm text-text-secondary">
              在指派出去之前先自己跑一次。試跑會被標記為測試，絕不會計入學員的報告。
            </p>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="meta-label">客戶角色</dt>
                <dd className="text-body-sm">{persona?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="meta-label">知識庫</dt>
                <dd className="text-body-sm">已選 {selectedKbs.length} 個</dd>
              </div>
              <div>
                <dt className="meta-label">模式</dt>
                <dd className="text-body-sm">{mode === 'assessment' ? '評測模式' : '訓練模式'}</dd>
              </div>
              <div>
                <dt className="meta-label">時間上限</dt>
                <dd className="text-body-sm">
                  {formatDuration(source?.time_limit_seconds ?? 900)}
                </dd>
              </div>
            </dl>
            <Button variant="primary" size="sm" asChild={Boolean(source)} disabled={!source}>
              {source ? (
                <Link href={`/simulations/${source.id}/setup`}>
                  <Play size={15} strokeWidth={2} aria-hidden />
                  執行試跑
                </Link>
              ) : (
                <>
                  <Play size={15} strokeWidth={2} aria-hidden />
                  請先儲存草稿
                </>
              )}
            </Button>
          </section>
        ) : null}

        {step === 8 ? (
          <section className="space-y-4">
            <h2 className="text-section">發布</h2>
            <p className="text-body-sm text-text-secondary">
              發布會建立一個不可再變更的新版本。已在進行的練習仍沿用原本的版本，因此既有報告依然可以重現。
            </p>
            <ul className="space-y-2">
              {[
                ['已填寫名稱與說明', name.trim().length > 0],
                ['已選擇客戶角色', Boolean(persona)],
                ['至少一個知識庫', selectedKbs.length > 0],
                ['已指定評分規準', Boolean(rubricId)],
                ['已填寫開場情境', openingContext.trim().length > 0],
              ].map(([label, done]) => (
                <li key={String(label)} className="flex items-center gap-2.5 text-body-sm">
                  <span
                    aria-hidden
                    className={
                      done
                        ? 'text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]'
                        : 'text-text-tertiary'
                    }
                  >
                    <Check size={15} strokeWidth={2.2} />
                  </span>
                  <span className={done ? '' : 'text-text-tertiary'}>{String(label)}</span>
                  {!done ? <Pill tone="warning" size="sm">尚未完成</Pill> : null}
                </li>
              ))}
            </ul>
            {!canPublish ? (
              <p className="text-body-sm text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]">
                你的角色可以儲存草稿，但無法發布。請改為送出審核。
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Wizard navigation */}
        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border-soft pt-5">
          <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((prev) => Math.max(0, prev - 1))}>
            <ArrowLeft size={15} strokeWidth={1.8} aria-hidden />
            上一步
          </Button>
          <p className="text-tiny text-text-tertiary">
            第 {step + 1} / {total} 步
          </p>
          <Button
            variant="primary"
            size="sm"
            disabled={step === total - 1}
            onClick={() => setStep((prev) => Math.min(total - 1, prev + 1))}
          >
            下一步
            <ArrowRight size={15} strokeWidth={1.8} aria-hidden />
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
