"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DPIndexPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/dp/schedules'); }, [router]);
  return null;
}
