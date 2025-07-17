
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";

export function PricingSimulator() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <DollarSign />
                    Simulador de Preços de Mercadorias
                </CardTitle>
                <CardDescription>
                    Crie composições de produtos, analise o Custo da Mercadoria Vendida (CMV) e simule preços de venda para entender a lucratividade.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <p>O módulo de simulação de preços está em construção.</p>
                </div>
            </CardContent>
        </Card>
    );
}
