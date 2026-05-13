"use client";

import { BackButton } from '@/components/navigation/back-button';
import { MovementAnalysis } from '@/components/movement-analysis';

export default function MovementAnalysisPage() {
    return (
        <div className="space-y-4">
            <div className="mb-4">
                <BackButton fallbackHref="/dashboard/stock" label="Voltar para gestão de estoque" />
            </div>
            <div className="space-y-1 mb-6">
                <h1 className="text-3xl font-bold">Análise de movimentações</h1>
                <p className="text-sm text-muted-foreground">Compare consumo, saldo e transferências de insumos entre as unidades.</p>
            </div>
            <MovementAnalysis />
        </div>
    );
}
