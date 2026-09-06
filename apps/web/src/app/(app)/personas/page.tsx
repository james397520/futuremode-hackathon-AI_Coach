import type { Metadata } from 'next';
import { PersonasListPage } from '@/features/personas';

export const metadata: Metadata = { title: '模擬人物' };

export default function Page() {
  return <PersonasListPage />;
}
