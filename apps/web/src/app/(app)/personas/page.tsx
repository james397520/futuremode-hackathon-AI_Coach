import type { Metadata } from 'next';
import { PersonasListPage } from '@/features/personas';

export const metadata: Metadata = { title: 'Personas' };

export default function Page() {
  return <PersonasListPage />;
}
