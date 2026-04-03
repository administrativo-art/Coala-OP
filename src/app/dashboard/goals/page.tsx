"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export default function GoalsIndexPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/goals/tracking'); }, [router]);
  return null;
}
