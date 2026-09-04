"use client";

import { useAuth } from '@/hooks/use-auth';
import { canAccessDpRoute } from '@/lib/dp-route-access';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DPLayout({ children }: { children: React.ReactNode }) {
  const { permissions, isAuthenticated } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const canAccess = canAccessDpRoute(permissions, pathname);

  useEffect(() => {
    if (isAuthenticated && !canAccess) {
      router.replace('/dashboard');
    }
  }, [canAccess, isAuthenticated, router]);

  if (!canAccess) return null;

  return <>{children}</>;
}
