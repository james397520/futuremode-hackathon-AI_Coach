import type { Metadata } from 'next';
import { QuestionGeneratorPage } from '@/features/questions';

export const metadata: Metadata = { title: 'Generate questions' };

export default function Page() {
  return <QuestionGeneratorPage />;
}
