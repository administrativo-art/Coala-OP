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
                    <h1 className="text-3xl font-bold">Registrar nova compra</h1>
                    <p className="text-sm text-muted-foreground">Voltar para gestão de estoque</p>
                </div>
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
