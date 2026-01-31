
"use client";

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ExpiryControl } from '@/components/expiry-control';
import { ArrowLeft, MinusCircle, History, Truck, Scale, Ticket, Menu } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { MovementHistoryModal } from '@/components/movement-history-modal';
import { FinancialPeriodAnalysisModal } from '@/components/financial-period-analysis-modal';
import { LabelSettingsModal } from '@/components/label-settings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from 'next/link';

function InventoryControlContent() {
    const router = useRouter();
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
    const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);

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
                <div className="flex justify-between items-start mb-6">
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold">Controle de Estoque</h1>
                        <p className="text-sm text-muted-foreground">Monitore validades, adicione lotes e faça movimentações.</p>
                    </div>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon">
                          <Menu className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href="/dashboard/stock/write-down" className="w-full">
                            <MinusCircle className="mr-2 h-4 w-4" /> Realizar Baixa
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/dashboard/stock/transfer" className="w-full">
                            <Truck className="mr-2 h-4 w-4" /> Realizar Transferência
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsHistoryModalOpen(true)}>
                          <History className="mr-2 h-4 w-4"/> Consultar Histórico
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsConsumptionModalOpen(true)}>
                          <Scale className="mr-2 h-4 w-4"/> Consumo por período
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsLabelModalOpen(true)}>
                          <Ticket className="mr-2 h-4 w-4" /> Configurar Etiquetas
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
