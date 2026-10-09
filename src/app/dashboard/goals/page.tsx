import { redirect } from 'next/navigation';

export default function GoalsIndexRedirect() {
  redirect('/dashboard/goals/tracking');
}
