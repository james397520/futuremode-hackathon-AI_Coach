import type { Metadata } from 'next';
import { ScenariosListPage } from '@/features/scenarios';

export const metadata: Metadata = { title: 'Scenarios' };

export default function Page() {
  return <ScenariosListPage />;
}
