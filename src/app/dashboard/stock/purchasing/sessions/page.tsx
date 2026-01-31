"use client";

import { PurchaseSessionList } from "@/components/purchase-session-list";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export default function PurchaseSessionsPage() {
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
                <h1 className="text-3xl font-bold">Registrar nova compra</h1>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Pesquisas de preço em andamento</CardTitle>
                    <CardDescription>Crie pesquisas manuais ou continue preenchendo as cotações em andamento.</CardDescription>
                </CardHeader>
                <CardContent>
                    <PurchaseSessionList />
                </CardContent>
            </Card>
        </div>
    );
}
