
"use client";

import { BackButton } from '@/components/navigation/back-button';
import { StockWriteDown } from '@/components/stock-write-down';

export default function StockWriteDownPage() {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 mb-2">
                <BackButton
                    fallbackHref="/dashboard/stock"
                    variant="ghost"
                    iconOnly
                    className="h-auto w-auto rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
                    ariaLabel="Voltar para gestão de estoque"
                />
                <div>
                    <h1 className="text-3xl font-bold">Baixa de Estoque</h1>
                    <p className="text-sm text-muted-foreground">Voltar para gestão de estoque</p>
                </div>
            </div>
            <StockWriteDown />
        </div>
    );
}
