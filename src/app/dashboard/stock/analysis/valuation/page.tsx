

"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { StockValuation } from '@/components/stock-valuation';
import { ArrowLeft } from 'lucide-react';

export default function StockValuationPage() {
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
                    <h1 className="text-3xl font-bold">Avaliação Financeira</h1>
                    <p className="text-sm text-muted-foreground">Voltar para gestão de estoque</p>
                </div>
            </div>
            <StockValuation />
        </div>
    );
}
