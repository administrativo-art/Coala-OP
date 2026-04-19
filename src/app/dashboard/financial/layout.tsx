"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { FinancialProvider } from "@/features/financial/components/financial-provider";

export default function FinancialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { permissions, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated && !permissions.financial?.view) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, permissions.financial?.view, router]);

  if (!permissions.financial?.view) return null;

  return <FinancialProvider>{children}</FinancialProvider>;
}
