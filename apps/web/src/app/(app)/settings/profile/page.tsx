import type { Metadata } from 'next';
import { ProfileSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: 'Profile' };

export default function Page() {
  return <ProfileSettingsPage />;
}
