
"use client";

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StockTransfer } from '@/components/stock-transfer';
import { ArrowLeft } from 'lucide-react';

export default function StockTransferPage() {
    return (
        <div className="space-y-4">
             <Link href="/dashboard/stock/inventory-control" className="inline-block mb-4">
                <Button variant="outline">
                    <ArrowLeft className="mr-2" />
                    Voltar para Controle de Estoque
                </Button>
            </Link>
            <StockTransfer />
        </div>
    );
}
