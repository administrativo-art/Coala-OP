"use client";

import { BackButton } from '@/components/navigation/back-button';
import { CompetitorsWorkspace } from '@/components/competitors/competitors-workspace';
import { PermissionGuard } from "@/components/permission-guard";
import { useAuth } from "@/hooks/use-auth";

/** Mesmo espaço de trabalho da aba Concorrentes em Configurações → Comercial. */
export default function PriceComparisonPage() {
  const { permissions } = useAuth();

  return (
    <PermissionGuard allowed={permissions.pricing.view}>
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <div className="mb-2 flex items-center gap-4">
          <BackButton
            fallbackHref="/dashboard/pricing"
            variant="ghost"
            iconOnly
            className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
            ariaLabel="Voltar para gestão de preços e margens"
          />
          <div>
            <h1 className="text-3xl font-bold">Estudo de preço</h1>
            <p className="text-sm text-muted-foreground">Compare os preços das suas mercadorias com os da concorrência para se manter competitivo.</p>
          </div>
        </div>
        <CompetitorsWorkspace />
      </div>
    </PermissionGuard>
  );
}
