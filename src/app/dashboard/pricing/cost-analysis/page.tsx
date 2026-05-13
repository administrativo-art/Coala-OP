"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { BackButton } from '@/components/navigation/back-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign } from 'lucide-react';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function CostAnalysisPage() {
  const { permissions } = useAuth();

  return (
    <PermissionGuard allowed={permissions.pricing.view}>
        <div className="space-y-6">
        <div className="flex items-center gap-4 mb-2">
            <BackButton
                fallbackHref="/dashboard/pricing"
                variant="ghost"
                iconOnly
                className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
                ariaLabel="Voltar para gestão de preços e margens"
            />
            <div>
                <h1 className="text-3xl font-bold">Ficha de custo e margem</h1>
                <p className="text-sm text-muted-foreground">Voltar para gestão de preços e margens</p>
            </div>
        </div>
        <PricingSimulator />
        </div>
    </PermissionGuard>
  );
}
