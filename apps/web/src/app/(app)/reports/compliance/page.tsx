import type { Metadata } from 'next';
import { ComplianceReportPage } from '@/features/reports';

export const metadata: Metadata = { title: 'Compliance report' };

export default function Page() {
  return <ComplianceReportPage />;
}
