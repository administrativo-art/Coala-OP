"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { RestockAnalysis } from '@/components/restock-analysis';
import { ArrowLeft } from 'lucide-react';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from "@/hooks/use-auth";
import { PermissionGuard } from "@/components/permission-guard";

function RestockAnalysisContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const kioskId = searchParams.get('kioskId');
    const { kiosks } = useKiosks();
    const kiosk = kiosks.find(k => k.id === kioskId);
    const kioskName = kiosk?.name.replace(/^Quiosque\s+/i, '') || 'Atividade de reposição';
    const kioskColor = kioskName.toLowerCase().includes('tirirical')
        ? 'bg-[#fb8d4c]'
        : kioskName.toLowerCase().includes('cohama')
          ? 'bg-[#9554e8]'
          : kioskName.toLowerCase().includes('renascença')
            ? 'bg-[#4aa9df]'
            : 'bg-[#5bc88d]';

    return (
        <div className="mx-auto w-full max-w-[1700px] space-y-5 pb-24">
            <Button
                onClick={() => router.push('/dashboard/stock/analysis')}
                variant="ghost"
                className="h-auto px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar para reposição
            </Button>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                    <div className={`mt-1 h-12 w-12 shrink-0 rounded-xl ${kioskColor}`} />
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Solicitação de reposição</p>
                        <h1 className="text-2xl font-bold tracking-tight">Quiosque {kioskName}</h1>
                        <p className="text-sm text-muted-foreground">Selecione produtos, ajuste lotes e revise antes de enviar.</p>
                    </div>
                </div>
            </div>
            <RestockAnalysis />
        </div>
    );
}

export default function RestockAnalysisPage() {
    const { permissions } = useAuth();

    return (
        <PermissionGuard allowed={permissions.stock.analysis.restock}>
            <Suspense fallback={<Skeleton className="h-[80vh] w-full" />}>
                <RestockAnalysisContent />
            </Suspense>
        </PermissionGuard>
    );
}
