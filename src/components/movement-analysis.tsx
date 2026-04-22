"use client";

import React, { useMemo, useState, useEffect } from "react"
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
import { Inbox, Truck, TrendingUp, TrendingDown, Minus, CalendarDays, Package, Wrench, ArrowLeftRight, Filter, AlertTriangle } from "lucide-react";
import { LineChart, Line, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Product } from "@/types";
import { Separator } from "./ui/separator";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

const stdDev = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
};

const GENERIC_PACKAGE_UNITS = new Set(['un', 'unidade', 'bag', 'pacote', 'caixa']);
const AUDIT_ZERO_DATE = '2026-04-01';

function getMovementQuantityInBaseUnit(
  movement: Pick<MovementRecord, 'quantityChange'>,
  product: Product,
  baseProduct: BaseProduct,
) {
  const quantity = Number(movement.quantityChange || 0);
  if (!Number.isFinite(quantity)) return 0;

  try {
    const fromUnit = (product.unit || 'un').toLowerCase();
    if (GENERIC_PACKAGE_UNITS.has(fromUnit)) {
      return quantity * Number(product.packageSize || 1);
    }

    const valueOfOnePackage = convertValue(
      Number(product.packageSize || 1),
      product.unit,
      baseProduct.unit,
      product.category,
    );

    return quantity * valueOfOnePackage;
  } catch {
    return quantity * Number(product.packageSize || 1);
  }
}

function getSignedAdjustmentDelta(type: string, quantityInBase: number) {
  if (!quantityInBase) return 0;
  if (type === 'ENTRADA_CORRECAO' || type === 'ENTRADA_ESTORNO' || type.includes('acréscimo')) {
    return quantityInBase;
  }

  if (
    type === 'SAIDA_CORRECAO' ||
    type === 'SAIDA_ESTORNO' ||
    type.includes('decréscimo') ||
    type.includes('Divergência')
  ) {
    return -quantityInBase;
  }

  return 0;
}

function getConsumptionReportDate(report: ConsumptionReport) {
  if (typeof report.day === 'number') {
    return new Date(report.year, report.month - 1, report.day);
  }

  const idMatch = report.id.match(/(\d{4})_(\d{2})_(\d{2})$/);
  if (idMatch) {
    return new Date(Number(idMatch[1]), Number(idMatch[2]) - 1, Number(idMatch[3]));
  }

  const nameMatch = report.reportName?.match(/(\d{4})-(\d{2})-(\d{2})$/);
  if (nameMatch) {
    return new Date(Number(nameMatch[1]), Number(nameMatch[2]) - 1, Number(nameMatch[3]));
  }

  return null;
}

function rangeFullyCoversMonth(startDate: Date, endDate: Date, monthDate: Date) {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);

  return startDate <= monthStart && endDate >= monthEnd;
}

function getMovementDate(timestamp: unknown) {
  if (!timestamp) return null;

  if (timestamp instanceof Date) {
    return isValid(timestamp) ? timestamp : null;
  }

  if (typeof timestamp === 'string') {
    const parsed = parseISO(timestamp);
    return isValid(parsed) ? parsed : null;
  }

  if (typeof timestamp === 'object' && timestamp !== null) {
    const candidate = timestamp as { toDate?: () => Date };
    if (typeof candidate.toDate === 'function') {
      const converted = candidate.toDate();
      return isValid(converted) ? converted : null;
    }
  }

  return null;
}

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

type ComparisonFilter = 'all' | 'faltas' | 'sobras' | 'ajustes';

type ComparisonRow = {
  baseProductId: string;
  baseProductName: string;
  unit: string;
  estoqueInicial: number;
  entradas: number;
  saidasReais: number;
  ajustes: number;
  vendasTeoricas: number;
  divergence: number;
  estoqueFinal: number;
};

function getComparisonStatusMeta(divergence: number) {
  if (divergence === 0) {
    return {
      label: 'Ok',
      textClass: 'text-emerald-700 dark:text-emerald-400',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800',
      helper: 'Estoque e consumo teórico alinhados no período.',
    };
  }

  if (divergence > 0) {
    return {
      label: 'Sobra',
      textClass: 'text-green-700 dark:text-green-400',
      badgeClass: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800',
      helper: 'A venda teórica ficou abaixo da baixa registrada no sistema.',
    };
  }

  return {
    label: 'Falta',
    textClass: 'text-rose-700 dark:text-rose-400',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:border-rose-800',
    helper: 'A venda teórica superou a baixa registrada no sistema.',
  };
}

function SummaryMetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'danger' | 'success' | 'warning';
}) {
  const toneClasses = {
    default: 'border-border/60 bg-card',
    danger: 'border-rose-200 bg-rose-50/80 dark:border-rose-900/60 dark:bg-rose-950/20',
    success: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/60 dark:bg-emerald-950/20',
    warning: 'border-amber-200 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/20',
  }[tone];

  const iconTone = {
    default: 'text-primary',
    danger: 'text-rose-600 dark:text-rose-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
  }[tone];

  return (
    <Card className={cn("shadow-sm", toneClasses)}>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{helper}</p>
        </div>
        <div className={cn("rounded-full border border-current/10 bg-background/70 p-2", iconTone)}>
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownLine({
  label,
  value,
  unit,
  tone = 'default',
}: {
  label: string;
  value: number;
  unit: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  const valueClass = {
    default: 'text-foreground',
    positive: 'text-green-700 dark:text-green-400',
    negative: 'text-rose-700 dark:text-rose-400',
  }[tone];

  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-background/60 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", valueClass)}>
        {formatNumber(value)} {unit}
      </span>
    </div>
  );
}

function ComparisonRowCard({
  row,
  onOpenHistory,
  onOpenConsumption,
}: {
  row: ComparisonRow;
  onOpenHistory: (baseProductId: string) => void;
  onOpenConsumption: (baseProductId: string) => void;
}) {
  const status = getComparisonStatusMeta(row.divergence);

  return (
    <Card className="shadow-sm">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base leading-tight">{row.baseProductName}</CardTitle>
            <CardDescription>{row.unit} • leitura consolidada do período</CardDescription>
          </div>
          <Badge className={cn("border", status.badgeClass)}>{status.label}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenHistory(row.baseProductId)}>
            Histórico
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onOpenConsumption(row.baseProductId)}>
            Consumo API
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estoque inicial</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatNumber(row.estoqueInicial)} {row.unit}</p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estoque final</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{formatNumber(row.estoqueFinal)} {row.unit}</p>
          </div>
        </div>

        <div className="space-y-2">
          <BreakdownLine label="Entradas" value={row.entradas} unit={row.unit} tone="positive" />
          <BreakdownLine label="Saídas (Sistema)" value={row.saidasReais} unit={row.unit} tone="negative" />
          <BreakdownLine label="Ajustes" value={row.ajustes} unit={row.unit} tone={row.ajustes >= 0 ? 'positive' : 'negative'} />
          <BreakdownLine label="Vendas (API)" value={row.vendasTeoricas} unit={row.unit} />
        </div>

        <div className="rounded-xl border bg-background px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Divergência do período</p>
              <p className={cn("mt-1 text-xl font-bold tabular-nums", status.textClass)}>
                {row.divergence > 0 ? '+' : ''}{formatNumber(row.divergence)} {row.unit}
              </p>
            </div>
            <Badge className={cn("border", status.badgeClass)}>{status.label}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{status.helper}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BalanceAnalysisView({ kioskId, startPeriod, endPeriod, systemStartDate }: { kioskId: string; startPeriod: string | null; endPeriod: string | null; systemStartDate?: string | null; }) {
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
        
        const movementDate = getMovementDate(movement.timestamp);
        const cutoff = systemStartDate ? startOfDay(parseISO(systemStartDate)) : null;

        if (!movementDate || !isWithinInterval(movementDate, { start: startDate, end: endDate })) {
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

          const qtyInBase = getMovementQuantityInBaseUnit(movement, product, baseProduct);

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
    [...baseProducts].sort((a,b) => a.name.localeCompare(b.name)).map(p => ({ value: p.id, label: p.name })),
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
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Package className="h-4 w-4 text-primary" />
          <span>Analisar insumo(s)</span>
        </div>
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
            <Package className="mx-auto h-10 w-10" />
            <p className="mt-4 font-semibold">Selecione um ou mais insumos para ver o saldo movimentado.</p>
            <p className="mt-2 text-sm text-muted-foreground">Você pode comparar vários insumos ao mesmo tempo usando o filtro acima.</p>
        </div>
       ) :
       balancesData.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <Inbox className="mx-auto h-12 w-12" />
            <p className="mt-4 font-semibold">Nenhum dado encontrado para este insumo no período.</p>
            <p className="mt-2 text-sm">Revise a unidade, o período ou selecione outro insumo para continuar.</p>
        </div>
       ) : (
        <div className="space-y-6">
          {balancesData.map(balanceData => (
            <div key={balanceData.baseProductId} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <h3 className="text-lg font-semibold">{balanceData.baseProductName}</h3>
                <Badge variant="outline">{balanceData.unit}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-green-500/5 border-green-500/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-300"><TrendingUp /> Total de Entradas</CardTitle>
                  </CardHeader>
                  <CardContent>
                      <p className="text-2xl font-bold">{formatValue(balanceData.totals.entradas.total, balanceData.unit)}</p>
                      <Separator className="my-3"/>
                      <div className="space-y-2">
                          <BreakdownLine label="Compras/Lançamentos" value={balanceData.totals.entradas.compras} unit={balanceData.unit} />
                          <BreakdownLine label="Transferências" value={balanceData.totals.entradas.transferencias} unit={balanceData.unit} />
                          <BreakdownLine label="Ajustes" value={balanceData.totals.entradas.ajustes} unit={balanceData.unit} tone="positive" />
                      </div>
                  </CardContent>
                </Card>
                <Card className="bg-red-500/5 border-red-500/20">
                  <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2 text-red-700 dark:text-red-300"><TrendingDown /> Total de Saídas</CardTitle>
                  </CardHeader>
                  <CardContent>
                      <p className="text-2xl font-bold">{formatValue(balanceData.totals.saidas.total, balanceData.unit)}</p>
                       <Separator className="my-3"/>
                       <div className="space-y-2">
                          <BreakdownLine label="Consumo/Vendas" value={balanceData.totals.saidas.consumo} unit={balanceData.unit} />
                          <BreakdownLine label="Transferências" value={balanceData.totals.saidas.transferencias} unit={balanceData.unit} />
                          <BreakdownLine label="Descartes" value={balanceData.totals.saidas.descartes} unit={balanceData.unit} />
                          <BreakdownLine label="Ajustes" value={balanceData.totals.saidas.ajustes} unit={balanceData.unit} tone="negative" />
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

function ComparisonAnalysisView({ kioskId, startPeriod, endPeriod, systemStartDate }: { kioskId: string; startPeriod: string | null; endPeriod: string | null; systemStartDate?: string | null; }) {
  const { history, loading: historyLoading } = useMovementHistory();
  const { products, loading: productsLoading } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { reports, isLoading: reportsLoading } = useValidatedConsumptionData();
  const [selectedBaseIds, setSelectedBaseIds] = useState<string[]>([]);
  const [quickFilter, setQuickFilter] = useState<ComparisonFilter>('all');

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

  const comparisonSummary = useMemo(() => {
    if (!startPeriod || !endPeriod || loading) {
      return {
        rows: [],
        hasPartialMonthlyCoverageGap: false,
      };
    }

    const baseList = selectedBaseIds.length > 0 
      ? baseProducts.filter(bp => selectedBaseIds.includes(bp.id))
      : baseProducts;

    const startDate = startOfDay(parseISO(startPeriod));
    const endDate = endOfDay(parseISO(endPeriod));
    let hasPartialMonthlyCoverageGap = false;

    const rows = baseList.map(baseProduct => {
      // 1. Calcular Estoque Inicial (Saldo Anterior acumulado de todo o histórico)
      let estoqueInicial = 0;
      history.forEach(movement => {
        const product = productMap.get(movement.productId);
        if (!product || product.baseProductId !== baseProduct.id) return;
        
        const movementDate = getMovementDate(movement.timestamp);
        const cutoffDate = systemStartDate ? startOfDay(parseISO(systemStartDate)) : null;
        if (!movementDate || movementDate >= startDate || (cutoffDate && movementDate < cutoffDate)) return;

        if (kioskId !== 'all') {
            if (movement.fromKioskId !== kioskId && movement.toKioskId !== kioskId) {
                return;
            }
        }

        const qtyInBase = getMovementQuantityInBaseUnit(movement, product, baseProduct);

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
        let dateMatch = false;
        const reportDate = getConsumptionReportDate(report);

        if (reportDate) {
          dateMatch = isWithinInterval(reportDate, { start: startDate, end: endDate });
        } else {
          const reportMonthStart = new Date(report.year, report.month - 1, 1);
          const reportMonthEnd = endOfMonth(reportMonthStart);

          if (rangeFullyCoversMonth(startDate, endDate, reportMonthStart)) {
            dateMatch = true;
          } else if (reportMonthStart <= endDate && reportMonthEnd >= startDate) {
            hasPartialMonthlyCoverageGap = true;
          }
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
        
        const movementDate = getMovementDate(movement.timestamp);
        const cutoff = systemStartDate ? startOfDay(parseISO(systemStartDate)) : null;

        if (!movementDate || !isWithinInterval(movementDate, { start: startDate, end: endDate })) {
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

          const qtyInBase = getMovementQuantityInBaseUnit(movement, product, baseProduct);

          const isToKiosk = kioskId === 'all' || movement.toKioskId === kioskId;
          const isFromKiosk = kioskId === 'all' || movement.fromKioskId === kioskId;
          
          if (kioskId === 'all' && movement.type.includes('TRANSFERENCIA')) {
              return;
          }

          const type = movement.type;
          
          // Entradas: Compras e Transferências de Entrada
          const isSupply = type === 'ENTRADA' || type === 'TRANSFERENCIA_ENTRADA';
          
          // Saídas operacionais: Consumo, Perdas, Descartes e Transferências de Saída
          const isRealExit = type.startsWith('SAIDA_CONSUMO') || 
                            type.startsWith('SAIDA_DESCARTE') || 
                            type === 'TRANSFERENCIA_SAIDA';

          // Ajustes: Correções, Divergências e Estornos
          const isAdjustment = type.includes('CORRECAO') || type.includes('Divergência') || type.includes('ESTORNO');

          if (isAdjustment) {
              if (isToKiosk || isFromKiosk) {
                totals.ajustes += getSignedAdjustmentDelta(type, qtyInBase);
              }
          } else if (isSupply) {
              if (isToKiosk) totals.entradas += qtyInBase;
          } else if (isRealExit) {
              if (isFromKiosk) totals.saidas += Math.abs(qtyInBase);
          }
      });

      const divergence = theoreticalConsumption - totals.saidas + totals.ajustes;
      const estoqueFinal = (isNaN(estoqueInicial) ? 0 : estoqueInicial) + totals.entradas - totals.saidas + totals.ajustes;

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
    }).filter(d => d.entradas > 0 || d.saidasReais > 0 || d.vendasTeoricas > 0 || Math.abs(d.estoqueInicial) > 0 || Math.abs(d.ajustes) > 0)
      .sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));

    return {
      rows,
      hasPartialMonthlyCoverageGap,
    };
  }, [selectedBaseIds, startPeriod, endPeriod, history, baseProducts, reports, loading, productMap, kioskId, systemStartDate]);

  const productOptions = useMemo(() => 
    [...baseProducts].sort((a,b) => a.name.localeCompare(b.name)).map(p => ({ value: p.id, label: p.name })),
  [baseProducts]);

  const displayedRows = useMemo(() => {
    return comparisonSummary.rows.filter((row): row is ComparisonRow => {
      if (quickFilter === 'faltas') return row.divergence < 0;
      if (quickFilter === 'sobras') return row.divergence > 0;
      if (quickFilter === 'ajustes') return row.ajustes !== 0;
      return true;
    });
  }, [comparisonSummary.rows, quickFilter]);

  const summaryCards = useMemo(() => {
    const faltas = displayedRows.filter(row => row.divergence < 0);
    const sobras = displayedRows.filter(row => row.divergence > 0);
    const ajustes = displayedRows.filter(row => row.ajustes !== 0);
    const netDivergence = displayedRows.reduce((total, row) => total + row.divergence, 0);
    const maxDivergence = displayedRows.reduce<ComparisonRow | null>((current, row) => {
      if (!current || Math.abs(row.divergence) > Math.abs(current.divergence)) return row;
      return current;
    }, null);

    return {
      faltas: faltas.length,
      sobras: sobras.length,
      ajustes: ajustes.length,
      netDivergence,
      maxDivergence,
    };
  }, [displayedRows]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryMetricCard
          label="Insumos com falta"
          value={String(summaryCards.faltas)}
          helper="Itens em que o consumo teórico superou a baixa registrada."
          icon={TrendingDown}
          tone={summaryCards.faltas > 0 ? 'danger' : 'default'}
        />
        <SummaryMetricCard
          label="Insumos com sobra"
          value={String(summaryCards.sobras)}
          helper="Itens em que a baixa registrada superou o consumo teórico."
          icon={TrendingUp}
          tone={summaryCards.sobras > 0 ? 'success' : 'default'}
        />
        <SummaryMetricCard
          label="Itens com ajuste"
          value={String(summaryCards.ajustes)}
          helper="Movimentações com correção, divergência de turno ou estorno no período."
          icon={Wrench}
          tone={summaryCards.ajustes > 0 ? 'warning' : 'default'}
        />
        <SummaryMetricCard
          label="Divergência líquida"
          value={`${summaryCards.netDivergence > 0 ? '+' : ''}${formatNumber(summaryCards.netDivergence)}`}
          helper={summaryCards.maxDivergence ? `Maior desvio: ${summaryCards.maxDivergence.baseProductName}` : 'Sem desvios relevantes no período.'}
          icon={ArrowLeftRight}
          tone={summaryCards.netDivergence < 0 ? 'danger' : summaryCards.netDivergence > 0 ? 'success' : 'default'}
        />
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Package className="h-4 w-4 text-primary" />
              <span>Filtrar por insumo(s)</span>
            </div>
            <div className="max-w-3xl">
              <MultiSelect
                  options={productOptions}
                  selected={selectedBaseIds}
                  onChange={setSelectedBaseIds}
                  placeholder="Todos os insumos..."
                  className="w-full"
              />
            </div>
          </div>
          <div className="space-y-2 lg:max-w-xl">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Filter className="h-4 w-4 text-primary" />
              <span>Recorte rápido</span>
            </div>
            <ToggleGroup
              type="single"
              value={quickFilter}
              onValueChange={(value) => value && setQuickFilter(value as ComparisonFilter)}
              className="flex flex-wrap justify-start rounded-lg border bg-muted/30 p-1"
            >
              <ToggleGroupItem value="all" className="text-xs">Todos</ToggleGroupItem>
              <ToggleGroupItem value="faltas" className="text-xs">Só faltas</ToggleGroupItem>
              <ToggleGroupItem value="sobras" className="text-xs">Só sobras</ToggleGroupItem>
              <ToggleGroupItem value="ajustes" className="text-xs">Com ajustes</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </div>

      {comparisonSummary.hasPartialMonthlyCoverageGap && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>Período parcial com consumo mensal</AlertTitle>
          <AlertDescription>
            Alguns relatórios de consumo não têm granularidade diária. Para evitar superestimar o período, eles foram ignorados neste comparativo.
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        Compare as baixas do sistema com o consumo teórico vindo da API. Números sublinhados abrem o histórico ou o detalhamento do consumo do insumo.
      </div>

      {displayedRows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed py-16 text-center text-muted-foreground">
          <Inbox className="mx-auto h-12 w-12" />
          <p className="mt-4 font-semibold">Nenhum insumo encontrado para os filtros selecionados.</p>
          <p className="mt-2 text-sm">Tente ampliar o período, remover o recorte rápido ou limpar o filtro de insumos.</p>
        </div>
      ) : (
        <>
          <div className="space-y-4 md:hidden">
            {displayedRows.map((row) => (
              <ComparisonRowCard
                key={row.baseProductId}
                row={row}
                onOpenHistory={(baseProductId) => openHistory(baseProductId)}
                onOpenConsumption={openConsumption}
              />
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead rowSpan={2} className="min-w-[240px]">Insumo Base</TableHead>
                  <TableHead colSpan={2} className="text-center">Estoque</TableHead>
                  <TableHead colSpan={3} className="text-center">Movimentação</TableHead>
                  <TableHead colSpan={2} className="text-center">Venda x Resultado</TableHead>
                  <TableHead rowSpan={2} className="text-center">Status</TableHead>
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right">Inicial</TableHead>
                  <TableHead className="text-right">Final</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas (Sistema)</TableHead>
                  <TableHead className="text-right">Ajustes</TableHead>
                  <TableHead className="text-right">Vendas (API)</TableHead>
                  <TableHead className="text-right">Divergência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedRows.map(row => {
                  const status = getComparisonStatusMeta(row.divergence);

                  return (
                    <TableRow key={row.baseProductId}>
                      <TableCell className="align-top">
                        <div className="space-y-2">
                          <div>
                            <p className="font-semibold leading-tight">{row.baseProductName}</p>
                            <p className="text-xs text-muted-foreground">{row.unit} • comparativo do período</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => openHistory(row.baseProductId)}
                              className="text-xs font-medium text-primary underline decoration-dotted underline-offset-4"
                            >
                              Ver histórico
                            </button>
                            <button
                              onClick={() => openConsumption(row.baseProductId)}
                              className="text-xs font-medium text-blue-600 underline decoration-dotted underline-offset-4"
                            >
                              Ver consumo API
                            </button>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground whitespace-nowrap">
                        {isNaN(row.estoqueInicial) ? (
                          <span className="text-[10px] text-orange-400 italic">Sem histórico</span>
                        ) : row.estoqueInicial === 0 ? (
                          <span className="text-[10px] text-muted-foreground italic">Sem dados anteriores</span>
                        ) : (
                          <button
                            onClick={() => openHistory(row.baseProductId)}
                            className={cn("font-medium underline decoration-dotted underline-offset-4", row.estoqueInicial < 0 && "text-red-500")}
                          >
                            {formatNumber(row.estoqueInicial)}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold border-l">
                        <button
                          onClick={() => openHistory(row.baseProductId)}
                          className="font-semibold underline decoration-dotted underline-offset-4"
                        >
                          {formatNumber(row.estoqueFinal)} {row.unit}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => openHistory(row.baseProductId, 'ENTRADA')}
                          className="text-green-600 underline decoration-dotted underline-offset-4"
                        >
                          +{formatNumber(row.entradas)}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => openHistory(row.baseProductId, 'SAIDA')}
                          className="text-red-600 underline decoration-dotted underline-offset-4"
                        >
                          -{formatNumber(row.saidasReais)}
                        </button>
                      </TableCell>
                      <TableCell className={cn(
                        "text-right",
                        row.ajustes > 0 ? "text-green-600" : row.ajustes < 0 ? "text-red-600" : "text-muted-foreground"
                      )}>
                        <button
                          onClick={() => openHistory(row.baseProductId, 'AJUSTE')}
                          className="underline decoration-dotted underline-offset-4"
                        >
                          {row.ajustes > 0 ? '+' : ''}{formatNumber(row.ajustes)}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => openConsumption(row.baseProductId)}
                          className="text-blue-600 font-medium underline decoration-dotted underline-offset-4"
                        >
                          {formatNumber(row.vendasTeoricas)}
                        </button>
                      </TableCell>
                      <TableCell className={cn("text-right font-bold", status.textClass)}>
                        {row.divergence > 0 ? '+' : ''}{formatNumber(row.divergence)}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-2">
                          <Badge className={cn("border", status.badgeClass)}>{status.label}</Badge>
                          <span className="max-w-[170px] text-[11px] leading-relaxed text-muted-foreground">{status.helper}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

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
        start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
        end: format(new Date(), 'yyyy-MM-dd')
    });
    const [activePreset, setActivePreset] = useState<string>('custom');
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [kioskId, setKioskId] = useState<string>('all');
    const [view, setView] = useState<'cards' | 'saldo' | 'comparison'>('comparison');
    const [cardsSortMode, setCardsSortMode] = useState<'impact' | 'volume' | 'history'>('impact');
    const [hasInitializedCustomRange, setHasInitializedCustomRange] = useState(false);
    
    const { history, loading: historyLoading } = useMovementHistory();
    const { products, loading: productsLoading } = useProducts();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { kiosks, loading: kiosksLoading } = useKiosks();
    
    const loading = historyLoading || productsLoading || baseProductsLoading || kiosksLoading;
    const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
    const baseProductMap = useMemo(() => new Map(baseProducts.map(bp => [bp.id, bp])), [baseProducts]);
    const systemStartDate = AUDIT_ZERO_DATE;

    useEffect(() => {
        if (loading || hasInitializedCustomRange || !systemStartDate) return;

        setDateRange(prev => ({
            start: systemStartDate,
            end: prev.end,
        }));
        setHasInitializedCustomRange(true);
    }, [loading, hasInitializedCustomRange, systemStartDate]);

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
    const selectedKioskName = kioskId === 'all' ? 'Todas as unidades' : kiosks.find(k => k.id === kioskId)?.name ?? kioskId;
    const periodLabel = startPeriod && endPeriod
      ? `${format(parseISO(startPeriod), 'dd/MM/yyyy')} até ${format(parseISO(endPeriod), 'dd/MM/yyyy')}`
      : 'Sem período selecionado';

    const viewMeta = {
      comparison: {
        title: 'Comparativo operacional',
        description: 'Cruza vendas teóricas, movimentos reais e estoque final para expor falta, sobra e ajustes.',
      },
      saldo: {
        title: 'Saldo movimentado',
        description: 'Mostra como compras, transferências, descartes e ajustes alteraram o saldo do insumo no período.',
      },
      cards: {
        title: 'Tendência de transferências',
        description: 'Resume comportamento de abastecimento por insumo para destacar volume, oscilação e desvios históricos.',
      },
    }[view];

    const productOptions = useMemo(() => 
        [...baseProducts]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(p => ({ value: p.id, label: p.name })),
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

            const baseProduct = baseProductMap.get(product.baseProductId);
            if (!baseProduct) return;
            
            const quantityInBaseUnit = getMovementQuantityInBaseUnit(movement, product, baseProduct);
            if (!quantityInBaseUnit) return;

            const movementDate = getMovementDate(movement.timestamp);
            if (!movementDate) return;

            const monthStr = format(movementDate, 'yyyy-MM');

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
                    return monthDate <= end && endOfMonth(monthDate) >= start;
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
        }).filter(d => d.periodAvg > 0 || d.histAvg > 0);

    }, [loading, startPeriod, endPeriod, kioskId, selectedBaseProducts, history, products, baseProducts, productMap, baseProductMap]);

    const sortedCardData = useMemo(() => {
        return [...cardData].sort((a, b) => {
            if (cardsSortMode === 'volume') {
                return b.periodAvg - a.periodAvg;
            }

            if (cardsSortMode === 'history') {
                return Math.abs(b.historicalChangePct) - Math.abs(a.historicalChangePct);
            }

            return (b.periodAvg * Math.abs(b.periodChangePct)) - (a.periodAvg * Math.abs(a.periodChangePct));
        });
    }, [cardData, cardsSortMode]);


    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <Card>
            <CardContent className="pt-6">
               <div className="space-y-5">
                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="gap-1">
                            <Truck className="h-3.5 w-3.5" />
                            {viewMeta.title}
                          </Badge>
                          <Badge variant="secondary" className="gap-1">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {periodLabel}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-lg font-semibold tracking-tight">{selectedKioskName}</p>
                          <p className="text-sm text-muted-foreground">{viewMeta.description}</p>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px]">
                        <Card className="border-border/60 bg-card shadow-none">
                          <CardContent className="p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Leitura ativa</p>
                            <p className="mt-1 text-base font-semibold">{viewMeta.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {view === 'comparison' ? 'Foco em divergência entre vendas, baixas e estoque.' :
                               view === 'saldo' ? 'Foco em entradas, saídas e saldo consolidado.' :
                               'Foco em abastecimento e padrão histórico de transferências.'}
                            </p>
                          </CardContent>
                        </Card>
                        <Card className="border-amber-200 bg-amber-50/80 shadow-none dark:border-amber-900/60 dark:bg-amber-950/20">
                          <CardContent className="p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Marco zero da auditoria</p>
                            <p className="mt-1 text-base font-semibold text-amber-800 dark:text-amber-100">
                              {systemStartDate ? format(parseISO(systemStartDate), 'dd/MM/yyyy') : 'Sem histórico'}
                            </p>
                            <p className="text-xs text-amber-700/80 dark:text-amber-200/80">Movimentos anteriores a essa data ficam fora da leitura atual.</p>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                      <div className="grid flex-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="kiosk-select">Unidade</Label>
                          <Select value={kioskId} onValueChange={setKioskId}>
                              <SelectTrigger id="kiosk-select" className="h-10 w-full">
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
                          <div className="flex flex-wrap items-center gap-2">
                              <ToggleGroup type="single" value={activePreset} onValueChange={v => v && applyPreset(v)} className="flex flex-wrap justify-start bg-muted p-1 rounded-lg border min-h-10">
                                  <ToggleGroupItem value="today" className="px-3 text-xs">Hoje</ToggleGroupItem>
                                  <ToggleGroupItem value="yesterday" className="px-3 text-xs">Ontem</ToggleGroupItem>
                                  <ToggleGroupItem value="7d" className="px-3 text-xs">7D</ToggleGroupItem>
                                  <ToggleGroupItem value="30d" className="px-3 text-xs">30D</ToggleGroupItem>
                                  <ToggleGroupItem value="thisMonth" className="px-3 text-xs">Mês</ToggleGroupItem>
                                  <ToggleGroupItem value="custom" className="px-3 text-xs">Personalizado</ToggleGroupItem>
                              </ToggleGroup>
                              {activePreset === 'custom' && (
                                  <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-left-2 transition-all">
                                      <Input type="date" value={dateRange.start} onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))} className="h-10 text-sm w-40" />
                                      <span className="text-muted-foreground text-xs font-bold">ATÉ</span>
                                      <Input type="date" value={dateRange.end} onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))} className="h-10 text-sm w-40" />
                                  </div>
                              )}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 xl:w-auto">
                        <Label>Modo de leitura</Label>
                        <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v as any)}} className="flex flex-wrap justify-start rounded-lg border bg-muted/30 p-1">
                          <ToggleGroupItem value="comparison" className="text-xs">Vendas vs Estoque</ToggleGroupItem>
                          <ToggleGroupItem value="saldo" className="text-xs">Saldo Movimentado</ToggleGroupItem>
                          <ToggleGroupItem value="cards" className="text-xs">Tendência de Transferências</ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                    </div>

                    {view === 'cards' && (
                      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="space-y-1.5">
                          <Label htmlFor="product-multiselect">Filtrar por insumos</Label>
                          <MultiSelect
                              options={productOptions}
                              selected={selectedBaseProducts}
                              onChange={setSelectedBaseProducts}
                              placeholder="Selecione os insumos ou deixe em branco para ver todos"
                              className="w-full"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="cards-sort">Ordenar cards</Label>
                          <Select value={cardsSortMode} onValueChange={(value) => setCardsSortMode(value as typeof cardsSortMode)}>
                            <SelectTrigger id="cards-sort" className="h-10">
                              <SelectValue placeholder="Ordenar por" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="impact">Maior impacto</SelectItem>
                              <SelectItem value="volume">Maior volume</SelectItem>
                              <SelectItem value="history">Maior desvio histórico</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
               </div>

                {view === 'cards' && (
                    <div className="mt-6">
                        {sortedCardData.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {sortedCardData.map(data => <TransferCard key={data.id} data={data} />)}
                            </div>
                        ) : (
                            <div className="flex h-64 flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                                <Inbox className="h-12 w-12 mb-2"/>
                                <p>Nenhum dado de transferência encontrado para os filtros selecionados.</p>
                                <p className="mt-2 text-sm">Tente ampliar o período, mudar a unidade ou limpar o filtro de insumos.</p>
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
