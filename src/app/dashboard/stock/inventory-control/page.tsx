"use client";

import { Suspense } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { ArrowLeft, ArrowRight, MinusCircle, History, Truck, Scale, Ticket } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { MovementHistoryModal } from '@/components/movement-history-modal';
import { useState } from 'react';
import { FinancialPeriodAnalysisModal } from '@/components/financial-period-analysis-modal';
import { LabelSettingsModal } from '@/components/label-settings';

function InventoryControlContent() {
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
    const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);

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
                         <Button variant="outline" onClick={() => setIsConsumptionModalOpen(true)}>
                            <Scale className="mr-2 h-4 w-4"/> Consumo por período
                        </Button>
                         <Button variant="outline" onClick={() => setIsLabelModalOpen(true)}>
                            <Ticket className="mr-2 h-4 w-4" /> Configurar Etiquetas
                        </Button>
                    </div>
                </div>
                <ExpiryControl />
            </div>
            {isHistoryModalOpen && (
                <MovementHistoryModal open={isHistoryModalOpen} onOpenChange={setIsHistoryModalOpen} />
            )}
            {isConsumptionModalOpen && (
                <FinancialPeriodAnalysisModal open={isConsumptionModalOpen} onOpenChange={setIsConsumptionModalOpen} />
            )}
            {isLabelModalOpen && (
                <LabelSettingsModal
                    isOpen={isLabelModalOpen}
                    onClose={() => setIsLabelModalOpen(false)}
                />
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
