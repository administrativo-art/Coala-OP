"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DPSettingsUnitsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/settings?department=operacional&tab=units");
  }, [router]);
  return null;
}
