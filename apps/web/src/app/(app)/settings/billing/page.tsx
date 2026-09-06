import type { Metadata } from 'next';
import { BillingSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: '帳務與用量' };

export default function Page() {
  return <BillingSettingsPage />;
}
