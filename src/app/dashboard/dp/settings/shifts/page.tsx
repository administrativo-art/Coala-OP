"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DPSettingsShiftsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/settings?department=pessoal&tab=shifts");
  }, [router]);
  return null;
}
