import type { Metadata } from 'next';
import { PerformancePage } from '@/features/performance';

export const metadata: Metadata = { title: 'Performance Review' };

export default function Page() {
  return <PerformancePage />;
}
