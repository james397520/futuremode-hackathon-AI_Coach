import type { Metadata } from 'next';
import { SessionCompletePage } from '@/features/simulations';

export const metadata: Metadata = { title: 'Session complete' };

export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SessionCompletePage sessionId={sessionId} />;
}
