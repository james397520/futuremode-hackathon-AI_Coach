import type { Metadata } from 'next';
import { ChunkViewerPage } from '@/features/knowledge';

export const metadata: Metadata = { title: '切片檢視' };

export default async function Page({ params }: { params: Promise<{ kbId: string }> }) {
  const { kbId } = await params;
  return <ChunkViewerPage kbId={kbId} />;
}
