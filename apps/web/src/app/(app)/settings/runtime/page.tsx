import type { Metadata } from 'next';
import { RuntimeSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: 'AI 執行環境' };

export default function Page() {
  return <RuntimeSettingsPage />;
}
