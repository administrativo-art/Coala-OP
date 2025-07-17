
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";

export function PricingSimulator() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <DollarSign />
                    Análise de custo de mercadorias
                </CardTitle>
                <CardDescription>
                    Crie composições de produtos, analise o CMV e simule preços de venda para entender a lucratividade.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <p>O módulo de análise de custo está em construção.</p>
                </div>
            </CardContent>
        </Card>
    );
}
