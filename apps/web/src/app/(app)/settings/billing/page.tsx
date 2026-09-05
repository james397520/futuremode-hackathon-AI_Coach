import type { Metadata } from 'next';
import { BillingSettingsPage } from '@/features/settings';

export const metadata: Metadata = { title: 'Billing & usage' };

export default function Page() {
  return <BillingSettingsPage />;
}
