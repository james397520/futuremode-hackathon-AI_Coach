import type { Metadata } from 'next';
import { SecurityPage } from '@/features/security';

export const metadata: Metadata = { title: 'Security & Audit' };

export default function Page() {
  return <SecurityPage />;
}
