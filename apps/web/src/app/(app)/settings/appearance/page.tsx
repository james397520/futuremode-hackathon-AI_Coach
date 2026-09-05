import type { Metadata } from 'next';
import { AppearanceSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: 'Appearance' };

export default function Page() {
  return <AppearanceSettingsPage />;
}
