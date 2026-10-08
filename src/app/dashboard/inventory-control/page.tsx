
"use client";

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { MinusCircle, History, Truck, Scale, Ticket } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { MovementHistoryModal } from '@/components/movement-history-modal';
import { FinancialPeriodAnalysisModal } from '@/components/financial-period-analysis-modal';
import { LabelSettingsModal } from '@/components/label-settings';
import { RadialMenu } from '@/components/radial-menu';
import { BackButton } from '@/components/navigation/back-button';

function InventoryControlContent() {
    const router = useRouter();
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
    const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);

    const menuItems = [
      {
        icon: <MinusCircle className="h-6 w-6" />,
        label: 'Realizar Baixa',
        onClick: () => router.push('/dashboard/stock/write-down'),
      },
      {
        icon: <Truck className="h-6 w-6" />,
        label: 'Realizar Transferência',
        onClick: () => router.push('/dashboard/stock/transfer'),
      },
      {
        icon: <History className="h-6 w-6" />,
        label: 'Consultar Histórico',
        onClick: () => setIsHistoryModalOpen(true),
      },
      {
        icon: <Scale className="h-6 w-6" />,
        label: 'Consumo por Período',
        onClick: () => setIsConsumptionModalOpen(true),
      },
      {
        icon: <Ticket className="h-6 w-6" />,
        label: 'Configurar Etiquetas',
        onClick: () => setIsLabelModalOpen(true),
      },
    ];

    return (
        <>
            <div className="space-y-4">
                <div className="mx-auto flex w-full max-w-[1520px] items-center gap-3.5 px-4 pt-5 sm:px-6">
                    <BackButton
                        fallbackHref="/dashboard/stock"
                        label="Voltar para gestão de estoque"
                        iconOnly
                        className="h-9 w-9 shrink-0 rounded-[11px] border-[#e3dfd6] bg-white text-[#70757d] hover:bg-[#f6f4ef]"
                        iconClassName="h-4 w-4"
                    />
                    <h1 className="m-0 text-2xl font-extrabold tracking-[-.025em]">Controle de Estoque</h1>
                </div>
                <ExpiryControl
                    onOpenHistory={() => setIsHistoryModalOpen(true)}
                    onOpenConsumption={() => setIsConsumptionModalOpen(true)}
                />
            </div>

            <RadialMenu items={menuItems} />

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
