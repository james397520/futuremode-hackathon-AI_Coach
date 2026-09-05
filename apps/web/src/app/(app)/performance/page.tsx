import type { Metadata } from 'next';
import { PerformancePage } from '@/features/performance';

export const metadata: Metadata = { title: '成效回顧' };

export default function Page() {
  return <PerformancePage />;
}
