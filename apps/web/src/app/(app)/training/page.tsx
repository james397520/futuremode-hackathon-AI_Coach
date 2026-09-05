import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TrainingPage } from '@/features/training';

export const metadata: Metadata = { title: 'Training' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TrainingPage />
    </Suspense>
  );
}
