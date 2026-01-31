"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConsumptionAnalysisDashboard } from '@/components/consumption-analysis-dashboard';
import { ArrowLeft } from 'lucide-react';

export default function ConsumptionAnalysisPage() {
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
                <h1 className="text-3xl font-bold">Consumo Médio</h1>
                <p className="text-sm text-muted-foreground">Visualize o consumo médio dos seus insumos.</p>
            </div>
            <ConsumptionAnalysisDashboard />
        </div>
    );
}
