"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function CostAnalysisPage() {
  const { permissions } = useAuth();

  return (
    <PermissionGuard allowed={permissions.pricing.view}>
        <div className="mx-auto w-full max-w-[1220px] pb-10">
        <PricingSimulator pageHeader />
        </div>
    </PermissionGuard>
  );
}
