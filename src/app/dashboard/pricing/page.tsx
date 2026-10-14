import { redirect } from 'next/navigation';

export default function PricingIndexRedirect() {
  redirect('/dashboard/pricing/cost-analysis');
}
