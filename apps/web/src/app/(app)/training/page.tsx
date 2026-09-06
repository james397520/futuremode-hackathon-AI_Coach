import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TrainingPage } from '@/features/training';

export const metadata: Metadata = { title: '我的訓練' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <TrainingPage />
    </Suspense>
  );
}
