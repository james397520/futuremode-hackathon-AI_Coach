import { redirect } from 'next/navigation';

/** `/` begins with selecting an authorised work identity. */
export default function RootPage() {
  redirect('/role-select');
}
