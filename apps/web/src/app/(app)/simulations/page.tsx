import type { Metadata } from 'next';
import { SimulationLibraryPage } from '@/features/simulations';

export const metadata: Metadata = { title: '模擬練習' };

export default function Page() {
  return <SimulationLibraryPage />;
}
