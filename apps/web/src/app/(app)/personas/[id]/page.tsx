import type { Metadata } from 'next';
import { PersonaBuilderPage } from '@/features/personas';

export const metadata: Metadata = { title: 'Persona builder' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonaBuilderPage personaId={id} />;
}
