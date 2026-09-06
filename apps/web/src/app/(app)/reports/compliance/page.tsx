import type { Metadata } from 'next';
import { ComplianceReportPage } from '@/features/reports';

export const metadata: Metadata = { title: '合規報表' };

export default function Page() {
  return <ComplianceReportPage />;
}
