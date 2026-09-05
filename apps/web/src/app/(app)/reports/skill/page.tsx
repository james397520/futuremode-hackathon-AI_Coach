import type { Metadata } from 'next';
import { SkillReportPage } from '@/features/reports';

export const metadata: Metadata = { title: '技能報表' };

export default function Page() {
  return <SkillReportPage />;
}
