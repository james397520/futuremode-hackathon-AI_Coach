import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QuestionBankPage } from '@/features/questions';

export const metadata: Metadata = { title: '題庫' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <QuestionBankPage />
    </Suspense>
  );
}
