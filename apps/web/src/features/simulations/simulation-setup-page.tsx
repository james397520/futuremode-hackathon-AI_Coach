'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Mic, Play, ShieldCheck, Target } from 'lucide-react';
import { Button, GlassCard, Pill, Switch } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { DifficultyPill, ModePill } from '@/components/status';
import { RuntimeBadge, useComputeCapability } from '@/components/runtime';
import { knowledgeBaseById } from '@/lib/fixtures/knowledge';
import { personaById } from '@/lib/fixtures/personas';
import { endpoints, ApiError } from '@/lib/api-client';
import { RUBRIC_LIFE_CORE, SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { useCan } from '@/lib/auth-context';
import { formatDuration } from '@/lib/utils';

/**
 * §58-5 Simulation Setup — the pre-flight page.
 *
 * Everything the session will be pinned to is confirmed here (§54 version
 * pinning): scenario version, persona version, rubric, knowledge bases, mode,
 * voice and live scoring. Assessment mode disables hints and coach cards (§8.4),
 * which is stated on this page rather than discovered mid-session.
 */
export function SimulationSetupPage({ scenarioId }: { scenarioId: string }) {
  const router = useRouter();
  const { data: scenario } = useQuery({
    queryKey: ['scenario', scenarioId],
    queryFn: () => endpoints.getScenario(scenarioId),
    retry: false,
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  /*
   * Starting a session creates one through the API and navigates to the id it
   * returns. This used to be a plain <Link> to `DEMO_SESSION_ID` ('ses_1207'),
   * a fixture id the backend has no row for — so every "Start" landed on
   * "This session could not be loaded / Not Found".
   */
  const startSession = () => {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    void (async () => {
      try {
        const created = await endpoints.createSession({
          scenario_id: scenarioId,
          mode: scenario?.mode ?? 'training',
          voice_enabled: voice,
          score_live_enabled: liveScore,
        });
        const id = created.session.session_id;
        router.push(voice ? `/simulations/${id}/voice` : `/simulations/${id}/live`);
      } catch (err) {
        setStartError(
          err instanceof ApiError ? err.message : '無法建立練習，請確認 API 是否啟動。',
        );
        setStarting(false);
      }
    })();
  };
  /*
   * The persona comes from the same database as the scenario. This used to be
   * `personaById(scenario.persona_id)` — a *fixture* lookup keyed on ids like
   * `per_chen`, which never matches the real 32-char id an API scenario
   * carries, so the whole customer card (name, traits, hidden state) silently
   * vanished. The fixture stays as a fallback for fixture-only scenarios.
   */
  const { data: livePersona } = useQuery({
    queryKey: ['persona', scenario?.persona_id],
    queryFn: () => endpoints.getPersona(scenario!.persona_id),
    enabled: Boolean(scenario?.persona_id),
    retry: false,
  });
  const persona = livePersona ?? (scenario ? personaById(scenario.persona_id) : undefined);
  const canSeeHidden = useCan('persona.manage');
  const { label: runtimeLabel } = useComputeCapability();

  const [voice, setVoice] = useState(true);
  const [liveScore, setLiveScore] = useState(true);
  const [captions, setCaptions] = useState(true);

  if (!scenario) {
    return (
      <div className="space-y-4 pb-4">
        <PageHeader
          breadcrumbs={[{ label: '模擬練習', href: '/simulations' }, { label: '設定練習' }]}
          title="找不到這個情境"
          description="這個情境可能已被封存，或連結來自較舊的版本。"
        />
        <Button variant="secondary" size="sm" asChild>
          <Link href="/simulations">回到情境庫</Link>
        </Button>
      </div>
    );
  }

  const isAssessment = scenario.mode === 'assessment';

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: '模擬練習', href: '/simulations' }, { label: scenario.name }, { label: '設定練習' }]}
        title={scenario.name}
        description={scenario.description}
        meta={
          <>
            <DifficultyPill difficulty={scenario.difficulty} />
            <ModePill mode={scenario.mode} />
            <Pill tone="neutral" size="sm">情境 v{scenario.version}</Pill>
            {persona ? <Pill tone="neutral" size="sm">客戶 v{persona.version}</Pill> : null}
            <RuntimeBadge />
          </>
        }
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button variant="primary" size="md" onClick={startSession} disabled={starting}>
              {voice ? <Mic size={16} strokeWidth={1.9} aria-hidden /> : <Play size={16} strokeWidth={2} aria-hidden />}
              {starting ? '建立中…' : voice ? '開始語音練習' : '開始練習'}
            </Button>
            {startError != null ? (
              <p role="alert" className="text-meta text-state-danger-ink">
                {startError}
              </p>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* Opening context */}
          <GlassCard className="p-5">
            <h2 className="text-card-title">開場情境</h2>
            <p className="mt-2 text-body text-text-secondary">{scenario.opening_context}</p>
          </GlassCard>

          {/* Objectives + talking points */}
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Target size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">評分依據</h2>
            </div>

            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <section>
                <p className="meta-label">學習目標</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                  {scenario.learning_objectives.map((objective) => (
                    <li key={objective} className="flex gap-2">
                      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-accent-indigo" />
                      {objective}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="meta-label">必須提及的重點</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                  {scenario.required_talking_points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-accent-cyan" />
                      {point}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="meta-label">預期會遇到的異議</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                  {scenario.key_objections.map((objection) => (
                    <li key={objection}>「{objection}」</li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="meta-label text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]">禁止提及的話題</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                  {scenario.restricted_topics.length === 0 ? (
                    <li className="text-text-tertiary">此情境未設定禁止話題。</li>
                  ) : null}
                  {scenario.restricted_topics.map((topic) => (
                    <li key={topic} className="flex gap-2">
                      <AlertTriangle
                        size={13}
                        strokeWidth={1.9}
                        aria-hidden
                        className="mt-1 shrink-0 text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]"
                      />
                      {topic}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <dl className="mt-5 grid gap-3 border-t border-border-soft pt-4 text-body-sm sm:grid-cols-2">
              <div>
                <dt className="meta-label">通過條件</dt>
                <dd className="mt-1 text-text-secondary">{scenario.success_condition}</dd>
              </div>
              <div>
                <dt className="meta-label">失敗條件</dt>
                <dd className="mt-1 text-text-secondary">{scenario.failure_condition}</dd>
              </div>
            </dl>
          </GlassCard>

          {/* Rubric */}
          <GlassCard className="p-5">
            <h2 className="text-card-title">評分規準 — {RUBRIC_LIFE_CORE.name} v{RUBRIC_LIFE_CORE.version}</h2>
            <p className="mt-1 text-body-sm text-text-secondary">
              及格門檻 {RUBRIC_LIFE_CORE.pass_threshold} 分。每一項分數都會附上逐字稿佐證。
            </p>
            <ul className="mt-4 grid gap-x-6 gap-y-1.5 text-body-sm sm:grid-cols-2">
              {Object.entries(RUBRIC_LIFE_CORE.weights).map(([skill, weight]) => (
                <li key={skill} className="flex items-center justify-between gap-3">
                  <span className="truncate text-text-secondary">
                    {SKILL_LABEL[skill as keyof typeof SKILL_LABEL] ?? skill}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-tertiary">{weight}%</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>

        <div className="space-y-4">
          {/* Persona card */}
          {persona ? (
            <GlassCard className="p-5">
              <p className="meta-label">你將對談的模擬人物</p>
              <h2 className="mt-2 text-section">{persona.name}</h2>
              <p className="text-body-sm text-text-secondary">
                {[persona.age ? `${persona.age}` : null, persona.occupation, persona.industry]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-3 text-body-sm text-text-secondary">{persona.background}</p>

              <div className="mt-4 space-y-2">
                {(
                  [
                    ['價格敏感度', persona.traits.price_sensitivity],
                    ['抗拒程度', persona.traits.resistance],
                    ['信任程度', persona.traits.trust],
                    ['耐心程度', persona.traits.patience],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <div className="flex justify-between text-tiny text-text-tertiary">
                      <span>{label}</span>
                      <span className="tabular-nums">{value}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-border-soft">
                      <div
                        className="h-full rounded-pill"
                        style={{
                          width: `${value}%`,
                          background: 'var(--accent-indigo)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {canSeeHidden && persona.hidden ? (
                <details className="mt-4 rounded-card-sm border border-border-soft px-3.5 py-3">
                  <summary className="cursor-pointer text-body-sm font-medium">
                    隱藏狀態（僅教練與管理者可見）
                  </summary>
                  <dl className="mt-3 space-y-2 text-body-sm">
                    <div>
                      <dt className="meta-label">隱藏需求</dt>
                      <dd className="text-text-secondary">{persona.hidden.hidden_need}</dd>
                    </div>
                    <div>
                      <dt className="meta-label">主要顧慮</dt>
                      <dd className="text-text-secondary">{persona.hidden.main_concern}</dd>
                    </div>
                    <div>
                      <dt className="meta-label">結束條件</dt>
                      <dd className="text-text-secondary">{persona.hidden.exit_condition}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-tiny text-text-tertiary">
                    學員永遠不會收到這份資料——API 會為無權限的角色過濾掉它。
                  </p>
                </details>
              ) : null}
            </GlassCard>
          ) : null}

          {/* Session options */}
          <GlassCard className="p-5">
            <h2 className="text-card-title">練習選項</h2>

            <div className="mt-4 space-y-4">
              <Switch
                checked={voice}
                onCheckedChange={setVoice}
                label="語音練習"
                aria-describedby="voice-hint"
              />
              <p id="voice-hint" className="-mt-2 text-tiny text-text-tertiary">
                按住說話、可隨時插話。若麥克風無法使用會自動改回文字輸入。
              </p>

              <Switch
                checked={captions}
                onCheckedChange={setCaptions}
                label="即時字幕"
              />

              <Switch
                checked={liveScore && !isAssessment}
                onCheckedChange={setLiveScore}
                disabled={isAssessment}
                label="即時計分面板"
              />
              {isAssessment ? (
                <p className="-mt-2 text-tiny text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]">
                  評測模式：即時計分、教練提示與知識庫查詢皆已停用。
                </p>
              ) : null}
            </div>

            <dl className="mt-5 space-y-2 border-t border-border-soft pt-4 text-body-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">時間限制</dt>
                <dd>{scenario.time_limit_seconds ? formatDuration(scenario.time_limit_seconds) : '不限時'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">最多回合</dt>
                <dd className="tabular-nums">{scenario.max_turns ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">及格分數</dt>
                <dd className="tabular-nums">{scenario.minimum_score ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">運算模式</dt>
                <dd>{runtimeLabel}</dd>
              </div>
            </dl>
          </GlassCard>

          {/* Knowledge grounding */}
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <BookOpen size={16} strokeWidth={1.8} aria-hidden className="text-accent-blue" />
              <h2 className="text-card-title">知識庫依據</h2>
            </div>
            <ul className="mt-3 space-y-2">
              {scenario.knowledge_base_ids.map((kbId) => {
                const kb = knowledgeBaseById(kbId);
                return (
                  <li key={kbId} className="text-body-sm">
                    {/*
                      * A real scenario carries a real knowledge-base id, which the
                      * fixture lookup misses. Printing `kbId` then put a 32-char
                      * hash where a name belongs. The API cannot fill the gap yet
                      * (`GET /knowledge-bases` answers 500 — `KnowledgeService`
                      * has no `list_knowledge_bases`), so until it can, say what
                      * is true in words rather than showing the raw id.
                      */}
                    <Link href={`/knowledge/${kbId}`} className="font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                      {kb?.name ?? '本情境指定的知識庫'}
                    </Link>
                    <p className="text-tiny text-text-tertiary">
                      {kb ? `${kb.document_count} 份文件 · ${kb.chunk_count.toLocaleString('zh-TW')} 個片段` : '開啟知識庫查看內容'}
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex items-start gap-2 text-tiny text-text-tertiary">
              <ShieldCheck size={13} strokeWidth={1.8} aria-hidden className="mt-0.5 shrink-0" />
              查詢範圍僅限本工作區與你的存取權限清單，結構上不可能查到其他租戶的資料。
            </p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
