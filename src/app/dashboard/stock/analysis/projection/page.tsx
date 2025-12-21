
"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConsumptionProjection } from '@/components/consumption-projection';
import { ArrowLeft } from 'lucide-react';

export default function ConsumptionProjectionPage() {
    const router = useRouter();

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 mb-2">
                <Button 
                    onClick={() => router.push('/dashboard/stock/analysis')}
                    variant="ghost"
                    className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                    aria-label="Voltar para análises"
                >
                    <ArrowLeft className="w-6 h-6" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Projeção de Consumo</h1>
                    <p className="text-sm text-muted-foreground">Voltar para análises</p>
                </div>
            </div>
            <ConsumptionProjection />
        </div>
    );
}
