'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, RotateCcw, Sparkles } from 'lucide-react';
import { Button, GlassCard, Pill } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ScoreBar } from '@/components/data-viz';
import { RiskPill } from '@/components/status';
import {
  DEMO_EVALUATION,
  DEMO_RECOMMENDATION,
  RUBRIC_LIFE_CORE,
  SKILL_LABEL,
} from '@/lib/fixtures/evaluations';
import { MOCK_COACH_INSIGHTS, sessionById } from '@/lib/fixtures/sessions';
import { documentById } from '@/lib/fixtures/knowledge';
import { questionById } from '@/lib/fixtures/questions';
import { scenarioById } from '@/lib/fixtures/scenarios';
import { DIFFICULTY_LABEL } from '@/features/simulation/lib/labels';
import { formatDuration, titleize } from '@/lib/utils';

/**
 * §58-8 Session Completion (§29 Part I) and §33 closed-loop adaptive learning.
 *
 * The completion screen is a *handoff*, not a scoreboard: what happened, the one
 * thing to fix, and the next concrete action (retry, next scenario, reading,
 * question set).
 */
export function SessionCompletePage({ sessionId }: { sessionId: string }) {
  const session = sessionById(sessionId);
  const scenario = session ? scenarioById(session.scenario_id) : undefined;
  const evaluation = DEMO_EVALUATION;

  const durationSeconds =
    session?.ended_at && session.started_at
      ? Math.max(
          0,
          Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000),
        )
      : 0;

  const topSkills = [...evaluation.skills].sort((a, b) => b.score - a.score).slice(0, 3);
  const weakSkills = [...evaluation.skills].sort((a, b) => a.score - b.score).slice(0, 3);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: '模擬練習', href: '/simulations' },
          { label: scenario?.name ?? sessionId },
          { label: '完成' },
        ]}
        title="練習完成"
        description={scenario?.name}
        meta={
          <>
            <Pill tone={evaluation.passed ? 'success' : 'danger'} size="sm">
              {evaluation.passed ? '通過' : '未通過'}
            </Pill>
            <RiskPill risk={evaluation.compliance_status} />
            {session ? <Pill tone="neutral" size="sm">{session.turn_count} 回合</Pill> : null}
            {durationSeconds > 0 ? (
              <Pill tone="neutral" size="sm">{formatDuration(durationSeconds)}</Pill>
            ) : null}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/simulations/${sessionId}/review`}>
                完整報告
                <ArrowRight size={15} strokeWidth={1.8} aria-hidden />
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/simulations/${DEMO_RECOMMENDATION.retry_scenario_id ?? ''}/setup`}>
                <RotateCcw size={15} strokeWidth={1.8} aria-hidden />
                再練一次
              </Link>
            </Button>
          </>
        }
      />

      <GlassCard className="relative overflow-hidden p-6">
        <div className="dot-matrix pointer-events-none absolute inset-y-0 left-0 w-2/5 opacity-70" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div>
            <span className="gradient-pill inline-flex items-center gap-1.5 px-3 py-1 text-tiny font-medium">
              <Sparkles size={12} strokeWidth={2} aria-hidden />
              報告已產生
            </span>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="text-display tabular-nums">{evaluation.overall_score}</span>
              <span className="text-body text-text-tertiary">/ 100</span>
            </p>
            <p className="mt-1 text-body-sm text-text-secondary">
              及格門檻 {RUBRIC_LIFE_CORE.pass_threshold} 分 · 目標{evaluation.goal_achieved ? '達成' : '未達成'}
            </p>

            <dl className="mt-5 space-y-3">
              <div>
                <dt className="meta-label text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]">做得好的地方</dt>
                <dd className="mt-1 text-body-sm text-text-secondary">{evaluation.key_strength}</dd>
              </div>
              <div>
                <dt className="meta-label text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]">最該改的一件事</dt>
                <dd className="mt-1 text-body-sm text-text-secondary">{evaluation.main_improvement}</dd>
              </div>
            </dl>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <section>
              <p className="meta-label">最強的維度</p>
              <div className="mt-3 space-y-3">
                {topSkills.map((skill) => (
                  <ScoreBar
                    key={String(skill.skill)}
                    compact
                    label={SKILL_LABEL[skill.skill as keyof typeof SKILL_LABEL] ?? titleize(String(skill.skill))}
                    score={skill.score}
                  />
                ))}
              </div>
            </section>
            <section>
              <p className="meta-label">需要加強</p>
              <div className="mt-3 space-y-3">
                {weakSkills.map((skill) => (
                  <ScoreBar
                    key={String(skill.skill)}
                    compact
                    label={SKILL_LABEL[skill.skill as keyof typeof SKILL_LABEL] ?? titleize(String(skill.skill))}
                    score={skill.score}
                    threshold={RUBRIC_LIFE_CORE.pass_threshold}
                  />
                ))}
              </div>
            </section>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <h2 className="text-card-title">課後教練回饋</h2>
          <ul className="mt-3 space-y-2.5">
            {MOCK_COACH_INSIGHTS.filter((insight) => insight.kind === 'post_session').map((insight) => (
              <li key={insight.id} className="border border-border-soft bg-glass-card rounded-card-sm p-4">
                <p className="text-body-sm font-medium">{insight.title}</p>
                <p className="mt-1 text-body-sm text-text-secondary">{insight.body}</p>
              </li>
            ))}
          </ul>
        </GlassCard>

        {/* §33 adaptive next step */}
        <GlassCard className="p-5">
          <h2 className="text-card-title">建議下一步</h2>
          <p className="mt-1 text-body-sm text-text-secondary">
            依你最弱的維度挑選：{DEMO_RECOMMENDATION.weak_skills.map((s) => SKILL_LABEL[s]).join('、')}。
          </p>

          <ul className="mt-4 space-y-2.5">
            {DEMO_RECOMMENDATION.next_scenario_id ? (
              <li className="border border-border-soft bg-glass-card flex items-center justify-between gap-3 rounded-card-sm p-4">
                <div className="min-w-0">
                  <p className="text-body-sm font-medium">
                    {scenarioById(DEMO_RECOMMENDATION.next_scenario_id)?.name ?? DEMO_RECOMMENDATION.next_scenario_id}
                  </p>
                  <p className="text-tiny text-text-tertiary">
                    建議難度：{DIFFICULTY_LABEL[DEMO_RECOMMENDATION.suggested_difficulty as keyof typeof DIFFICULTY_LABEL] ?? titleize(DEMO_RECOMMENDATION.suggested_difficulty)}
                  </p>
                </div>
                <Button variant="primary" size="sm" asChild>
                  <Link href={`/simulations/${DEMO_RECOMMENDATION.next_scenario_id}/setup`}>開始</Link>
                </Button>
              </li>
            ) : null}

            {DEMO_RECOMMENDATION.knowledge_material.map((material) => (
              <li key={material.document_id} className="border border-border-soft bg-glass-card rounded-card-sm p-4">
                <div className="flex items-start gap-2.5">
                  <BookOpen size={15} strokeWidth={1.8} aria-hidden className="mt-0.5 shrink-0 text-accent-blue" />
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium">
                      {documentById(material.document_id)?.filename ?? material.document_id}
                    </p>
                    <p className="text-tiny text-text-tertiary">{material.reason}</p>
                  </div>
                </div>
              </li>
            ))}

            {DEMO_RECOMMENDATION.question_set_ids.length > 0 ? (
              <li className="border border-border-soft bg-glass-card rounded-card-sm p-4">
                <p className="text-body-sm font-medium">練習題</p>
                <ul className="mt-1.5 space-y-1 text-body-sm text-text-secondary">
                  {DEMO_RECOMMENDATION.question_set_ids.map((questionId) => (
                    <li key={questionId}>
                      <Link href={`/questions/${questionId}/edit`} className="hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                        {questionById(questionId)?.title ?? questionId}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}
