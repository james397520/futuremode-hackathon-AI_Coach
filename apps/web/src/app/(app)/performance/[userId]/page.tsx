import type { Metadata } from 'next';
import { PerformancePage } from '@/features/performance';

export const metadata: Metadata = { title: '個人成效報告' };

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <PerformancePage userId={userId} />;
}
