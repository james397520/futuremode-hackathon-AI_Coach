'use client';

/** 情境示範選單：一鍵播放的完整示範情境。 */
import Link from 'next/link';
import { ArrowRight, Play } from 'lucide-react';
import { GlassCard, Pill } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { DEMO_CLARIFY, DEMO_COMPLIANCE } from './demo-scripts';

const SCRIPTS = [DEMO_CLARIFY, DEMO_COMPLIANCE];

export function DemoMenuPage() {
  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="情境示範"
        description="挑一個情境，一鍵播放完整對談。"
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
                  <span className="text-tiny font-medium text-text-tertiary">示範 {index + 1}</span>
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
                  開始播放
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
