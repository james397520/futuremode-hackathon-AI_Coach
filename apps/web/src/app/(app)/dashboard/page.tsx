import type { Metadata } from 'next';
import { DashboardPage } from '@/features/dashboard';

export const metadata: Metadata = { title: '首頁' };

export default function Page() {
  return <DashboardPage />;
}
