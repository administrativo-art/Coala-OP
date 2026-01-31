"use client";

import { PurchaseHistoryDashboard } from "@/components/purchase-history-dashboard";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function PurchaseHistoryPage() {
    const router = useRouter();

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 mb-2">
                <Button 
                    onClick={() => router.push('/dashboard/stock')}
                    variant="ghost"
                    className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                    aria-label="Voltar para gestão de estoque"
                >
                    <ArrowLeft className="w-6 h-6" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Consultar histórico</h1>
                    <p className="text-sm text-muted-foreground">Voltar para gestão de estoque</p>
                </div>
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
