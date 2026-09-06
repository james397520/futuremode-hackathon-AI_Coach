import type { Metadata } from 'next';
import { AppearanceSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: '外觀' };

export default function Page() {
  return <AppearanceSettingsPage />;
}
