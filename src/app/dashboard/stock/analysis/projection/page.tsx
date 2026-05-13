"use client";

import { BackButton } from '@/components/navigation/back-button';
import { ConsumptionProjection } from '@/components/consumption-projection';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function ConsumptionProjectionPage() {
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.stock.analysis.projection}>
            <div className="space-y-4">
                <div className="mb-4">
                    <BackButton fallbackHref="/dashboard/stock" label="Voltar para gestão de estoque" />
                </div>
                <div className="space-y-1 mb-6">
                    <h1 className="text-3xl font-bold">Projeção de Consumo</h1>
                    <p className="text-sm text-muted-foreground">Preveja se o estoque será consumido antes do vencimento.</p>
                </div>
                <ConsumptionProjection />
            </div>
        </PermissionGuard>
    );
}
