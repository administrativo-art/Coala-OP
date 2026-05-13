"use client";

import { BackButton } from "@/components/navigation/back-button";
import { PurchaseHistoryDashboard } from "@/components/purchase-history-dashboard";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function PurchaseHistoryPage() {
    return (
        <div className="space-y-4">
             <div className="mb-4">
                <BackButton fallbackHref="/dashboard/stock" label="Voltar para gestão de estoque" />
            </div>
             <div className="space-y-1 mb-6">
                <h1 className="text-3xl font-bold">Consultar histórico</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Histórico de compras</CardTitle>
                    <CardDescription>Consulte ordens de compra finalizadas e o histórico de preços efetivados de todos os insumos.</CardDescription>
                </CardHeader>
                <CardContent>
                    <PurchaseHistoryDashboard />
                </CardContent>
            </Card>
        </div>
    );
}
