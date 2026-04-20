"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react"
import { format, startOfMonth, addMonths, isWithinInterval, parseISO, endOfMonth, subMonths, startOfYear, isValid, subDays, isSameDay, startOfDay, endOfDay } from "date-fns"
import { ptBR } from 'date-fns/locale'

// Hooks
import { useMovementHistory } from "@/hooks/use-movement-history";
import { useProducts } from "@/hooks/use-products";
import { useKiosks } from "@/hooks/use-kiosks";
import { useBaseProducts } from "@/hooks/use-base-products";
import { useValidatedConsumptionData } from "@/hooks/use-validated-consumption-data";
import { convertValue } from '@/lib/conversion';
import { MovementHistoryModal } from "./movement-history-modal";
import { ConsumptionDetailsModal } from "./consumption-details-modal";
import { type BaseProduct, type MovementRecord, type ConsumptionReport } from "@/types";

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Skeleton } from "./ui/skeleton"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select"
import { Input } from "./ui/input"
import { MultiSelect } from "./ui/multi-select"
import { Inbox, Truck, TrendingUp, TrendingDown, Minus, CalendarDays, ChevronLeft, ChevronRight, Package, Wrench, ArrowLeftRight, Filter } from "lucide-react";
import { LineChart, Line, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Product } from "@/types";
import { Separator } from "./ui/separator";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";

const stdDev = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
};

// Card model for transfer data
type TransferCardModel = {
  id: string; // baseProductId
  name: string;
  unit: string;
  series: { label: string; value: number }[];
  periodAvg: number;
  histAvg: number;
  periodChangePct: number;
  historicalChangePct: number;
  historicalStatus: 'normal' | 'acima' | 'abaixo' | 'sem dados';
  volatility: 'Alta' | 'Média' | 'Baixa' | 'N/A';
  representativeProduct?: Product;
};

// Tooltip for the sparkline chart
function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="p-2 bg-background/80 border rounded-md shadow-lg">
        <p className="text-xs font-bold">{label}</p>
        <p className="text-sm text-primary">{`Transferido: ${payload[0].value.toFixed(1)}`}</p>
      </div>
    );
  }
  return null;
}

// Card component to display transfer analysis for a single base product
function TransferCard({ data }: { data: TransferCardModel }) {
  const PeriodIcon = data.periodChangePct > 5 ? TrendingUp : data.periodChangePct < -5 ? TrendingDown : Minus;
  const periodColor = data.periodChangePct > 5 ? "text-destructive" : data.periodChangePct < -5 ? "text-green-600" : "text-muted-foreground";

  let historicalText, historicalColor;
  switch (data.historicalStatus) {
      case 'acima':
          historicalText = `${data.historicalChangePct.toFixed(0)}% acima do padrão histórico`;
          historicalColor = "text-destructive";
          break;
      case 'abaixo':
          historicalText = `${Math.abs(data.historicalChangePct).toFixed(0)}% abaixo da média`;
          historicalColor = "text-green-600";
          break;
      case 'normal':
          historicalText = "Dentro do padrão histórico";
          historicalColor = "text-muted-foreground";
          break;
      default:
          historicalText = "Histórico de transferências insuficiente";
          historicalColor = "text-muted-foreground";
  }
  
  const formatDisplayQuantity = (baseQuantity: number): string => {
      const formatNumber = (value: number) => {
        const options: Intl.NumberFormatOptions = {
          maximumFractionDigits: 1,
        };
        if (value % 1 === 0) {
            options.maximumFractionDigits = 0;
        }
        return value.toLocaleString('pt-BR', options);
      };
      return `${formatNumber(baseQuantity)} ${data.unit}`;
  };
  
  const formattedPeriod = formatDisplayQuantity(data.periodAvg);
  const formattedHist = formatDisplayQuantity(data.histAvg);

  const volatilityText = {
    'Alta': 'Transferências imprevisíveis',
    'Média': 'Transferências com variações',
    'Baixa': 'Padrão de transferência estável',
    'N/A': 'Não aplicável'
  }[data.volatility];


  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold leading-tight line-clamp-2">{data.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className={cn("text-4xl font-bold flex items-center gap-2", periodColor)}>
          <PeriodIcon className="h-8 w-8" />
          <span>{data.periodChangePct.toFixed(0)}%</span>
        </div>
         <p className="text-xs text-muted-foreground">Variação no período selecionado</p>
         <p className={cn("text-xs font-semibold mt-1", historicalColor)}>{historicalText}</p>

         <div className="h-[60px] mt-4 -mx-4">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series}>
                    <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '3 3' }}/>
                    <ReferenceLine y={data.histAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeWidth={1} />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} />
                </LineChart>
            </ResponsiveContainer>
         </div>
      </CardContent>
       <CardFooter className="flex-col items-start text-xs border-t pt-3 pb-3">
        <div className="grid grid-cols-2 gap-x-4 w-full">
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase">Média Período</p>
                <div>
                    <p className="text-sm font-bold text-foreground">{formattedPeriod}/mês</p>
                </div>
            </div>
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase">Média Histórica</p>
                <div>
                    <p className="text-sm font-bold text-foreground">{formattedHist}/mês</p>
                </div>
            </div>
        </div>
        <Separator className="my-2" />
        <div className="flex justify-between items-center w-full">
            <div>
                <span className="text-xs text-muted-foreground uppercase">Volatilidade: </span> 
                <span className="font-semibold text-foreground">{volatilityText}</span>
            </div>
        </div>
    </CardFooter>
    </Card>
  )
}

const formatNumber = (value: number) => {
    const options: Intl.NumberFormatOptions = {};
    if (value % 1 !== 0) {
        options.minimumFractionDigits = 1;
        options.maximumFractionDigits = 2;
    }
    return value.toLocaleString('pt-BR', options);
};

function BalanceAnalysisView({ kioskId, startPeriod, endPeriod, systemStartDate }: { kioskId: string; startPeriod: string | null; endPeriod: string | null; systemStartDate?: string; }) {
  const { history, loading: historyLoading } = useMovementHistory();
  const { products, loading: productsLoading } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const [selectedBaseIds, setSelectedBaseIds] = useState<string[]>([]);

  const loading = historyLoading || productsLoading || baseProductsLoading;

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const baseProductMap = useMemo(() => new Map(baseProducts.map(bp => [bp.id, bp])), [baseProducts]);

  const balancesData = useMemo(() => {
    if (selectedBaseIds.length === 0 || !startPeriod || !endPeriod || loading) return [];

    return selectedBaseIds.map(selectedBaseId => {
      const baseProduct = baseProductMap.get(selectedBaseId);
      if (!baseProduct) return null;

      const startDate = startOfDay(parseISO(startPeriod));
      const endDate = endOfDay(parseISO(endPeriod));

      const movements = history.filter(movement => {
        const product = productMap.get(movement.productId);
        if (!product || product.baseProductId !== selectedBaseId) return false;
        
        const movementDate = parseISO(movement.timestamp);
        const cutoff = systemStartDate ? startOfDay(parseISO(systemStartDate)) : null;

        if (!isValid(movementDate) || !isWithinInterval(movementDate, { start: startDate, end: endDate })) {
            return false;
        }

        if (cutoff && movementDate < cutoff) return false;

        if (kioskId !== 'all') {
            if (movement.fromKioskId !== kioskId && movement.toKioskId !== kioskId) {
                return false;
            }
        }
        return true;
      });

      const totals = {
          entradas: { compras: 0, transferencias: 0, ajustes: 0, total: 0 },
          saidas: { consumo: 0, transferencias: 0, descartes: 0, ajustes: 0, total: 0 },
          saldo: 0,
      };
      
      movements.forEach(movement => {
          const product = productMap.get(movement.productId);
          if (!product || product.baseProductId !== selectedBaseId) return;

          let qtyInBase = 0;
          try {
            // A quantidade da movimentação é em pacotes. Precisamos converter para a unidade base.
            // Se a unidade for 'un' ou similar, e o insumo base for volume/massa, usamos o packageSize como fator.
            const fromUnit = (product.unit || 'un').toLowerCase();
            const toUnit = (baseProduct.unit || '').toLowerCase();
            
            if (fromUnit === 'un' || fromUnit === 'unidade' || fromUnit === 'bag' || fromUnit === 'pacote' || fromUnit === 'caixa') {
                 // Fallback: se é uma unidade genérica, tratamos o packageSize como o valor absoluto na unidade base
                 qtyInBase = movement.quantityChange * (product.packageSize || 1);
            } else {
                 const valueOfOnePackage = convertValue(product.packageSize || 1, product.unit, baseProduct.unit, product.category);
                 qtyInBase = movement.quantityChange * valueOfOnePackage;
            }
          } catch(e) {
            // Último recurso: usar apenas o packageSize se a conversão falhar por categoria
            qtyInBase = movement.quantityChange * (product.packageSize || 1);
          }

          const isToKiosk = kioskId === 'all' || movement.toKioskId === kioskId;
          const isFromKiosk = kioskId === 'all' || movement.fromKioskId === kioskId;
          
          if (kioskId === 'all' && movement.type.includes('TRANSFERENCIA')) {
              return;
          }

          switch(movement.type) {
              case 'ENTRADA': if (isToKiosk) totals.entradas.compras += qtyInBase; break;
              case 'TRANSFERENCIA_ENTRADA': if (isToKiosk) totals.entradas.transferencias += qtyInBase; break;
              case 'ENTRADA_CORRECAO':
              case 'ENTRADA_ESTORNO': if (isToKiosk) totals.entradas.ajustes += qtyInBase; break;
              case 'SAIDA_CONSUMO': if (isFromKiosk) totals.saidas.consumo += qtyInBase; break;
              case 'SAIDA_DESCARTE_VENCIMENTO':
              case 'SAIDA_DESCARTE_AVARIA':
              case 'SAIDA_DESCARTE_PERDA':
              case 'SAIDA_DESCARTE_OUTROS': if (isFromKiosk) totals.saidas.descartes += qtyInBase; break;
              case 'TRANSFERENCIA_SAIDA': if (isFromKiosk) totals.saidas.transferencias += qtyInBase; break;
              case 'SAIDA_CORRECAO':
              case 'SAIDA_ESTORNO': if (isFromKiosk) totals.saidas.ajustes += qtyInBase; break;
          }
      });

      totals.entradas.total = totals.entradas.compras + totals.entradas.transferencias + totals.entradas.ajustes;
      totals.saidas.total = totals.saidas.consumo + totals.saidas.transferencias + totals.saidas.descartes + totals.saidas.ajustes;
      totals.saldo = totals.entradas.total - totals.saidas.total;

      return {
        baseProductId: selectedBaseId,
        baseProductName: baseProduct.name,
        totals,
        unit: baseProduct.unit
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  }, [selectedBaseIds, startPeriod, endPeriod, history, products, baseProducts, loading, productMap, baseProductMap, kioskId, systemStartDate]);
  
  const productOptions = useMemo(() => 
    baseProducts.sort((a,b) => a.name.localeCompare(b.name)).map(p => ({ value: p.id, label: p.name })),
  [baseProducts]);
  
  const formatValue = (value: number, unit: string) => {
    return `${formatNumber(value)} ${unit}`;
  };

  if (kioskId === 'all') {
    return (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <Inbox className="mx-auto h-12 w-12" />
            <p className="mt-4 font-semibold">Selecione uma unidade específica para ver o saldo.</p>
        </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">Analisar insumo(s):</span>
        <MultiSelect
            options={productOptions}
            selected={selectedBaseIds}
            onChange={setSelectedBaseIds}
            placeholder="Selecione um ou mais insumos..."
            className="w-full md:w-2/3"
        />
      </div>
      
      {loading && selectedBaseIds.length > 0 ? <Skeleton className="h-48 w-full" /> : 
       selectedBaseIds.length === 0 ? (
         <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <p className="font-semibold">Selecione um ou mais insumos para ver o saldo.</p>
        </div>
       ) :
       balancesData.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <Inbox className="mx-auto h-12 w-12" />
            <p className="mt-4 font-semibold">Nenhum dado encontrado para este insumo no período.</p>
        </div>
       ) : (
        <div className="space-y-6">
          {balancesData.map(balanceData => (
            <div key={balanceData.baseProductId} className="p-4 border rounded-lg">
              <h3 className="text-lg font-semibold mb-3">{balanceData.baseProductName}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-green-500/5 border-green-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-300"><TrendingUp /> Total de Entradas</CardTitle>
                  </CardHeader>
                  <CardContent>
                      <p className="text-2xl font-bold">{formatValue(balanceData.totals.entradas.total, balanceData.unit)}</p>
                      <Separator className="my-2"/>
                      <div className="text-xs text-muted-foreground space-y-1">
                          <p>Compras/Lançamentos: {formatValue(balanceData.totals.entradas.compras, balanceData.unit)}</p>
                          <p>Transferências: {formatValue(balanceData.totals.entradas.transferencias, balanceData.unit)}</p>
                          <p>Ajustes: {formatValue(balanceData.totals.entradas.ajustes, balanceData.unit)}</p>
                      </div>
                  </CardContent>
                </Card>
                <Card className="bg-red-500/5 border-red-500/20">
                  <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-300"><TrendingDown /> Total de Saídas</CardTitle>
                  </CardHeader>
                  <CardContent>
                      <p className="text-2xl font-bold">{formatValue(balanceData.totals.saidas.total, balanceData.unit)}</p>
                       <Separator className="my-2"/>
                       <div className="text-xs text-muted-foreground space-y-1">
                          <p>Consumo/Vendas: {formatValue(balanceData.totals.saidas.consumo, balanceData.unit)}</p>
                          <p>Transferências: {formatValue(balanceData.totals.saidas.transferencias, balanceData.unit)}</p>
                          <p>Descartes: {formatValue(balanceData.totals.saidas.descartes, balanceData.unit)}</p>
                           <p>Ajustes: {formatValue(balanceData.totals.saidas.ajustes, balanceData.unit)}</p>
                      </div>
                  </CardContent>
                </Card>
                <Card className={cn(
                    "border-2",
                    balanceData.totals.saldo > 0 && "border-green-500/30",
                    balanceData.totals.saldo < 0 && "border-red-500/30",
                )}>
                  <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2"><ArrowLeftRight /> Saldo do Período</CardTitle>
                  </CardHeader>
                   <CardContent>
                      <p className="text-2xl font-bold">{balanceData.totals.saldo > 0 ? '+' : ''}{formatValue(balanceData.totals.saldo, balanceData.unit)}</p>
                       <p className="text-xs text-muted-foreground">
                          {balanceData.totals.saldo > 0 ? 'O estoque aumentou neste período.' :
                           balanceData.totals.saldo < 0 ? 'O estoque diminuiu neste período.' :
                           'O estoque permaneceu estável.'
                          }
                      </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ))}
        </div>
       )
      }
    </div>
  );
}

function ComparisonAnalysisView({ kioskId, startPeriod, endPeriod, systemStartDate }: { kioskId: string; startPeriod: string | null; endPeriod: string | null; systemStartDate?: string; }) {
  const { history, loading: historyLoading } = useMovementHistory();
  const { products, loading: productsLoading } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { reports, isLoading: reportsLoading } = useValidatedConsumptionData();
  const [selectedBaseIds, setSelectedBaseIds] = useState<string[]>([]);

  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [consumptionModalOpen, setConsumptionModalOpen] = useState(false);
  const [activeBaseProduct, setActiveBaseProduct] = useState<BaseProduct | null>(null);
  const [modalFilters, setModalFilters] = useState<{
    type?: string;
    dateRange?: { from: Date; to: Date };
    kioskId?: string;
  }>({});

  const openHistory = (bpId: string, type?: string) => {
    const bp = baseProductMap.get(bpId);
    if (!bp) return;
    setActiveBaseProduct(bp);
    setModalFilters({
      type,
      kioskId: kioskId === 'all' ? undefined : kioskId,
      dateRange: startPeriod && endPeriod ? { from: parseISO(startPeriod), to: parseISO(endPeriod) } : undefined
    });
    setHistoryModalOpen(true);
  };

  const openConsumption = (bpId: string) => {
    const bp = baseProductMap.get(bpId);
    if (!bp) return;
    setActiveBaseProduct(bp);
    setConsumptionModalOpen(true);
  };

  const loading = historyLoading || productsLoading || baseProductsLoading || reportsLoading;

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const baseProductMap = useMemo(() => new Map(baseProducts.map(bp => [bp.id, bp])), [baseProducts]);

  const comparisonData = useMemo(() => {
    if (!startPeriod || !endPeriod || loading) return [];

    const baseList = selectedBaseIds.length > 0 
      ? baseProducts.filter(bp => selectedBaseIds.includes(bp.id))
      : baseProducts;

    const startDate = startOfDay(parseISO(startPeriod));
    const endDate = endOfDay(parseISO(endPeriod));

    return baseList.map(baseProduct => {
      // 1. Calcular Estoque Inicial (Saldo Anterior acumulado de todo o histórico)
      let estoqueInicial = 0;
      history.forEach(movement => {
        const product = productMap.get(movement.productId);
        if (!product || product.baseProductId !== baseProduct.id) return;
        
        const movementDate = parseISO(movement.timestamp);
        const cutoffDate = systemStartDate ? startOfDay(parseISO(systemStartDate)) : null;
        if (!isValid(movementDate) || movementDate >= startDate || (cutoffDate && movementDate < cutoffDate)) return;

        if (kioskId !== 'all') {
            if (movement.fromKioskId !== kioskId && movement.toKioskId !== kioskId) {
                return;
            }
        }

        let qtyInBase = 0;
        try {
          const fromUnit = (product.unit || 'un').toLowerCase();
          if (fromUnit === 'un' || fromUnit === 'unidade' || fromUnit === 'bag' || fromUnit === 'pacote' || fromUnit === 'caixa') {
              qtyInBase = (movement.quantityChange || 0) * (product.packageSize || 1);
          } else {
              const valueOfOnePackage = convertValue(product.packageSize || 0, product.unit, baseProduct.unit, product.category);
              qtyInBase = (movement.quantityChange || 0) * valueOfOnePackage;
          }
        } catch(e) {
          qtyInBase = (movement.quantityChange || 0) * (product.packageSize || 1);
        }

        const isToKiosk = kioskId === 'all' || movement.toKioskId === kioskId;
        const isFromKiosk = kioskId === 'all' || movement.fromKioskId === kioskId;
        
        if (kioskId === 'all' && movement.type.includes('TRANSFERENCIA')) return;

        if (movement.type.startsWith('ENTRADA') || movement.type === 'TRANSFERENCIA_ENTRADA') {
            if (isToKiosk) estoqueInicial += qtyInBase;
        } else if (movement.type.startsWith('SAIDA') || movement.type === 'TRANSFERENCIA_SAIDA' || movement.type.includes('Divergência')) {
            if (isFromKiosk) estoqueInicial -= qtyInBase;
        }
      });

      // 2. Calcular Vendas Teóricas (API)
      let theoreticalConsumption = 0;
      reports.forEach(report => {
        // Lógica de Data similar ao dashboard de vendas
        let dateMatch = false;
        const reportYear = report.year;
        const reportMonth = report.month;
        
        // Se o relatório tiver o campo 'day' (nem todos têm), usamos precisão diária
        // Caso contrário, usamos o mês inteiro
        if ((report as any).day) {
            const reportDate = new Date(reportYear, reportMonth - 1, (report as any).day);
            dateMatch = isWithinInterval(reportDate, { start: startDate, end: endDate }) || 
                        isSameDay(reportDate, startDate) || 
                        isSameDay(reportDate, endDate);
        } else {
            const reportMonthStart = new Date(reportYear, reportMonth - 1, 1);
            const reportMonthEnd = endOfMonth(reportMonthStart);
            // Verifica se há sobreposição entre o mês do relatório e o filtro do usuário
            dateMatch = (reportMonthStart <= endDate && reportMonthEnd >= startDate);
        }

        if (dateMatch) {
            if (kioskId === 'all' || report.kioskId === kioskId) {
                report.results.forEach(item => {
                    if (item.baseProductId === baseProduct.id) {
                        theoreticalConsumption += item.consumedQuantity;
                    }
                });
            }
        }
      });

      // 3. Calcular Movimentações Reais no Período
      const movementsInPeriod = history.filter(movement => {
        const product = productMap.get(movement.productId);
        if (!product || product.baseProductId !== baseProduct.id) return false;
        
        const movementDate = parseISO(movement.timestamp);
        const cutoff = systemStartDate ? startOfDay(parseISO(systemStartDate)) : null;

        if (!isValid(movementDate) || !isWithinInterval(movementDate, { start: startDate, end: endDate })) {
            return false;
        }

        if (cutoff && movementDate < cutoff) return false;

        if (kioskId !== 'all') {
            if (movement.fromKioskId !== kioskId && movement.toKioskId !== kioskId) {
                return false;
            }
        }
        return true;
      });

      const totals = {
          entradas: 0,
          saidas: 0,
          ajustes: 0, 
      };

      movementsInPeriod.forEach(movement => {
          const product = productMap.get(movement.productId);
          if (!product || product.baseProductId !== baseProduct.id) return;

          let qtyInBase = 0;
          try {
            const fromUnit = (product.unit || 'un').toLowerCase();
            if (fromUnit === 'un' || fromUnit === 'unidade' || fromUnit === 'bag' || fromUnit === 'pacote' || fromUnit === 'caixa') {
                qtyInBase = movement.quantityChange * (product.packageSize || 1);
            } else {
                const valueOfOnePackage = convertValue(product.packageSize || 1, product.unit, baseProduct.unit, product.category);
                qtyInBase = movement.quantityChange * valueOfOnePackage;
            }
          } catch(e) {
            qtyInBase = movement.quantityChange * (product.packageSize || 1);
          }

          const isToKiosk = kioskId === 'all' || movement.toKioskId === kioskId;
          const isFromKiosk = kioskId === 'all' || movement.fromKioskId === kioskId;
          
          if (kioskId === 'all' && movement.type.includes('TRANSFERENCIA')) {
              return;
          }

          const type = movement.type;
          
          // Entradas: Compras e Transferências de Entrada
          const isSupply = type === 'ENTRADA' || type === 'TRANSFERENCIA_ENTRADA';
          
          // Saídas: Consumo, Perdas, Descartes, Transferências de Saída, Estornos de Entrada
          const isRealExit = type.startsWith('SAIDA_CONSUMO') || 
                            type.startsWith('SAIDA_DESCARTE') || 
                            type === 'TRANSFERENCIA_SAIDA' || 
                            type === 'ENTRADA_ESTORNO';

          // Ajustes: Correções de Inventário e Divergências de Contagem
          const isAdjustment = type.includes('CORRECAO') || type.includes('Divergência');

          if (isAdjustment) {
              if (isToKiosk || isFromKiosk) totals.ajustes += qtyInBase;
          } else if (isSupply) {
              if (isToKiosk) totals.entradas += qtyInBase;
          } else if (isRealExit) {
              // We use Math.abs here for easier dashboard display of "Saidas" if needed, 
              // but for balance math we just sum signed qty.
              if (isFromKiosk) totals.saidas += Math.abs(qtyInBase);
          }
      });

      const divergence = theoreticalConsumption - totals.saidas;
      const estoqueFinal = (isNaN(estoqueInicial) ? 0 : estoqueInicial) + totals.entradas - totals.saidas;

      return {
        baseProductId: baseProduct.id,
        baseProductName: baseProduct.name,
        unit: baseProduct.unit,
        estoqueInicial,
        entradas: totals.entradas,
        saidasReais: totals.saidas,
        ajustes: totals.ajustes,
        vendasTeoricas: theoreticalConsumption,
        divergence: divergence,
        estoqueFinal
      };
    }).filter(d => d.entradas > 0 || d.saidasReais > 0 || d.vendasTeoricas > 0 || Math.abs(d.estoqueInicial) > 0)
      .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));
  }, [selectedBaseIds, startPeriod, endPeriod, history, products, baseProducts, reports, loading, productMap, kioskId, systemStartDate]);

  const productOptions = useMemo(() => 
    baseProducts.sort((a,b) => a.name.localeCompare(b.name)).map(p => ({ value: p.id, label: p.name })),
  [baseProducts]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">Filtrar por insumo(s):</span>
        <MultiSelect
            options={productOptions}
            selected={selectedBaseIds}
            onChange={setSelectedBaseIds}
            placeholder="Todos os insumos..."
            className="w-full md:w-2/3"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Insumo Base</TableHead>
              <TableHead className="text-right">Estoque Inicial</TableHead>
              <TableHead className="text-right">Entradas</TableHead>
              <TableHead className="text-right">Saídas (Sistema)</TableHead>
              <TableHead className="text-right">Vendas (API)</TableHead>
              <TableHead className="text-right">Divergência</TableHead>
              <TableHead className="text-right">Estoque Final</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparisonData.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Nenhum dado encontrado para o período/unidade selecionado.
                    </TableCell>
                </TableRow>
            ) : (
                comparisonData.map(row => (
                    <TableRow key={row.baseProductId}>
                        <TableCell className="font-medium">{row.baseProductName}</TableCell>
                        <TableCell className="text-right text-muted-foreground whitespace-nowrap">
                            {isNaN(row.estoqueInicial) ? (
                                <span className="text-[10px] text-orange-400 italic">Sem histórico</span>
                            ) : row.estoqueInicial === 0 ? (
                                <span className="text-[10px] text-muted-foreground italic">Sem dados anteriores</span>
                            ) : (
                                <button 
                                    onClick={() => openHistory(row.baseProductId)}
                                    className={cn("hover:underline text-right w-full", row.estoqueInicial < 0 && "text-red-500 font-semibold")}
                                >
                                    {formatNumber(row.estoqueInicial)}
                                </button>
                            )}
                        </TableCell>
                        <TableCell className="text-right">
                            <button 
                                onClick={() => openHistory(row.baseProductId, 'ENTRADA')}
                                className="text-green-600 hover:underline w-full text-right"
                            >
                                +{formatNumber(row.entradas)}
                            </button>
                        </TableCell>
                        <TableCell className="text-right">
                             <button 
                                onClick={() => openHistory(row.baseProductId, 'SAIDA')}
                                className="text-red-600 hover:underline w-full text-right"
                            >
                                -{formatNumber(row.saidasReais)}
                            </button>
                        </TableCell>
                        <TableCell className="text-right">
                            <button 
                                onClick={() => openConsumption(row.baseProductId)}
                                className="text-blue-600 hover:underline font-medium w-full text-right"
                            >
                                {formatNumber(row.vendasTeoricas)}
                            </button>
                        </TableCell>
                        <TableCell className={cn(
                            "text-right font-bold",
                            row.divergence < 0 ? "text-destructive" : row.divergence > 0 ? "text-green-600" : ""
                        )}>
                            {row.divergence > 0 ? '+' : ''}{formatNumber(row.divergence)}
                        </TableCell>
                        <TableCell className="text-right font-bold border-l">
                             <button 
                                onClick={() => openHistory(row.baseProductId)}
                                className="hover:underline w-full text-right"
                            >
                                {formatNumber(row.estoqueFinal)} {row.unit}
                            </button>
                        </TableCell>
                        <TableCell className="text-center">
                            {row.divergence === 0 ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    Ok
                                </span>
                            ) : (
                                <span className={cn(
                                    "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
                                    row.divergence < 0 ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"
                                )}>
                                    {row.divergence > 0 ? 'Sobra' : 'Falta'}
                                </span>
                            )}
                        </TableCell>
                    </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </div>

      <MovementHistoryModal 
        open={historyModalOpen} 
        onOpenChange={setHistoryModalOpen}
        initialBaseProductId={activeBaseProduct?.id}
        initialType={modalFilters.type}
        initialKioskId={modalFilters.kioskId}
        initialDateRange={modalFilters.dateRange}
      />

      <ConsumptionDetailsModal
        open={consumptionModalOpen}
        onOpenChange={setConsumptionModalOpen}
        baseProduct={activeBaseProduct}
        reports={reports}
      />
    </div>
  );
}


export function MovementAnalysis() {
    const [dateRange, setDateRange] = useState<{ start: string, end: string }>({
        start: '2026-03-01',
        end: format(new Date(), 'yyyy-MM-dd')
    });
    const [activePreset, setActivePreset] = useState<string>('custom');
    const systemStartDate = '2026-03-01';
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [kioskId, setKioskId] = useState<string>('all');
    const [view, setView] = useState<'cards' | 'saldo' | 'comparison'>('comparison');
    
    const { history, loading: historyLoading } = useMovementHistory();
    const { products, loading: productsLoading } = useProducts();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { kiosks, loading: kiosksLoading } = useKiosks();
    
    const loading = historyLoading || productsLoading || baseProductsLoading || kiosksLoading;
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

    const applyPreset = (preset: string) => {
        const today = new Date();
        let start = today;
        let end = today;

        switch (preset) {
            case 'today':
                start = end = today;
                break;
            case 'yesterday':
                start = end = subDays(today, 1);
                break;
            case '7d':
                start = subDays(today, 7);
                break;
            case '30d':
                start = subDays(today, 30);
                break;
            case 'thisMonth':
                start = startOfMonth(today);
                break;
            case 'lastMonth':
                const lastMonth = subMonths(today, 1);
                start = startOfMonth(lastMonth);
                end = endOfMonth(lastMonth);
                break;
        }

        setDateRange({
            start: format(start, 'yyyy-MM-dd'),
            end: format(end, 'yyyy-MM-dd')
        });
        setActivePreset(preset);
    };

    const startPeriod = dateRange.start;
    const endPeriod = dateRange.end;

    const productOptions = useMemo(() => 
        baseProducts.map(p => ({ value: p.id, label: p.name })),
    [baseProducts]);

    const cardData: TransferCardModel[] = useMemo(() => {
        if (loading || !startPeriod || !endPeriod) return [];

        const transferMovements = history.filter(h => h.type === 'TRANSFERENCIA_ENTRADA' && (kioskId === 'all' || h.toKioskId === kioskId));
        
        const monthlyTransfers = new Map<string, Map<string, number>>();
        const historicalTotals = new Map<string, number>();
        const monthsWithTransfers = new Map<string, Set<string>>();

        transferMovements.forEach(movement => {
            const product = productMap.get(movement.productId);
            if (!product || !product.baseProductId) return;

            const baseProduct = baseProducts.find(bp => bp.id === product.baseProductId);
            if (!baseProduct) return;
            
            let quantityInBaseUnit = 0;
            try {
                quantityInBaseUnit = convertValue(Number(movement.quantityChange), product.unit, baseProduct.unit, product.category);
            } catch {
                return;
            }

            const monthStr = format(parseISO(movement.timestamp), 'yyyy-MM');

            if (!monthlyTransfers.has(baseProduct.id)) {
                monthlyTransfers.set(baseProduct.id, new Map());
            }
            const monthMap = monthlyTransfers.get(baseProduct.id)!;
            monthMap.set(monthStr, (monthMap.get(monthStr) || 0) + quantityInBaseUnit);
            
            if (quantityInBaseUnit > 0) {
                if (!monthsWithTransfers.has(baseProduct.id)) {
                    monthsWithTransfers.set(baseProduct.id, new Set());
                }
                monthsWithTransfers.get(baseProduct.id)!.add(monthStr);
                historicalTotals.set(baseProduct.id, (historicalTotals.get(baseProduct.id) || 0) + quantityInBaseUnit);
            }
        });

        const historicalAverages = new Map<string, number>();
        historicalTotals.forEach((total, bpId) => {
            const monthsCount = monthsWithTransfers.get(bpId)?.size || 1;
            historicalAverages.set(bpId, total / monthsCount);
        });

        const baseList = selectedBaseProducts.length > 0 ? baseProducts.filter(bp => selectedBaseProducts.includes(bp.id)) : baseProducts;

        const start = startOfDay(parseISO(startPeriod));
        const end = endOfDay(parseISO(endPeriod));
        
        return baseList.map(bp => {
            const histAvg = historicalAverages.get(bp.id) || 0;
            const transfersInPeriod = Array.from((monthlyTransfers.get(bp.id) || new Map<string, number>()).entries())
                .filter(([monthStr,]) => {
                    const monthDate = parseISO(`${monthStr}-01`);
                    return isWithinInterval(monthDate, {start, end}) || isSameDay(monthDate, start) || isSameDay(monthDate, end);
                })
                .map(([label, value]): {label: string, value: number} => ({ label: format(parseISO(`${label}-01`), 'MMM/yy'), value }));
            
            const periodAvg = transfersInPeriod.length > 0
                ? transfersInPeriod.reduce((a,b) => a + b.value, 0) / transfersInPeriod.length
                : 0;

            const historicalChangePct = histAvg > 0 ? ((periodAvg / histAvg) - 1) * 100 : (periodAvg > 0 ? Infinity : 0);
            
            let periodChangePct = 0;
            if (transfersInPeriod.length >= 2) {
                const first = transfersInPeriod[0].value;
                const last = transfersInPeriod[transfersInPeriod.length - 1].value;
                periodChangePct = first > 0 ? ((last / first) - 1) * 100 : (last > 0 ? Infinity : 0);
            }

            let historicalStatus: TransferCardModel['historicalStatus'] = 'sem dados';
            if(histAvg > 0) {
                if (Math.abs(historicalChangePct) <= 15) {
                    historicalStatus = 'normal';
                } else {
                    historicalStatus = historicalChangePct > 0 ? 'acima' : 'abaixo';
                }
            }

            const allMonthlyValues = Array.from(monthlyTransfers.get(bp.id)?.values() || []);
            const deviation = stdDev(allMonthlyValues);
            let volatility: TransferCardModel['volatility'] = 'N/A';
            if (histAvg > 0) {
                const cv = deviation / histAvg;
                if (cv > 0.5) volatility = 'Alta';
                else if (cv > 0.2) volatility = 'Média';
                else volatility = 'Baixa';
            }

            const representativeProduct = products.find(p => p.baseProductId === bp.id);

            return {
                id: bp.id, name: bp.name, unit: bp.unit,
                series: transfersInPeriod, periodAvg, histAvg,
                periodChangePct, historicalChangePct, historicalStatus,
                volatility,
                representativeProduct,
            };
        }).filter(d => d.periodAvg > 0 || d.histAvg > 0)
          .sort((a,b) => (b.periodAvg * Math.abs(b.periodChangePct)) - (a.periodAvg * Math.abs(a.periodChangePct)));

    }, [loading, startPeriod, endPeriod, kioskId, selectedBaseProducts, history, products, baseProducts, productMap, systemStartDate]);


    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <Card>
            <CardContent className="pt-6">
               <div className="space-y-4">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                      <div className="flex items-start gap-4">
                          <div className="flex flex-col gap-1.5">
                              <Label htmlFor="kiosk-select">Unidade</Label>
                              <Select value={kioskId} onValueChange={setKioskId}>
                                  <SelectTrigger id="kiosk-select" className="h-10 w-full md:w-[200px]">
                                      <SelectValue placeholder="Selecione a unidade" />
                                  </SelectTrigger>
                                  <SelectContent>
                                      <SelectItem value="all">Todas as Unidades</SelectItem>
                                      {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                                  </SelectContent>
                              </Select>
                          </div>
                          <div className="flex flex-col gap-1.5 min-w-[300px]">
                              <Label>Período</Label>
                              <div className="flex flex-wrap items-center gap-2">
                                  <ToggleGroup type="single" value={activePreset} onValueChange={v => v && applyPreset(v)} className="bg-muted p-1 rounded-lg border h-10">
                                      <ToggleGroupItem value="today" className="px-3 text-xs">Hoje</ToggleGroupItem>
                                      <ToggleGroupItem value="yesterday" className="px-3 text-xs">Ontem</ToggleGroupItem>
                                      <ToggleGroupItem value="7d" className="px-3 text-xs">7D</ToggleGroupItem>
                                      <ToggleGroupItem value="30d" className="px-3 text-xs">30D</ToggleGroupItem>
                                      <ToggleGroupItem value="thisMonth" className="px-3 text-xs">Mês</ToggleGroupItem>
                                      <ToggleGroupItem value="custom" className="px-3 text-xs">Personalizado</ToggleGroupItem>
                                  </ToggleGroup>
                                  {activePreset === 'custom' && (
                                      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 transition-all">
                                          <Input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="h-10 text-sm w-36" />
                                          <span className="text-muted-foreground text-xs font-bold">ATÉ</span>
                                          <Input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="h-10 text-sm w-36" />
                                      </div>
                                  )}
                              </div>
                          </div>
                           <div className="flex flex-col gap-1.5 border-l pl-4 justify-center">
                               <div className="bg-orange-50 border border-orange-100 px-3 py-1.5 rounded-md">
                                   <p className="text-[10px] text-orange-600 font-bold uppercase tracking-wider">Marco Zero da Auditoria</p>
                                   <p className="text-sm font-bold text-orange-700">01/03/2026</p>
                               </div>
                           </div>
                      </div>
                      <div className="flex-shrink-0">
                          <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v as any)}}>
                              <ToggleGroupItem value="comparison" className="text-xs">Vendas vs Estoque</ToggleGroupItem>
                              <ToggleGroupItem value="saldo" className="text-xs">Saldo Movimentado</ToggleGroupItem>
                              <ToggleGroupItem value="cards" className="text-xs">Análise de Tendência</ToggleGroupItem>
                          </ToggleGroup>
                      </div>
                  </div>
                  {view === 'cards' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="product-multiselect">Filtrar por insumos</Label>
                      <div className="flex gap-2 items-center">
                          <MultiSelect
                              options={productOptions}
                              selected={selectedBaseProducts}
                              onChange={setSelectedBaseProducts}
                              placeholder="Selecione os insumos ou deixe em branco para ver todos"
                              className="w-full"
                          />
                      </div>
                    </div>
                  )}
               </div>

                {view === 'cards' && (
                    <div className="mt-6">
                        {cardData.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {cardData.map(data => <TransferCard key={data.id} data={data} />)}
                            </div>
                        ) : (
                            <div className="flex h-64 flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                                <Inbox className="h-12 w-12 mb-2"/>
                                <p>Nenhum dado de transferência encontrado para os filtros selecionados.</p>
                            </div>
                        )}
                    </div>
                )}
                 {view === 'saldo' && (
                    <div className="mt-6">
                        <BalanceAnalysisView kioskId={kioskId} startPeriod={startPeriod} endPeriod={endPeriod} systemStartDate={systemStartDate} />
                    </div>
                 )}
                 {view === 'comparison' && (
                    <div className="mt-6">
                        <ComparisonAnalysisView kioskId={kioskId} startPeriod={startPeriod} endPeriod={endPeriod} systemStartDate={systemStartDate} />
                    </div>
                 )}
            </CardContent>
        </Card>
    );
}
