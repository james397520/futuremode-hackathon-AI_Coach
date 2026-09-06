import type { Metadata } from 'next';
import { SecurityPage } from '@/features/security';

export const metadata: Metadata = { title: '安全與稽核' };

export default function Page() {
  return <SecurityPage />;
}
