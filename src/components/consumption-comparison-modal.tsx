"use client";

import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { type BaseProduct, type ConsumptionReport, type MovementRecord } from '@/types';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Skeleton } from './ui/skeleton';
import { ArrowLeftRight, Truck, BarChart3, Inbox } from 'lucide-react';
import { useProducts } from '@/hooks/use-products';
import { convertValue } from '@/lib/conversion';

interface ConsumptionComparisonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseProduct: BaseProduct | null;
  kioskId: string;
  startPeriod: string; // "YYYY-MM"
  endPeriod: string; // "YYYY-MM"
}

const formatNumber = (value: number, unit: string) => {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`;
};

export function ConsumptionComparisonModal({ open, onOpenChange, baseProduct, kioskId, startPeriod, endPeriod }: ConsumptionComparisonModalProps) {
  const { history: movementHistory, loading: historyLoading } = useMovementHistory();
  const { reports: consumptionReports, isLoading: consumptionLoading } = useValidatedConsumptionData();
  const { products } = useProducts();

  const loading = historyLoading || consumptionLoading;

  const comparisonData = useMemo(() => {
    if (!baseProduct || !kioskId || !startPeriod || !endPeriod || loading) {
      return null;
    }

    const startDate = startOfMonth(parseISO(`${startPeriod}-01`));
    const endDate = endOfMonth(parseISO(`${endPeriod}-01`));
    
    // 1. Calculate Total Transferred
    const transfers = movementHistory.filter(m =>
      m.type === 'TRANSFERENCIA_ENTRADA' &&
      m.toKioskId === kioskId &&
      isWithinInterval(parseISO(m.timestamp), { start: startDate, end: endDate })
    );

    let totalTransferred = 0;
    transfers.forEach(movement => {
        const product = products.find(p => p.id === movement.productId);
        if (!product || product.baseProductId !== baseProduct.id) return;
        try {
            const valueInBase = convertValue(movement.quantityChange, product.unit, baseProduct.unit, product.category);
            totalTransferred += valueInBase;
        } catch(e) {
            console.error("Error converting transfer value:", e)
        }
    });

    // 2. Calculate Total Consumed
    let totalConsumed = 0;
    const monthsInRange: string[] = [];
    let currentMonth = new Date(startDate);
    while(currentMonth <= endDate) {
        monthsInRange.push(format(currentMonth, 'yyyy-MM'));
        currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 2, 1);
        currentMonth = startOfMonth(currentMonth);
    }
    
    const relevantReports = consumptionReports.filter(r => 
        r.kioskId === kioskId && 
        monthsInRange.includes(`${r.year}-${String(r.month).padStart(2, '0')}`)
    );

    relevantReports.forEach(report => {
        const item = report.results.find(res => res.baseProductId === baseProduct.id);
        if (item) {
            totalConsumed += item.consumedQuantity;
        }
    });

    const difference = totalTransferred - totalConsumed;

    return { totalTransferred, totalConsumed, difference };

  }, [baseProduct, kioskId, startPeriod, endPeriod, movementHistory, consumptionReports, products, loading]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight /> Comparativo de Consumo
          </DialogTitle>
          <DialogDescription>
            Análise de Transferências vs. Consumo Real para <strong>{baseProduct?.name}</strong> no período selecionado.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            {loading ? <Skeleton className="h-48 w-full" /> : 
             !comparisonData ? <div className="text-center text-muted-foreground"><Inbox className="mx-auto h-8 w-8 mb-2"/>Nenhum dado para comparar.</div> :
             (
                 <div className="space-y-4">
                     <div className="p-4 border rounded-lg bg-blue-500/10 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">
                         <h3 className="font-semibold flex items-center gap-2"><Truck /> Total Transferido</h3>
                         <p className="text-2xl font-bold">{formatNumber(comparisonData.totalTransferred, baseProduct!.unit)}</p>
                         <p className="text-xs">Soma de todas as entradas por transferência neste quiosque.</p>
                     </div>
                      <div className="p-4 border rounded-lg bg-green-500/10 text-green-800 dark:bg-green-500/20 dark:text-green-200">
                         <h3 className="font-semibold flex items-center gap-2"><BarChart3 /> Total Consumido (Vendas)</h3>
                         <p className="text-2xl font-bold">{formatNumber(comparisonData.totalConsumed, baseProduct!.unit)}</p>
                         <p className="text-xs">Consumo calculado a partir dos relatórios de venda importados.</p>
                     </div>
                      <div className="p-4 border rounded-lg bg-gray-500/10 text-gray-800 dark:bg-gray-100/10 dark:text-gray-200">
                         <h3 className="font-semibold">Diferença (Transferido - Consumido)</h3>
                         <p className="text-2xl font-bold">{formatNumber(comparisonData.difference, baseProduct!.unit)}</p>
                         <p className="text-xs">
                             {comparisonData.difference > 0 ? "Positivo: Indica que foi transferido mais do que o consumido (pode ter aumentado o estoque)." :
                              comparisonData.difference < 0 ? "Negativo: Indica que o consumo foi maior que o transferido (pode ter usado estoque antigo)." :
                              "Equilíbrio: O total transferido foi igual ao consumido."}
                         </p>
                     </div>
                 </div>
             )
            }
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
