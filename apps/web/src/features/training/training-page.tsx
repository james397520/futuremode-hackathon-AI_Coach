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
        title="Training"
        description="Assignments, deadlines and completion rules. Completion needs enough attempts, a passing score and no critical compliance risk."
        meta={overdue > 0 ? <Pill tone="danger" size="sm">{overdue} overdue</Pill> : null}
        actions={
          canAssign ? (
            <Button variant="primary" size="sm" onClick={() => setAssignOpen(true)}>
              <Plus size={15} strokeWidth={2} aria-hidden />
              Assign training
            </Button>
          ) : null
        }
      />

      <Tabs
        value={filter}
        onValueChange={(value: string) => setFilter(value as Filter)}
        items={[
          { value: 'all', label: 'All', count: MOCK_ASSIGNMENT_PROGRESS.length },
          { value: 'not_started', label: 'Not started' },
          { value: 'awaiting_retry', label: 'Retry required' },
          { value: 'overdue', label: 'Overdue' },
          { value: 'completed', label: 'Completed' },
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
                    {item.mandatory ? <Pill tone="warning" size="sm">Mandatory</Pill> : null}
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
                    <Link href={`/simulations/${item.scenario_id}/setup`} className="hover:text-accent-indigo">
                      {item.scenario_name}
                    </Link>
                  </h2>
                  <p className="mt-0.5 text-body-sm text-text-tertiary">Persona: {item.persona_name}</p>

                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-body-sm">
                    <div className="flex gap-2">
                      <dt className="text-text-tertiary">Deadline</dt>
                      <dd>
                        {item.deadline ? `${formatDate(item.deadline)} · ${formatRelative(item.deadline)}` : 'None'}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-text-tertiary">Attempts</dt>
                      <dd className="tabular-nums">
                        {item.attempts_used} / {item.max_attempts ?? '∞'}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-text-tertiary">Best score</dt>
                      <dd className="tabular-nums">
                        {item.best_score ?? '—'} / min {item.minimum_score}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="flex items-center gap-1.5 text-text-tertiary">
                        <Users size={13} strokeWidth={1.8} aria-hidden />
                        Assignees
                      </dt>
                      <dd className="tabular-nums">{item.assignee_count}</dd>
                    </div>
                    {item.blocking_skill ? (
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">Blocking skill</dt>
                        <dd>{SKILL_LABEL[item.blocking_skill]}</dd>
                      </div>
                    ) : null}
                    {item.critical_findings > 0 ? (
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">Compliance</dt>
                        <dd className="text-state-danger">
                          {item.critical_findings} finding{item.critical_findings === 1 ? '' : 's'} blocking completion
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <ProgressBar
                    className="mt-3 max-w-md"
                    value={Math.round(item.completion_rate * 100)}
                    label={`Cohort completion ${Math.round(item.completion_rate * 100)}%`}
                  />
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Button variant="primary" size="sm" asChild>
                    <Link href={`/simulations/${item.scenario_id}/setup`}>
                      {item.status === 'completed' ? 'Practise again' : 'Start'}
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/performance">View my progress</Link>
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
      title="Assign training"
      description="Assignees, deadline, attempts, minimum score, prerequisite and mode."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm">Create assignment</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Scenario">
          <Select
            value={scenarioId}
            onValueChange={setScenarioId}
            options={MOCK_SCENARIOS.filter((scenario) => scenario.status === 'published').map((scenario) => ({
              value: scenario.id,
              label: `${scenario.name} (v${scenario.version})`,
            }))}
          />
        </Field>

        <Field label="Team" hint="Individual users can be added after the assignment is created.">
          <Select
            value={teamId}
            onValueChange={setTeamId}
            options={MOCK_TEAMS.map((team) => ({ value: team.id, label: `${team.name} · ${team.department ?? ''}` }))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deadline">
            <div className="flex items-center gap-2">
              <CalendarClock size={15} strokeWidth={1.8} aria-hidden className="shrink-0 text-text-tertiary" />
              <Input type="date" defaultValue="2026-03-31" />
            </div>
          </Field>
          <Field label="Max attempts">
            <Input type="number" min={1} defaultValue={3} />
          </Field>
          <Field label="Minimum score">
            <Input type="number" min={0} max={100} defaultValue={80} />
          </Field>
          <Field label="Mode">
            <Select
              value={mode}
              onValueChange={(value: string) => setMode(value as typeof mode)}
              options={[
                { value: 'training', label: 'Training' },
                { value: 'assessment', label: 'Assessment' },
              ]}
            />
          </Field>
        </div>

        <Switch checked={mandatory} onCheckedChange={setMandatory} label="Mandatory" />

        <Field label="Prerequisite" hint="Blocks the assignment until the prerequisite is completed.">
          <Select
            value=""
            onValueChange={() => undefined}
            options={[
              { value: '', label: 'None' },
              ...MOCK_ASSIGNMENT_PROGRESS.map((item) => ({
                value: item.assignment_id,
                label: item.scenario_name,
              })),
            ]}
          />
        </Field>

        <p className="rounded-card-sm border border-border-soft px-3.5 py-3 text-body-sm text-text-secondary">
          Completion condition: attempts ≥ 2, score ≥ minimum, and no critical compliance finding.
          {' '}
          {MOCK_USERS.length} users are available in this workspace.
        </p>
      </div>
    </Modal>
  );
}
