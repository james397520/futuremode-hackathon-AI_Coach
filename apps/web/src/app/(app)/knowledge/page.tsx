import type { Metadata } from 'next';
import { Suspense } from 'react';
import { KnowledgeListPage } from '@/features/knowledge';

export const metadata: Metadata = { title: 'Knowledge Base' };

export default function Page() {
  // `useSearchParams` (the ?upload=1 deep link) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <KnowledgeListPage />
    </Suspense>
  );
}
