import type { Metadata } from 'next';
import { RetrievalPlaygroundPage } from '@/features/knowledge';

export const metadata: Metadata = { title: 'Retrieval playground' };

export default async function Page({ params }: { params: Promise<{ kbId: string }> }) {
  const { kbId } = await params;
  return <RetrievalPlaygroundPage kbId={kbId} />;
}
