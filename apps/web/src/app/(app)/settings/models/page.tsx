import type { Metadata } from 'next';
import { ModelSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: '模型設定' };

export default function Page() {
  return <ModelSettingsPage />;
}
