import type { Metadata } from 'next';
import { AuditLogPage } from '@/features/security';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return <AuditLogPage />;
}
