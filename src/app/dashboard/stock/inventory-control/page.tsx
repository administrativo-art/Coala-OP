
"use client";

import { Suspense } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { ArrowLeft, ArrowRight, MinusCircle, History, Truck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { MovementHistoryModal } from '@/components/movement-history-modal';
import { useState } from 'react';

function InventoryControlContent() {
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

    return (
        <>
            <div className="space-y-4">
                <div className="flex flex-wrap gap-2 justify-between items-center">
                    <Link href="/dashboard/stock">
                        <Button variant="outline">
                            <ArrowLeft className="mr-2" />
                            Voltar para gestão de estoque
                        </Button>
                    </Link>
                    <div className="flex flex-wrap gap-2">
                         <Link href="/dashboard/stock/write-down">
                            <Button variant="outline"><MinusCircle className="mr-2 h-4 w-4" /> Realizar Baixa</Button>
                        </Link>
                        <Link href="/dashboard/stock/transfer">
                            <Button variant="outline"><Truck className="mr-2 h-4 w-4" /> Realizar Transferência</Button>
                        </Link>
                        <Button variant="outline" onClick={() => setIsHistoryModalOpen(true)}>
                            <History className="mr-2 h-4 w-4"/> Consultar Histórico
                        </Button>
                    </div>
                </div>
                <ExpiryControl />
            </div>
            {isHistoryModalOpen && (
                <MovementHistoryModal open={isHistoryModalOpen} onOpenChange={setIsHistoryModalOpen} />
            )}
        </>
    );
}

export default function InventoryControlPage() {
    return (
        <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
            <InventoryControlContent />
        </Suspense>
    );
}
