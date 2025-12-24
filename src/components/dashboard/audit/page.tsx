
"use client";

import { StockSessionManagement } from "@/components/stock-session-management";
import { GlassCard, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/glass-card";

export default function UnifiedAuditPage() {
    return (
        <GlassCard>
            <CardHeader>
                <CardTitle>Auditoria de Estoque</CardTitle>
                <CardDescription>
                    Realize contagens de estoque para garantir a acurácia dos dados, aprove ou rejeite contagens pendentes e visualize o histórico.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <StockSessionManagement showExportButton={true} />
            </CardContent>
        </GlassCard>
    );
}
