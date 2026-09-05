'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, Users } from 'lucide-react';
import { Button, Field, GlassCard, Input, Modal, Pill, ProgressBar, Select, Switch, Tabs } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { DifficultyPill, ModePill } from '@/components/status';
import {
  ASSIGNMENT_STATUS_LABEL,
  MOCK_ASSIGNMENT_PROGRESS,
  type AssignmentProgressStatus,
} from '@/lib/fixtures/training';
import { MOCK_SCENARIOS } from '@/lib/fixtures/scenarios';
import { MOCK_TEAMS, MOCK_USERS } from '@/lib/fixtures/identity';
import { SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { useCan } from '@/lib/auth-context';
import { formatDate, formatRelative } from '@/lib/utils';

type Filter = 'all' | AssignmentProgressStatus;

/** §36 Part I Training Assignment — the assignment list plus the assign dialog. */
export function TrainingPage() {
  const canAssign = useCan('training.assign');
  const searchParams = useSearchParams();
  const [assignOpen, setAssignOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (searchParams.get('assign') === '1') setAssignOpen(true);
  }, [searchParams]);

  const rows = useMemo(
    () => MOCK_ASSIGNMENT_PROGRESS.filter((item) => (filter === 'all' ? true : item.status === filter)),
    [filter],
  );

  const overdue = MOCK_ASSIGNMENT_PROGRESS.filter((item) => item.status === 'overdue').length;

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="我的訓練"
        description="查看指派項目、期限與完成條件。完成需達到足夠練習次數、及格分數，且不得有重大合規風險。"
        meta={overdue > 0 ? <Pill tone="danger" size="sm">{overdue} 項逾期</Pill> : null}
        actions={
          canAssign ? (
            <Button variant="primary" size="sm" onClick={() => setAssignOpen(true)}>
              <Plus size={15} strokeWidth={2} aria-hidden />
              指派訓練
            </Button>
          ) : null
        }
      />

      <Tabs
        value={filter}
        onValueChange={(value: string) => setFilter(value as Filter)}
        items={[
          { value: 'all', label: '全部', count: MOCK_ASSIGNMENT_PROGRESS.length },
          { value: 'not_started', label: '尚未開始' },
          { value: 'awaiting_retry', label: '需要重試' },
          { value: 'overdue', label: '已逾期' },
          { value: 'completed', label: '已完成' },
        ]}
      />

      <ul className="space-y-3">
        {rows.map((item) => (
          <li key={item.assignment_id}>
            <GlassCard className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <DifficultyPill difficulty={item.difficulty} />
                    <ModePill mode={item.mode} />
                    {item.mandatory ? <Pill tone="warning" size="sm">必修</Pill> : null}
                    <Pill
                      tone={
                        item.status === 'completed'
                          ? 'success'
                          : item.status === 'overdue'
                            ? 'danger'
                            : item.status === 'awaiting_retry'
                              ? 'warning'
                              : 'neutral'
                      }
                      size="sm"
                    >
                      {ASSIGNMENT_STATUS_LABEL[item.status]}
                    </Pill>
                  </div>

                  <h2 className="text-card-title">
                    <Link href={`/simulations/${item.scenario_id}/setup`} className="hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                      {item.scenario_name}
                    </Link>
                  </h2>
                  <p className="mt-0.5 text-body-sm text-text-tertiary">模擬人物：{item.persona_name}</p>

                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-body-sm">
                    <div className="flex gap-2">
                      <dt className="text-text-tertiary">期限</dt>
                      <dd>
                        {item.deadline ? `${formatDate(item.deadline)} · ${formatRelative(item.deadline)}` : '未設定'}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-text-tertiary">嘗試次數</dt>
                      <dd className="tabular-nums">
                        {item.attempts_used} / {item.max_attempts ?? '∞'}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-text-tertiary">最佳分數</dt>
                      <dd className="tabular-nums">
                        {item.best_score ?? '—'} / 最低 {item.minimum_score}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="flex items-center gap-1.5 text-text-tertiary">
                        <Users size={13} strokeWidth={1.8} aria-hidden />
                        指派對象
                      </dt>
                      <dd className="tabular-nums">{item.assignee_count}</dd>
                    </div>
                    {item.blocking_skill ? (
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">待補強能力</dt>
                        <dd>{SKILL_LABEL[item.blocking_skill]}</dd>
                      </div>
                    ) : null}
                    {item.critical_findings > 0 ? (
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">合規</dt>
                        <dd className="font-medium text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]">
                          {item.critical_findings} 項發現阻礙完成
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <ProgressBar
                    className="mt-3 max-w-md"
                    value={Math.round(item.completion_rate * 100)}
                    label="整體完成率"
                  />
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Button variant="primary" size="sm" asChild>
                    <Link href={`/simulations/${item.scenario_id}/setup`}>
                      {item.status === 'completed' ? '再次練習' : '開始'}
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/performance">查看我的進度</Link>
                  </Button>
                </div>
              </div>
            </GlassCard>
          </li>
        ))}
      </ul>

      <AssignModal open={assignOpen} onOpenChange={setAssignOpen} />
    </div>
  );
}

function AssignModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [scenarioId, setScenarioId] = useState(MOCK_SCENARIOS[0]?.id ?? '');
  const [teamId, setTeamId] = useState(MOCK_TEAMS[0]?.id ?? '');
  const [mandatory, setMandatory] = useState(true);
  const [mode, setMode] = useState<'training' | 'assessment'>('training');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="指派訓練"
      description="設定對象、期限、可嘗試次數、最低分數、先修條件與模式。"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" size="sm">建立指派</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="訓練情境">
          <Select
            value={scenarioId}
            onValueChange={setScenarioId}
            options={MOCK_SCENARIOS.filter((scenario) => scenario.status === 'published').map((scenario) => ({
              value: scenario.id,
              label: `${scenario.name} (v${scenario.version})`,
            }))}
          />
        </Field>

        <Field label="團隊" hint="建立後可再加入個別使用者。">
          <Select
            value={teamId}
            onValueChange={setTeamId}
            options={MOCK_TEAMS.map((team) => ({ value: team.id, label: `${team.name} · ${team.department ?? ''}` }))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="期限">
            <div className="flex items-center gap-2">
              <CalendarClock size={15} strokeWidth={1.8} aria-hidden className="shrink-0 text-text-tertiary" />
              <Input type="date" defaultValue="2026-03-31" />
            </div>
          </Field>
          <Field label="最多嘗試次數">
            <Input type="number" min={1} defaultValue={3} />
          </Field>
          <Field label="最低分數">
            <Input type="number" min={0} max={100} defaultValue={80} />
          </Field>
          <Field label="模式">
            <Select
              value={mode}
              onValueChange={(value: string) => setMode(value as typeof mode)}
              options={[
                { value: 'training', label: '訓練' },
                { value: 'assessment', label: '評測' },
              ]}
            />
          </Field>
        </div>

        <Switch checked={mandatory} onCheckedChange={setMandatory} label="必修" />

        <Field label="先修條件" hint="完成先修項目後才能開始此訓練。">
          <Select
            value=""
            onValueChange={() => undefined}
            options={[
              { value: '', label: '無' },
              ...MOCK_ASSIGNMENT_PROGRESS.map((item) => ({
                value: item.assignment_id,
                label: item.scenario_name,
              })),
            ]}
          />
        </Field>

        <p className="rounded-card-sm border border-border-soft px-3.5 py-3 text-body-sm text-text-secondary">
          完成條件：嘗試次數 ≥ 2、分數達最低標準，且沒有重大合規發現。
          {' '}
          此工作區共有 {MOCK_USERS.length} 位可指派使用者。
        </p>
      </div>
    </Modal>
  );
}
