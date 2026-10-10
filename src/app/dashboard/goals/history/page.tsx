import { redirect } from 'next/navigation';

export default function GoalsHistoryRedirect() {
  redirect('/dashboard/goals/analysis?tab=closures');
}
