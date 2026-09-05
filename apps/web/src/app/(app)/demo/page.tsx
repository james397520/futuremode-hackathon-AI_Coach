import type { Metadata } from 'next';
import { DemoMenuPage } from '@/features/demo';

export const metadata: Metadata = { title: '展示模式' };

export default function Page() {
  return <DemoMenuPage />;
}
