import type { Metadata } from 'next';
import { PerformancePage } from '@/features/performance';

export const metadata: Metadata = { title: 'Individual report' };

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <PerformancePage userId={userId} />;
}
