

"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RestockAnalysis } from '@/components/restock-analysis';
import { ArrowLeft } from 'lucide-react';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

function RestockAnalysisContent() {
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
                    <h1 className="text-3xl font-bold">Atividade de reposição</h1>
                    <p className="text-sm text-muted-foreground">Selecione os produtos e as quantidades para iniciar uma atividade de reposição.</p>
                </div>
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
