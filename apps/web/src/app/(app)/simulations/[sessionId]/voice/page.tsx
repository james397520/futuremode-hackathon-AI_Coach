import { VoiceSimulationPage } from '@/features/simulation';

/** Thin route file by contract — see the /live route. */
export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <VoiceSimulationPage sessionId={sessionId} />;
}
