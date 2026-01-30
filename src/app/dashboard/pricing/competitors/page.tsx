"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page has been removed and its functionality was moved to /dashboard/pricing/price-comparison.
export default function ObsoleteCompetitorsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/pricing/price-comparison');
  }, [router]);

  return null;
}
