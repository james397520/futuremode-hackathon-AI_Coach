'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button, GlassCard, Pill } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DifficultyPill, ModePill } from '@/components/status';
import { MOCK_SCENARIOS } from '@/lib/fixtures/scenarios';
import { personaById } from '@/lib/fixtures/personas';
import { SCENARIO_MASTERY } from '@/lib/fixtures/reports';
import { useCan } from '@/lib/auth-context';
import { formatRelative } from '@/lib/utils';

/** §58-13 Scenarios. */
export function ScenariosListPage() {
  const canEdit = useCan('scenario.manage');

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="情境"
        description="一個情境會把客戶角色、知識庫、評分規準與合規政策綁成一份可重現的練習。"
        actions={
          canEdit ? (
            <Button variant="primary" size="sm" asChild>
              <Link href="/scenarios/new/builder">
                <Plus size={15} strokeWidth={2} aria-hidden />
                新增情境
              </Link>
            </Button>
          ) : null
        }
      />

      <ul className="space-y-3">
        {MOCK_SCENARIOS.map((scenario) => {
          const persona = personaById(scenario.persona_id);
          const mastery = SCENARIO_MASTERY.find((entry) => entry.scenario_id === scenario.id);

          return (
            <li key={scenario.id}>
              <GlassCard className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <ContentStatusPill status={scenario.status} />
                      <DifficultyPill difficulty={scenario.difficulty} />
                      <ModePill mode={scenario.mode} />
                      <Pill tone="neutral" size="sm">v{scenario.version}</Pill>
                    </div>
                    <h2 className="text-card-title">{scenario.name}</h2>
                    <p className="mt-1 max-w-3xl text-body-sm text-text-secondary">{scenario.description}</p>

                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-body-sm">
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">客戶角色</dt>
                        <dd>{persona?.name ?? scenario.persona_id}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">知識庫</dt>
                        <dd>{scenario.knowledge_base_ids.length} 個</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">評分規準</dt>
                        <dd>{scenario.rubric_id ?? '尚未設定'}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">更新於</dt>
                        <dd>{formatRelative(scenario.updated_at)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {mastery ? (
                      <p className="text-right text-tiny text-text-tertiary">
                        {mastery.attempts} 次練習
                        <br />
                        通過率 {Math.round(mastery.pass_rate * 100)}% · 平均 {mastery.average_score} 分
                      </p>
                    ) : (
                      <p className="text-tiny text-text-tertiary">尚無練習紀錄</p>
                    )}
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/simulations/${scenario.id}/setup`}>預覽</Link>
                      </Button>
                      {canEdit ? (
                        <Button variant="secondary" size="sm" asChild>
                          <Link href={`/scenarios/${scenario.id}/builder`}>開啟編輯器</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </GlassCard>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
