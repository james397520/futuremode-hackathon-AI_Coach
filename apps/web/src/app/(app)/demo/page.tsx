import type { Metadata } from 'next';
import { DemoMenuPage } from '@/features/demo';

export const metadata: Metadata = { title: '情境示範' };

export default function Page() {
  return <DemoMenuPage />;
}
