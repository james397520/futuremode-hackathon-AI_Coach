'use client';

import { useRouter } from 'next/navigation';
import { Tabs } from '@/components/ui';

/** Shared sub-navigation across the three report types (§47 Part I). */
export function ReportTabs({ current }: { current: 'team' | 'skill' | 'compliance' }) {
  const router = useRouter();
  return (
    <Tabs
      value={current}
      onValueChange={(value: string) => router.push(`/reports/${value}`)}
      items={[
        { value: 'team', label: 'Team' },
        { value: 'skill', label: 'Skill' },
        { value: 'compliance', label: 'Compliance' },
      ]}
    />
  );
}
