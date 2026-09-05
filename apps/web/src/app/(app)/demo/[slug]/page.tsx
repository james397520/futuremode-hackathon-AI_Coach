import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DemoPlayerPage, DEMO_SCRIPTS } from '@/features/demo';

export const metadata: Metadata = { title: '情境示範' };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const script = DEMO_SCRIPTS[slug];
  if (!script) notFound();
  return <DemoPlayerPage script={script} />;
}
