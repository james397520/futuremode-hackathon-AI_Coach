import type { Metadata } from 'next';
import { ChunkViewerPage } from '@/features/knowledge';

export const metadata: Metadata = { title: 'Chunk viewer' };

export default async function Page({ params }: { params: Promise<{ kbId: string }> }) {
  const { kbId } = await params;
  return <ChunkViewerPage kbId={kbId} />;
}
