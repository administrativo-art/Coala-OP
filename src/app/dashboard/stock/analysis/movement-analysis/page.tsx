"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { MovementAnalysis } from '@/components/movement-analysis';
import { ArrowLeft } from 'lucide-react';

export default function MovementAnalysisPage() {
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
                <h1 className="text-3xl font-bold">Análise de Movimentações</h1>
                <p className="text-sm text-muted-foreground">Analise o comportamento de abastecimento e movimentação de insumos entre as unidades.</p>
            </div>
            <MovementAnalysis />
        </div>
    );
}
