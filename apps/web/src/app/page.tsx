import { redirect } from 'next/navigation';

/** §12 — `/` is not a page; the shell starts at the dashboard. */
export default function RootPage() {
  redirect('/dashboard');
}
