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
             <div className="mb-4">
                <Button 
                    onClick={() => router.push('/dashboard/stock')}
                    variant="outline"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para gestão de estoque
                </Button>
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
