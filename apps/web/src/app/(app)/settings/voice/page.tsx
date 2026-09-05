import type { Metadata } from 'next';
import { VoiceSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: 'Voice settings' };

export default function Page() {
  return <VoiceSettingsPage />;
}
