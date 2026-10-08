"use client";

import { useRouter } from 'next/navigation';
import { StockWriteDown } from '@/components/stock-write-down';

// A baixa em lote agora é um modal; a rota continua existindo e o fecha de volta para a origem.
export default function StockWriteDownPage() {
    const router = useRouter();
    const close = () => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back();
        else router.push('/dashboard/stock/inventory-control');
    };
    return <StockWriteDown open onOpenChange={(open) => { if (!open) close(); }} />;
}
