import type { Metadata } from 'next';
import { SettingsOverviewPage } from '@/features/settings';

export const metadata: Metadata = { title: '設定' };

export default function Page() {
  return <SettingsOverviewPage />;
}
