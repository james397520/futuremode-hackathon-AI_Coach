import type { Metadata } from 'next';
import { QuestionGeneratorPage } from '@/features/questions';

export const metadata: Metadata = { title: 'AI 出題' };

export default function Page() {
  return <QuestionGeneratorPage />;
}
