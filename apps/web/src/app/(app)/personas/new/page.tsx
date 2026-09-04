import type { Metadata } from 'next';
import { PersonaBuilderPage } from '@/features/personas';

export const metadata: Metadata = { title: 'New persona' };

export default function Page() {
  return <PersonaBuilderPage />;
}
