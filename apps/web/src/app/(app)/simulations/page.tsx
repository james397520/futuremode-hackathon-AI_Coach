import type { Metadata } from 'next';
import { SimulationLibraryPage } from '@/features/simulations';

export const metadata: Metadata = { title: 'Simulations' };

export default function Page() {
  return <SimulationLibraryPage />;
}
