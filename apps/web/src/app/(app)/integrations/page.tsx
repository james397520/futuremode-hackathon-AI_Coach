import type { Metadata } from 'next';
import { IntegrationsPage } from '@/features/integrations';

export const metadata: Metadata = { title: '整合服務' };

export default function Page() {
  return <IntegrationsPage />;
}
