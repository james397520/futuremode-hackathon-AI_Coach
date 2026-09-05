import type { Metadata } from 'next';
import { PersonaBuilderPage } from '@/features/personas';

export const metadata: Metadata = { title: '新增模擬人物' };

export default function Page() {
  return <PersonaBuilderPage />;
}
