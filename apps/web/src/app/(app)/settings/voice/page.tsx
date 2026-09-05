import type { Metadata } from 'next';
import { VoiceSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: '語音設定' };

export default function Page() {
  return <VoiceSettingsPage />;
}
