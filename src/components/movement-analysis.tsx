
"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react"
import { format, startOfMonth, addMonths, isWithinInterval, parseISO, endOfMonth, subMonths, startOfYear, isValid } from "date-fns"
import { ptBR } from 'date-fns/locale'

// Hooks
import { useMovementHistory } from "@/hooks/use-movement-history";
import { useProducts } from "@/hooks/use-products";
import { useKiosks } from "@/hooks/use-kiosks";
import { useBaseProducts } from "@/hooks/use-base-products";
import { convertValue } from '@/lib/conversion';

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Skeleton } from "./ui/skeleton"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select"
import { Inbox, Truck, TrendingUp, TrendingDown, Minus, CalendarDays, ChevronLeft, ChevronRight, Package, Wrench, ArrowLeftRight, Filter } from "lucide-react";
import { LineChart, Line, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Product } from "@/types";
import { Separator } from "./ui/separator";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";
import { MultiSelect } from "./ui/multi-select";

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
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'hsl(var(--primary))', strokeWidth: 1, strokeDasharray: '3 3' }}/>
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

function BalanceAnalysisView({ kioskId, startPeriod, endPeriod }: { kioskId: string; startPeriod: string | null; endPeriod: string | null; }) {
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

      const startDate = startOfMonth(parseISO(`${startPeriod}-01`));
      const endDate = endOfMonth(parseISO(`${endPeriod}-01`));

      const movements = history.filter(movement => {
        const product = productMap.get(movement.productId);
        if (!product || product.baseProductId !== selectedBaseId) return false;
        
        const movementDate = parseISO(movement.timestamp);
        if (!isValid(movementDate) || !isWithinInterval(movementDate, { start: startDate, end: endDate })) {
            return false;
        }

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
            const valueOfOnePackage = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
            qtyInBase = movement.quantityChange * valueOfOnePackage;
          } catch(e) {
            console.error(`Could not convert units for product ${product.id}`, e);
            return; // Pula esta movimentação se a conversão falhar
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
  }, [selectedBaseIds, startPeriod, endPeriod, history, products, baseProducts, loading, productMap, baseProductMap, kioskId]);
  
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

type YearMonth = { year: number, month: number }; // 1-based month

const compareYearMonth = (a: YearMonth, b: YearMonth) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
};

const formatYearMonth = (ym: YearMonth) => {
    return format(new Date(ym.year, ym.month - 1), 'MMM/yy', { locale: ptBR });
}

function MonthPicker({
    value,
    onChange,
    disabledMonths,
}: {
    value: YearMonth;
    onChange: (newValue: YearMonth) => void;
    disabledMonths?: (date: YearMonth) => boolean;
}) {
    const [viewYear, setViewYear] = useState(value.year);
    const months = Array.from({ length: 12 }, (_, i) => i + 1);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setViewYear(y => y - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <span className="font-semibold">{viewYear}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setViewYear(y => y + 1)} disabled={viewYear >= new Date().getFullYear()}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-3 gap-1">
                {months.map(month => {
                    const monthDate = { year: viewYear, month };
                    const isDisabled = disabledMonths ? disabledMonths(monthDate) : false;
                    const isSelected = value.year === viewYear && value.month === month;
                    return (
                        <Button
                            key={month}
                            variant={isSelected ? 'default' : 'ghost'}
                            size="sm"
                            className="h-8"
                            disabled={isDisabled}
                            onClick={() => onChange(monthDate)}
                        >
                            {format(new Date(viewYear, month - 1), 'MMM', { locale: ptBR })}
                        </Button>
                    );
                })}
            </div>
        </div>
    );
}

function PeriodRangePicker({
    value,
    onChange,
    availablePeriods
}: {
    value: { from: YearMonth, to: YearMonth };
    onChange: (newValue: { from: YearMonth, to: YearMonth }) => void;
    availablePeriods: YearMonth[];
}) {
    const [open, setOpen] = useState(false);
    const [activePicker, setActivePicker] = useState<'from' | 'to'>('from');

    const handleMonthSelect = (ym: YearMonth) => {
        let newPeriod = { ...value };
        if (activePicker === 'from') {
            newPeriod.from = ym;
            if (compareYearMonth(ym, newPeriod.to) > 0) {
                newPeriod.to = ym; // Auto-swap
            }
            setActivePicker('to'); // Move to next picker
        } else {
            newPeriod.to = ym;
            if (compareYearMonth(newPeriod.from, ym) > 0) {
                newPeriod.from = ym; // Auto-swap
            }
            setOpen(false); // Close on second selection
        }
        onChange(newPeriod);
    };
    
    const handlePreset = (preset: '3m' | '6m' | '12m' | 'ytd') => {
        const today = new Date();
        const lastFullMonth = subMonths(today, 1);
        let fromDate: Date;

        switch(preset) {
            case '3m': fromDate = subMonths(lastFullMonth, 2); break;
            case '6m': fromDate = subMonths(lastFullMonth, 5); break;
            case '12m': fromDate = subMonths(lastFullMonth, 11); break;
            case 'ytd': fromDate = startOfYear(today); break;
        }

        const newPeriod = {
            from: { year: fromDate.getFullYear(), month: fromDate.getMonth() + 1 },
            to: { year: lastFullMonth.getFullYear(), month: lastFullMonth.getMonth() + 1 }
        };
        onChange(newPeriod);
        setOpen(false);
    }
    
    const disabledMonthCheck = (date: YearMonth) => {
        const today = new Date();
        const currentYm = { year: today.getFullYear(), month: today.getMonth() + 1 };
        return compareYearMonth(date, currentYm) >= 0;
    }


    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 w-full md:w-[250px] justify-start text-left font-normal gap-2">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    <span>{formatYearMonth(value.from)}</span>
                    <span className="text-muted-foreground">-</span>
                    <span>{formatYearMonth(value.to)}</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 flex" align="start">
                 <div className="p-2 border-r">
                    <div className="flex flex-col gap-1">
                        <Button variant="ghost" className="justify-start" onClick={() => handlePreset('3m')}>Últimos 3 meses</Button>
                        <Button variant="ghost" className="justify-start" onClick={() => handlePreset('6m')}>Últimos 6 meses</Button>
                        <Button variant="ghost" className="justify-start" onClick={() => handlePreset('12m')}>Últimos 12 meses</Button>
                        <Button variant="ghost" className="justify-start" onClick={() => handlePreset('ytd')}>Este ano</Button>
                    </div>
                </div>
                <div className="p-3 grid grid-cols-2 gap-3">
                    <div>
                        <div className="text-center text-sm font-semibold mb-2 py-1.5 border-b-2" style={{ borderColor: activePicker === 'from' ? 'hsl(var(--primary))' : 'transparent' }}>De</div>
                        <MonthPicker value={value.from} onChange={handleMonthSelect} disabledMonths={disabledMonthCheck} />
                    </div>
                     <div>
                        <div className="text-center text-sm font-semibold mb-2 py-1.5 border-b-2" style={{ borderColor: activePicker === 'to' ? 'hsl(var(--primary))' : 'transparent' }}>Até</div>
                        <MonthPicker value={value.to} onChange={handleMonthSelect} disabledMonths={disabledMonthCheck} />
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function MovementAnalysis() {
    const [period, setPeriod] = useState<{ from: YearMonth, to: YearMonth } | null>(null);
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [kioskId, setKioskId] = useState<string>('all');
    const [view, setView] = useState<'cards' | 'saldo'>('cards');
    
    const { history, loading: historyLoading } = useMovementHistory();
    const { products, loading: productsLoading } = useProducts();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { kiosks, loading: kiosksLoading } = useKiosks();
    
    const loading = historyLoading || productsLoading || baseProductsLoading || kiosksLoading;
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

    const availablePeriods = useMemo(() => {
        if (loading) return [];
        const periods = new Set<string>();
        history.forEach(record => {
            if (record.timestamp) {
                periods.add(format(parseISO(record.timestamp), 'yyyy-MM'));
            }
        });
        return Array.from(periods)
            .map(p => {
                const [year, month] = p.split('-').map(Number);
                return { year, month };
            })
            .sort((a,b) => (b.year - a.year) || (b.month - a.month));
    }, [history, loading]);

     useEffect(() => {
        if (!loading && availablePeriods.length > 0 && !period) {
            const to = availablePeriods[0];
            const from = availablePeriods[Math.min(2, availablePeriods.length - 1)];
            setPeriod({ from, to });
        }
    }, [availablePeriods, loading, period]);

    const { startPeriod, endPeriod } = useMemo(() => {
        if (!period) return { startPeriod: null, endPeriod: null };
        return {
            startPeriod: `${period.from.year}-${String(period.from.month).padStart(2, '0')}`,
            endPeriod: `${period.to.year}-${String(period.to.month).padStart(2, '0')}`
        };
    }, [period]);

    const productOptions = useMemo(() => 
        baseProducts.map(p => ({ value: p.id, label: p.name })),
    [baseProducts]);

    const cardData: TransferCardModel[] = useMemo(() => {
        if (loading || !startPeriod || !endPeriod) return [];

        const transferMovements = history.filter(h => h.type === 'TRANSFERENCIA_ENTRADA' && (kioskId === 'all' || h.toKioskId === kioskId));
        
        const monthlyTransfers = new Map<string, Map<string, number>>(); // Map<baseProductId, Map<monthStr, quantity>>
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

        const [startYear, startMonth] = startPeriod.split('-').map(Number);
        const [endYear, endMonth] = endPeriod.split('-').map(Number);
        
        const start = startOfMonth(new Date(startYear, startMonth - 1, 1));
        const end = endOfMonth(new Date(endYear, endMonth - 1, 1));
        
        return baseList.map(bp => {
            const histAvg = historicalAverages.get(bp.id) || 0;
            const transfersInPeriod = Array.from(monthlyTransfers.get(bp.id)?.entries() || [])
                .filter(([monthStr,]) => {
                    const monthDate = parseISO(`${monthStr}-01`);
                    return isWithinInterval(monthDate, {start, end});
                })
                .map(([label, value]) => ({ label: format(parseISO(`${label}-01`), 'MMM/yy'), value }));
            
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
                const cv = deviation / histAvg; // Coefficient of Variation
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
        }).filter(d => d.periodAvg > 0 || d.histAvg > 0) // Only show cards with some data
          .sort((a,b) => (b.periodAvg * Math.abs(b.periodChangePct)) - (a.periodAvg * Math.abs(a.periodChangePct)));

    }, [loading, startPeriod, endPeriod, kioskId, selectedBaseProducts, history, products, baseProducts, productMap]);


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
                          <div className="flex flex-col gap-1.5">
                              <Label>Período</Label>
                              {period && (
                              <PeriodRangePicker
                                  value={period}
                                  onChange={setPeriod}
                                  availablePeriods={availablePeriods.map(p => ({ year: p.year, month: p.month }))}
                              />
                              )}
                          </div>
                      </div>
                      <div className="flex-shrink-0">
                          <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v as any)}}>
                              <ToggleGroupItem value="cards">Análise por Insumo</ToggleGroupItem>
                              <ToggleGroupItem value="saldo">Saldo</ToggleGroupItem>
                          </ToggleGroup>
                      </div>
                  </div>
                  {view === 'cards' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="product-multiselect">Filtrar por insumos</Label>
                      <div className="flex gap-2 items-center">
                          <MultiSelect
                              id="product-multiselect"
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
                        <BalanceAnalysisView kioskId={kioskId} startPeriod={startPeriod} endPeriod={endPeriod} />
                    </div>
                 )}
            </CardContent>
        </Card>
    );
}

    

    
