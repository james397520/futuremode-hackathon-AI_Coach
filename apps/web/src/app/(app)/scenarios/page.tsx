import type { Metadata } from 'next';
import { ScenariosListPage } from '@/features/scenarios';

export const metadata: Metadata = { title: '訓練情境' };

export default function Page() {
  return <ScenariosListPage />;
}
