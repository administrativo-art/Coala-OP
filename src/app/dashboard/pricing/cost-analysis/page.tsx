"use client";

import { PricingSimulator } from '@/components/pricing-simulator';
import { BackButton } from '@/components/navigation/back-button';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function CostAnalysisPage() {
  const { permissions } = useAuth();

  return (
    <PermissionGuard allowed={permissions.pricing.view}>
        <div className="mx-auto w-full max-w-[1280px] space-y-5 pb-10">
        <div className="flex items-start gap-3">
            <BackButton
                fallbackHref="/dashboard/pricing"
                variant="ghost"
                iconOnly
                className="mt-1 h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
                ariaLabel="Voltar para gestão de preços e margens"
            />
            <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pink-600">Coala · Comercial</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Precificação &amp; CMV</h1>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Encontre margens ruins, CMV anormal e divergências de preço por canal sem abrir cada mercadoria.</p>
            </div>
        </div>
        <PricingSimulator />
        </div>
    </PermissionGuard>
  );
}
