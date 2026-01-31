
"use client";

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { ArrowLeft, MinusCircle, History, Truck, Scale, Ticket } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { MovementHistoryModal } from '@/components/movement-history-modal';
import { FinancialPeriodAnalysisModal } from '@/components/financial-period-analysis-modal';
import { LabelSettingsModal } from '@/components/label-settings';
import { RadialMenu } from '@/components/radial-menu';

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
                <div className="mb-4">
                    <Button 
                        onClick={() => router.push('/dashboard/stock')}
                        variant="outline"
                    >
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Voltar para gestão de estoque
                    </Button>
                </div>
                <div className="space-y-1 mb-6">
                    <h1 className="text-3xl font-bold">Controle de Estoque</h1>
                    <p className="text-sm text-muted-foreground">Monitore validades, adicione lotes e faça movimentações.</p>
                </div>
                
                <ExpiryControl />
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
