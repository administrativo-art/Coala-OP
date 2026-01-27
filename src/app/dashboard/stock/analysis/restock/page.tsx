

"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RestockAnalysis } from '@/components/restock-analysis';
import { ArrowLeft } from 'lucide-react';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useKiosks } from '@/hooks/use-kiosks';

function RestockAnalysisContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const kioskId = searchParams.get('kioskId');
    const { kiosks } = useKiosks();
    const kiosk = kiosks.find(k => k.id === kioskId);

    return (
        <div className="space-y-4">
            <div className="mb-4">
                 <Button 
                    onClick={() => router.push('/dashboard/stock/analysis')}
                    variant="outline"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Voltar para reposição
                </Button>
            </div>
            <div className="space-y-1 mb-6">
                 <h1 className="text-3xl font-bold">{kiosk?.name.replace('Quiosque', 'Unidade') || 'Atividade de reposição'}</h1>
                <p className="text-sm text-muted-foreground">Selecione os produtos para incluir na atividade de reposição</p>
            </div>
            <RestockAnalysis />
        </div>
    );
}

export default function RestockAnalysisPage() {
    return (
        <Suspense fallback={<Skeleton className="h-[80vh] w-full" />}>
            <RestockAnalysisContent />
        </Suspense>
    );
}
