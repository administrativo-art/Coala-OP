
"use client";

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { StockTransfer } from '@/components/stock-transfer';
import { ArrowLeft } from 'lucide-react';

export default function StockTransferPage() {
    const router = useRouter();
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 mb-2">
                <Button 
                    onClick={() => router.push('/dashboard/stock/inventory-control')}
                    variant="ghost"
                    className="p-2 rounded-full h-auto w-auto text-muted-foreground transition-colors hover:bg-muted"
                    aria-label="Voltar para Controle de Estoque"
                >
                    <ArrowLeft className="w-6 h-6" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold">Transferência de Estoque</h1>
                    <p className="text-sm text-muted-foreground">Voltar para Controle de Estoque</p>
                </div>
            </div>
            <StockTransfer />
        </div>
    );
}
