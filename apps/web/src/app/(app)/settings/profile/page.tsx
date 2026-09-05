import type { Metadata } from 'next';
import { ProfileSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: '個人資料' };

export default function Page() {
  return <ProfileSettingsPage />;
}
