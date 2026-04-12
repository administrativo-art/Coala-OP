"use client";

import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DPLayout({ children }: { children: React.ReactNode }) {
  const { permissions, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated && !permissions.dp?.view) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, permissions, router]);

  if (!permissions.dp?.view) return null;

  return <>{children}</>;
}
