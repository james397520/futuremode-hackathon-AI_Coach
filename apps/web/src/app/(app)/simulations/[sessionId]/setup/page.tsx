import type { Metadata } from 'next';
import { SimulationSetupPage } from '@/features/simulations';

export const metadata: Metadata = { title: '模擬設定' };

/**
 * NOTE on the slug name: App Router requires every route at the same position to
 * use the *same* dynamic segment name, so `[sessionId]` is shared by setup, live,
 * voice, review and complete. On this page the value is a **scenario id** — the
 * session does not exist until the trainee presses start.
 */
export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <SimulationSetupPage scenarioId={sessionId} />;
}
