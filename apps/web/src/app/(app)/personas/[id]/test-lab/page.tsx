import type { Metadata } from 'next';
import { PersonaTestLabPage } from '@/features/personas';

export const metadata: Metadata = { title: '模擬人物測試室' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonaTestLabPage personaId={id} />;
}
