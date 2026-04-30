"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DPSettingsCalendarsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/settings?department=pessoal&tab=calendars");
  }, [router]);
  return null;
}
