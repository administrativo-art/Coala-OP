"use client";

import { BackButton } from '@/components/navigation/back-button';
import { ConsumptionAnalysisDashboard } from '@/components/consumption-analysis-dashboard';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function ConsumptionAnalysisPage() {
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.stock.analysis.consumption}>
            <div className="space-y-4">
                <div className="mb-4">
                    <BackButton fallbackHref="/dashboard/stock" label="Voltar para gestão de estoque" />
                </div>
                <div className="space-y-1 mb-6">
                    <h1 className="text-3xl font-bold">Consumo médio</h1>
                    <p className="text-sm text-muted-foreground">Visualize o consumo médio dos seus insumos.</p>
                </div>
                <ConsumptionAnalysisDashboard />
            </div>
        </PermissionGuard>
    );
}
