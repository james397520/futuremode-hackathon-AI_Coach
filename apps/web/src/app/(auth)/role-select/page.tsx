import type { Metadata } from 'next';
import { RoleSelectPage } from '@/features/auth';

export const metadata: Metadata = { title: '選擇工作身份' };

export default function Page() {
  return <RoleSelectPage />;
}
