import { redirect } from 'next/navigation';

/** `/reports` has no page of its own — the team report is the default view. */
export default function Page() {
  redirect('/reports/team');
}
