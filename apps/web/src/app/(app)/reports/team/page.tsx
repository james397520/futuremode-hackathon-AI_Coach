import type { Metadata } from 'next';
import { TeamReportPage } from '@/features/reports';

export const metadata: Metadata = { title: '團隊報表' };

export default function Page() {
  return <TeamReportPage />;
}
