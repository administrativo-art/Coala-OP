
"use client";

import { useMemo, useState, useEffect, useCallback } from "react"
import { format, startOfMonth, addMonths, isWithinInterval, parseISO, endOfMonth } from "date-fns"
import { ptBR } from 'date-fns/locale'

// Hooks
import { useMovementHistory } from "@/hooks/use-movement-history";
import { useProducts } from "@/hooks/use-products";
import { useKiosks } from "@/hooks/use-kiosks";
import { useBaseProducts } from "@/hooks/use-base-products";
import { convertValue } from '@/lib/conversion';

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select"
import { MultiSelect } from "@/components/ui/multi-select"
import { Inbox, Truck, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LineChart, Line, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Product } from "@/types";


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
  const periodIcon = data.periodChangePct > 5 ? TrendingUp : data.periodChangePct < -5 ? TrendingDown : Minus;
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
  
  const formatDisplayQuantity = (baseQuantity: number) => {
    if (!data.representativeProduct || baseQuantity === 0) {
        return `${baseQuantity.toFixed(1)} ${data.unit}`;
    }

    const { representativeProduct, unit: baseUnit } = data;
    const { packageSize, unit: contentUnit, category, packageType, rotulo_caixa, multiplo_caixa } = representativeProduct;

    try {
        const unitsPerPackage = convertValue(packageSize, contentUnit, baseUnit, category);
        if (unitsPerPackage <= 0) return `${baseQuantity.toFixed(1)} ${baseUnit}`;
        
        const numPackages = baseQuantity / unitsPerPackage;

        // Display in boxes if available
        if (multiplo_caixa && multiplo_caixa > 0 && rotulo_caixa) {
            const numBoxes = numPackages / multiplo_caixa;
            return `${numBoxes.toFixed(1)} ${rotulo_caixa}(s)`;
        }
        
        // Display in packages if packageType is meaningful
        if (packageType && packageType.toLowerCase() !== 'unidade' && packageType.toLowerCase() !== 'un') {
             return `${numPackages.toFixed(1)} ${packageType}(s)`;
        }

        // Fallback to base unit
        return `${baseQuantity.toFixed(1)} ${baseUnit}`;

    } catch (e) {
        return `${baseQuantity.toFixed(1)} ${baseUnit}`;
    }
  };


  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold leading-tight line-clamp-2">{data.name} ({data.unit})</CardTitle>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className={cn("text-4xl font-bold flex items-center gap-2", periodColor)}>
          <periodIcon className="h-8 w-8" />
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
       <CardFooter className="flex-col items-start gap-1 text-xs text-muted-foreground border-t pt-2 pb-3">
        <div className="flex justify-between w-full"><span>Média Transferida (Período):</span><span className="font-semibold">{formatDisplayQuantity(data.periodAvg)}/mês</span></div>
        <div className="flex justify-between w-full"><span>Média Histórica (Total):</span><span className="font-semibold">{formatDisplayQuantity(data.histAvg)}/mês</span></div>
      </CardFooter>
    </Card>
  )
}

function UnitAnalysisView({ kioskId, startPeriod, endPeriod }: { kioskId: string; startPeriod: string | null; endPeriod: string | null; }) {
  const { history, loading: historyLoading } = useMovementHistory();
  const { products, loading: productsLoading } = useProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);

  const loading = historyLoading || productsLoading || baseProductsLoading || kiosksLoading;

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const baseProductMap = useMemo(() => new Map(baseProducts.map(bp => [bp.id, bp])), [baseProducts]);

  const rankingData = useMemo(() => {
    if (!selectedBaseId || !startPeriod || !endPeriod || loading) return [];

    const baseProduct = baseProductMap.get(selectedBaseId);
    if (!baseProduct) return [];

    const startDate = startOfMonth(parseISO(`${startPeriod}-01`));
    const endDate = endOfMonth(parseISO(`${endPeriod}-01`));

    const transfersByKiosk = new Map<string, number>();

    history.forEach(movement => {
      const product = productMap.get(movement.productId);
      if (
        movement.type === 'TRANSFERENCIA_ENTRADA' &&
        product?.baseProductId === selectedBaseId &&
        movement.toKioskId &&
        isWithinInterval(parseISO(movement.timestamp), { start: startDate, end: endDate })
      ) {
        let quantityInBaseUnit = 0;
        try {
          quantityInBaseUnit = convertValue(movement.quantityChange, product.unit, baseProduct.unit, product.category);
        } catch { return; }
        
        transfersByKiosk.set(movement.toKioskId, (transfersByKiosk.get(movement.toKioskId) || 0) + quantityInBaseUnit);
      }
    });

    return Array.from(transfersByKiosk.entries())
      .map(([kioskId, total]) => ({
        kioskName: kiosks.find(k => k.id === kioskId)?.name || 'Desconhecido',
        total,
        unit: baseProduct.unit,
      }))
      .sort((a, b) => b.total - a.total);

  }, [selectedBaseId, startPeriod, endPeriod, history, products, baseProducts, kiosks, loading, productMap, baseProductMap]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">Analisar insumo:</span>
        <Select onValueChange={setSelectedBaseId} value={selectedBaseId || ''}>
          <SelectTrigger className="w-full md:w-1/3">
            <SelectValue placeholder="Selecione um insumo..." />
          </SelectTrigger>
          <SelectContent>
            {baseProducts.map(bp => (
              <SelectItem key={bp.id} value={bp.id}>{bp.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      {loading && selectedBaseId ? <Skeleton className="h-48 w-full" /> : 
       selectedBaseId && rankingData.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ranking de Recebimento</CardTitle>
            <CardDescription>Unidades que mais receberam "{baseProductMap.get(selectedBaseId)?.name}" no período.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Total Recebido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankingData.map(data => (
                  <TableRow key={data.kioskName}>
                    <TableCell className="font-medium">{data.kioskName}</TableCell>
                    <TableCell className="text-right font-bold">{data.total.toFixed(2)} {data.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : selectedBaseId ? (
         <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <Inbox className="mx-auto h-12 w-12" />
            <p className="mt-4 font-semibold">Nenhuma transferência encontrada para este insumo no período.</p>
        </div>
      ) : (
         <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <p className="font-semibold">Selecione um insumo para ver a análise por unidade.</p>
        </div>
      )}
    </div>
  );
}


export function MovementAnalysis() {
    const [startPeriod, setStartPeriod] = useState<string | null>(null);
    const [endPeriod, setEndPeriod] = useState<string | null>(null);
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [kioskId, setKioskId] = useState<string>('all');
    
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
        return Array.from(periods).sort((a,b) => b.localeCompare(a));
    }, [history, loading]);

    useEffect(() => {
        if (!loading && availablePeriods.length > 0) {
            if (!endPeriod) setEndPeriod(availablePeriods[0]);
            if (!startPeriod) {
                const defaultStartIndex = Math.min(2, availablePeriods.length - 1);
                setStartPeriod(availablePeriods[defaultStartIndex]);
            }
        }
    }, [availablePeriods, loading, startPeriod, endPeriod]);

    const handleStartPeriodChange = (value: string) => {
        setStartPeriod(value);
        if (endPeriod && value > endPeriod) {
            setEndPeriod(value);
        }
    };

    const handleEndPeriodChange = (value: string) => {
        setEndPeriod(value);
        if (startPeriod && value < startPeriod) {
            setStartPeriod(value);
        }
    };
    
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
                quantityInBaseUnit = convertValue(movement.quantityChange, product.unit, baseProduct.unit, product.category);
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

            const representativeProduct = products.find(p => p.baseProductId === bp.id);

            return {
                id: bp.id, name: bp.name, unit: bp.unit,
                series: transfersInPeriod, periodAvg, histAvg,
                periodChangePct, historicalChangePct, historicalStatus,
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
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Truck /> Análise de movimentações</CardTitle>
                <CardDescription>Visualize o fluxo de entrada de insumos nas unidades por período.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="by-item" className="w-full">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                        <TabsList>
                            <TabsTrigger value="by-item">Análise por Insumo</TabsTrigger>
                            <TabsTrigger value="by-unit">Análise por Unidade</TabsTrigger>
                        </TabsList>
                        <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                            <Select value={kioskId} onValueChange={setKioskId}>
                                <SelectTrigger className="w-full md:w-[200px]">
                                    <SelectValue placeholder="Selecione a unidade" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as Unidades</SelectItem>
                                    {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            
                            <div className="flex items-center gap-2">
                                <Select value={startPeriod || ""} onValueChange={handleStartPeriodChange} disabled={availablePeriods.length === 0}>
                                    <SelectTrigger className="w-full md:w-[150px]">
                                        <SelectValue placeholder="Início" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availablePeriods.map(p => (
                                            <SelectItem key={`start-${p}`} value={p}>
                                                {format(parseISO(`${p}-01`), 'MMM/yy', { locale: ptBR })}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <span className="text-muted-foreground">-</span>
                                <Select value={endPeriod || ""} onValueChange={handleEndPeriodChange} disabled={availablePeriods.length === 0}>
                                    <SelectTrigger className="w-full md:w-[150px]">
                                        <SelectValue placeholder="Fim" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availablePeriods.map(p => (
                                            <SelectItem key={`end-${p}`} value={p} disabled={!!startPeriod && p < startPeriod}>
                                                {format(parseISO(`${p}-01`), 'MMM/yy', { locale: ptBR })}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <TabsContent value="by-item" className="space-y-4">
                        <MultiSelect
                            options={productOptions}
                            selected={selectedBaseProducts}
                            onChange={setSelectedBaseProducts}
                            placeholder="Filtrar por insumos..."
                            className="w-full"
                        />
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
                    </TabsContent>
                    <TabsContent value="by-unit">
                        <UnitAnalysisView kioskId={kioskId} startPeriod={startPeriod} endPeriod={endPeriod} />
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}
