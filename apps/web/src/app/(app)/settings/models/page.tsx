import type { Metadata } from 'next';
import { ModelSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: 'Model settings' };

export default function Page() {
  return <ModelSettingsPage />;
}
