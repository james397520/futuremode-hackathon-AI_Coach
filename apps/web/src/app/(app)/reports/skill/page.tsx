import type { Metadata } from 'next';
import { SkillReportPage } from '@/features/reports';

export const metadata: Metadata = { title: 'Skill report' };

export default function Page() {
  return <SkillReportPage />;
}
