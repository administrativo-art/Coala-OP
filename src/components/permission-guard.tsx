"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface PermissionGuardProps {
  children: React.ReactNode;
  allowed: boolean;
  redirectTo?: string;
}

export function PermissionGuard({ 
  children, 
  allowed, 
  redirectTo = "/dashboard" 
}: PermissionGuardProps) {
  const { loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace(redirectTo);
    }
  }, [loading, allowed, redirectTo, router]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!allowed) return null;

  return <>{children}</>;
}