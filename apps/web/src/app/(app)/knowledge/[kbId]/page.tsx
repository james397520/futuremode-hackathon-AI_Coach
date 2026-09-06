import type { Metadata } from 'next';
import { KnowledgeDetailPage } from '@/features/knowledge';

export const metadata: Metadata = { title: '知識庫' };

export default async function Page({ params }: { params: Promise<{ kbId: string }> }) {
  const { kbId } = await params;
  return <KnowledgeDetailPage kbId={kbId} />;
}
