import type { Metadata } from 'next';
import { SessionReviewPage } from '@/features/simulations';

export const metadata: Metadata = { title: '練習成果回顧' };

export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SessionReviewPage sessionId={sessionId} />;
}
