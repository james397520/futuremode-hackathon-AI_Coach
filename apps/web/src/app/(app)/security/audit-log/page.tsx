import type { Metadata } from 'next';
import { AuditLogPage } from '@/features/security';

export const metadata: Metadata = { title: '稽核紀錄' };

export default function Page() {
  return <AuditLogPage />;
}
