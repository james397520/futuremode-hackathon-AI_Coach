import { LiveSimulationPage } from '@/features/simulation';

/**
 * Thin route file by contract: the live session experience is owned by
 * `src/features/simulation` (a different agent). This file must not grow.
 */
export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <LiveSimulationPage sessionId={sessionId} />;
}
