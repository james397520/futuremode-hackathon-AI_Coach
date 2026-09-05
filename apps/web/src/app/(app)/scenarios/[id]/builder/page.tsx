import type { Metadata } from 'next';
import { ScenarioBuilderPage } from '@/features/scenarios';

export const metadata: Metadata = { title: '情境編輯器' };

/** `/scenarios/new/builder` creates a scenario; any other id edits one. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScenarioBuilderPage scenarioId={id} />;
}
