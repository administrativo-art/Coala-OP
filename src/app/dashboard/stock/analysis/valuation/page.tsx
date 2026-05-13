"use client";

import { BackButton } from '@/components/navigation/back-button';
import { StockValuation } from '@/components/stock-valuation';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

export default function StockValuationPage() {
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.stock.analysis.valuation}>
            <div className="space-y-4">
                <div className="mb-4">
                    <BackButton fallbackHref="/dashboard/stock" label="Voltar para gestão de estoque" />
                </div>
                <div className="space-y-1 mb-6">
                    <h1 className="text-3xl font-bold">Avaliação Financeira</h1>
                    <p className="text-sm text-muted-foreground">Calcule o valor financeiro do seu estoque.</p>
                </div>
                <StockValuation />
            </div>
        </PermissionGuard>
    );
}
