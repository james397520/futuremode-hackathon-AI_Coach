import type { Metadata } from 'next';
import { DocumentDetailPage } from '@/features/knowledge';

export const metadata: Metadata = { title: 'Document' };

export default async function Page({
  params,
}: {
  params: Promise<{ kbId: string; docId: string }>;
}) {
  const { kbId, docId } = await params;
  return <DocumentDetailPage kbId={kbId} docId={docId} />;
}
