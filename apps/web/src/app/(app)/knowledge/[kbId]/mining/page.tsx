import type { Metadata } from 'next';
import { MiningReviewPage } from '@/features/knowledge';

export const metadata: Metadata = { title: '知識探勘' };

export default async function Page({ params }: { params: Promise<{ kbId: string }> }) {
  const { kbId } = await params;
  return <MiningReviewPage kbId={kbId} />;
}
