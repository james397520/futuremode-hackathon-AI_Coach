import type { Metadata } from 'next';
import { QuestionEditorPage } from '@/features/questions';

export const metadata: Metadata = { title: 'Question editor' };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ review?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <QuestionEditorPage questionId={id} reviewMode={query.review === '1'} />;
}
