'use client';

/** 展示模式選單：兩個寫死的對話流程，各自可直接進入螢幕錄影。 */
import Link from 'next/link';
import { ArrowRight, Play } from 'lucide-react';
import { GlassCard, Pill } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { DEMO_CLARIFY, DEMO_REDIRECT } from './demo-scripts';

const SCRIPTS = [DEMO_CLARIFY, DEMO_REDIRECT];

export function DemoMenuPage() {
  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="展示模式"
        description="兩個寫死的對話流程，點進去照提詞送出即可，客戶會照劇本回覆。適合直接螢幕錄影。"
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {SCRIPTS.map((script, index) => (
          <li key={script.slug}>
            <Link href={`/demo/${script.slug}`} className="block h-full">
              <GlassCard className="flex h-full flex-col p-5 transition-transform hover:-translate-y-0.5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent-indigo/12 text-accent-indigo">
                    <Play size={15} strokeWidth={2} aria-hidden />
                  </span>
                  <span className="text-tiny font-medium text-text-tertiary">流程 {index + 1}</span>
                </div>
                <h2 className="text-card-title">{script.scenarioTitle}</h2>
                <p className="mt-1.5 text-body-sm text-text-secondary">客戶：{script.personaName}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {script.capabilities.map((cap) => (
                    <Pill key={cap} tone="neutral" size="sm">
                      {cap}
                    </Pill>
                  ))}
                </div>
                <span className="mt-4 inline-flex items-center gap-1 text-body-sm font-medium text-accent-indigo">
                  進入示範
                  <ArrowRight size={14} strokeWidth={2} aria-hidden />
                </span>
              </GlassCard>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
