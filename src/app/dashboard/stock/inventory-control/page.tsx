
"use client";

import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { Skeleton } from '@/components/ui/skeleton';
import { StockWriteDown } from '@/components/stock-write-down';
import { StockTransfer } from '@/components/stock-transfer';
import { MovementHistoryModal } from '@/components/movement-history-modal';
import { FinancialPeriodAnalysisModal } from '@/components/financial-period-analysis-modal';
import { LabelSettingsModal } from '@/components/label-settings';
import { useAuth } from '@/hooks/use-auth';
import { BackButton } from '@/components/navigation/back-button';

function InventoryControlContent() {
    const { permissions } = useAuth();
    const [isWriteDownOpen, setIsWriteDownOpen] = useState(false);
    const [isTransferOpen, setIsTransferOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
    const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
    


    return (
        <>
            <div className="space-y-4">
                <ExpiryControl
                    heading={(
                        <div className="flex items-center gap-3.5">
                            <BackButton
                                fallbackHref="/dashboard/stock"
                                label="Voltar"
                                iconOnly
                                className="h-9 w-9 shrink-0 rounded-[11px] border-white/10 bg-white/[.07] text-[#c8c7d0] hover:bg-white/15 hover:text-white"
                                iconClassName="h-4 w-4"
                            />
                            <h1 className="m-0 text-2xl font-extrabold tracking-[-.025em] text-white">Controle de Estoque</h1>
                        </div>
                    )}
                    onOpenWriteDown={() => setIsWriteDownOpen(true)}
                    onOpenTransfer={() => setIsTransferOpen(true)}
                    onOpenLabels={permissions.settings.manageLabels ? () => setIsLabelModalOpen(true) : undefined}
                    onOpenHistory={() => setIsHistoryModalOpen(true)}
                    onOpenConsumption={() => setIsConsumptionModalOpen(true)}
                />
            </div>

            <StockWriteDown open={isWriteDownOpen} onOpenChange={setIsWriteDownOpen} />
            <StockTransfer open={isTransferOpen} onOpenChange={setIsTransferOpen} />

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
