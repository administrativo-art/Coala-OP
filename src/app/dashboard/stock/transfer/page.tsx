
"use client";

import { BackButton } from '@/components/navigation/back-button';
import { StockTransfer } from '@/components/stock-transfer';

export default function StockTransferPage() {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 mb-2">
                <BackButton
                    fallbackHref="/dashboard/stock/inventory-control"
                    variant="ghost"
                    iconOnly
                    className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
                    ariaLabel="Voltar para Controle de Estoque"
                />
                <div>
                    <h1 className="text-3xl font-bold">Transferência de Estoque</h1>
                    <p className="text-sm text-muted-foreground">Voltar para Controle de Estoque</p>
                </div>
            </div>
            <StockTransfer />
        </div>
    );
}
