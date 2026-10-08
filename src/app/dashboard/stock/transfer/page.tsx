"use client";

import { useRouter } from 'next/navigation';
import { StockTransfer } from '@/components/stock-transfer';

// A transferência agora é um modal; a rota continua existindo e o fecha de volta para a origem.
export default function StockTransferPage() {
    const router = useRouter();
    const close = () => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push('/dashboard/stock/inventory-control');
    };
    return <StockTransfer open onOpenChange={(open) => { if (!open) close(); }} />;
}
