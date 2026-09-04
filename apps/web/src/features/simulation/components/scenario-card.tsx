'use client';

/**
 * Scenario floating card — spec §21 (modelled on the reference "Notes" card).
 *
 *   Scenario
 *   [Insurance] [Hard] [Compliance]
 *   Objective
 *   • 探索家庭保障需求
 *   • 正確說明商品價值
 *   • 不可承諾固定報酬
 */
import type { Difficulty, SessionMode } from '@ai-coach/shared';

import { DIFFICULTY_LABEL, DIFFICULTY_TONE } from '../lib/labels';
import { Bullet, CardTitle, InsetBlock, TonePill } from './atoms';
import { TargetIcon } from './icons';
import { cn, GlassCard } from './kit';

export interface ScenarioCardProps {
  scenarioName: string;
  category?: string;
  industry?: string;
  trainingType?: string;
  difficulty: Difficulty;
  mode: SessionMode;
  learningObjectives: string[];
  restrictedTopics?: string[];
  className?: string;
}

export function ScenarioCard({
  scenarioName,
  category,
  industry,
  trainingType,
  difficulty,
  mode,
  learningObjectives,
  restrictedTopics,
  className,
}: ScenarioCardProps) {
  const tags = [category ?? industry, DIFFICULTY_LABEL[difficulty], trainingType].filter(
    (value): value is string => Boolean(value),
  );

  return (
    <GlassCard className={cn('sim-float-in sim-lift p-5', className)}>
      <CardTitle eyebrow="Scenario">{scenarioName}</CardTitle>

      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((tag, index) => (
          <TonePill
            key={`${tag}-${index}`}
            tone={index === 1 ? DIFFICULTY_TONE[difficulty] : index === 0 ? 'blue' : 'cyan'}
            fill={15}
          >
            {tag}
          </TonePill>
        ))}
        {mode === 'assessment' ? (
          <TonePill tone="indigo" fill={16}>
            Assessment
          </TonePill>
        ) : null}
      </div>

      <InsetBlock tone="blue" fill={9} className="mt-4">
        <div className="flex items-center gap-1.5 text-tiny uppercase tracking-[0.08em] text-text-tertiary">
          <TargetIcon size={12} />
          Objective
        </div>
        <ul className="mt-2 grid gap-1.5">
          {learningObjectives.length === 0 ? (
            <li className="text-body-sm text-text-tertiary">No objectives were set for this scenario.</li>
          ) : (
            learningObjectives.map((objective) => <Bullet key={objective}>{objective}</Bullet>)
          )}
        </ul>
      </InsetBlock>

      {restrictedTopics && restrictedTopics.length > 0 ? (
        <InsetBlock tone="warning" fill={8} className="mt-3">
          <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">Do not say</div>
          <ul className="mt-2 grid gap-1.5">
            {restrictedTopics.map((topic) => (
              <Bullet key={topic} tone="warning">
                {topic}
              </Bullet>
            ))}
          </ul>
        </InsetBlock>
      ) : null}
    </GlassCard>
  );
}
