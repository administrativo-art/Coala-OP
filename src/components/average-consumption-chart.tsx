"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { format, startOfMonth, addMonths, isWithinInterval, parseISO, endOfMonth } from "date-fns"
import { ptBR } from 'date-fns/locale'

// Hooks
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData"
import { useProducts } from "@/hooks/use-products"
import { useKiosks } from "@/hooks/use-kiosks"

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Skeleton } from "@/components/ui/skeleton"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { TrendingUp, TrendingDown, Minus, Inbox, Check, BarChart3, ChevronsUpDown, Repeat } from 'lucide-react'
import { cn } from "@/lib/utils"
import { Badge } from "./ui/badge"
import { type BaseProduct } from "@/types"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { MultiSelect } from "@/components/ui/multi-select"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from "./ui/button"
import { ConsumptionComparisonModal } from "./consumption-comparison-modal"


const stdDev = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
};

const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

type CardModel = {
  id: string;
  name: string;
  unit: string;
  series: { label: string; value: number }[];
  periodAvg: number;
  histAvg: number;
  periodChangePct: number;
  historicalChangePct: number;
  historicalStatus: 'normal' | 'acima' | 'abaixo' | 'sem dados';
  volatility: 'Alta' | 'Média' | 'Baixa' | 'N/A';
  abcClass: 'A' | 'B' | null;
  alertState: 'alert' | 'attention' | 'ok' | 'no_data';
};


function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="p-2 bg-background/80 border rounded-md shadow-lg">
        <p className="text-xs font-bold">{label}</p>
        <p className="text-sm text-primary">{`Consumo: ${payload[0].value.toFixed(1)}`}</p>
      </div>
    );
  }
  return null;
}


function ConsumptionCard({ data, onCompareClick }: { data: CardModel, onCompareClick: (data: CardModel) => void }) {
  const periodIcon = data.periodChangePct > 5 ? TrendingUp : data.periodChangePct < -5 ? TrendingDown : Minus;
  const periodColor = data.periodChangePct > 5 ? "text-destructive" : data.periodChangePct < -5 ? "text-green-600" : "text-muted-foreground";

  let historicalText, historicalColor;
  switch(data.historicalStatus) {
      case 'acima':
          historicalText = `${data.historicalChangePct.toFixed(0)}% acima do padrão histórico`;
          historicalColor = "text-destructive";
          break;
      case 'abaixo':
           historicalText = `${Math.abs(data.historicalChangePct).toFixed(0)}% abaixo do padrão histórico`;
           historicalColor = "text-green-600";
           break;
      case 'normal':
           historicalText = "Dentro do padrão histórico";
           historicalColor = "text-muted-foreground";
           break;
      default:
           historicalText = "Histórico de consumo insuficiente";
           historicalColor = "text-muted-foreground";
  }

  const volatilityText = {
      'Alta': 'Consumo imprevisível',
      'Média': 'Consumo com variações',
      'Baixa': 'Padrão de consumo estável',
      'N/A': 'Não aplicável'
  }[data.volatility];

  const stateStyles = {
    alert: 'border-destructive/40 bg-destructive/5',
    attention: 'border-orange-500/40 bg-orange-500/5',
    ok: 'border-border',
    no_data: 'border-border'
  };

  return (
    <Card className={cn("flex flex-col h-full", stateStyles[data.alertState])}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
            <CardTitle className="text-base font-semibold leading-tight line-clamp-2">{data.name} ({data.unit})</CardTitle>
            <div className="flex items-center gap-1">
                {data.abcClass && <Badge variant={data.abcClass === 'A' ? 'destructive' : 'secondary'} className={cn(data.abcClass === 'A' && 'bg-primary/90')}>{`Curva ${data.abcClass}`}</Badge>}
                <TooltipProvider>
                    <UITooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={(e) => {e.stopPropagation(); onCompareClick(data);}}>
                                <Repeat className="h-4 w-4"/>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Comparar com Transferências</p>
                        </TooltipContent>
                    </UITooltip>
                </TooltipProvider>
            </div>
        </div>
      </CardHeader>
      <CardContent className="flex-grow">
        <div className={cn("text-4xl font-bold flex items-center gap-2", periodColor)}>
          <periodIcon className="h-8 w-8" />
          <span>{data.periodChangePct.toFixed(0)}%</span>
        </div>
         <p className="text-xs text-muted-foreground">Variação no período</p>
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
        <div className="flex justify-between w-full"><span>Média Período:</span><span className="font-semibold">{data.periodAvg.toFixed(1)}/mês</span></div>
        <div className="flex justify-between w-full"><span>Média Histórica:</span><span className="font-semibold">{data.histAvg.toFixed(1)}/mês</span></div>
        <div className="flex justify-between w-full"><span>Volatilidade:</span><span className="font-semibold">{volatilityText}</span></div>
      </CardFooter>
    </Card>
  )
}


export function AverageConsumptionChart() {
    // State
    const [startPeriod, setStartPeriod] = useState<string | null>(null);
    const [endPeriod, setEndPeriod] = useState<string | null>(null);
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [view, setView] = useState<'cards' | 'chart'>('cards');
    const [kioskId, setKioskId] = useState<string>('all');
    const [comparisonModalData, setComparisonModalData] = useState<{
      open: boolean;
      baseProduct: BaseProduct | null;
    }>({ open: false, baseProduct: null });


    // Data Hooks
    const { reports: consumptionReports, isLoading: consumptionLoading, baseProducts, integrityReport } = useValidatedConsumptionData();
    const { loading: productsLoading } = useProducts();
    const { kiosks, loading: kiosksLoading } = useKiosks();

    const loading = consumptionLoading || productsLoading || kiosksLoading;
    
    const availablePeriods = useMemo(() => {
        if (loading) return [];
        const periods = new Set<string>();
        consumptionReports.forEach(report => {
            periods.add(`${report.year}-${String(report.month).padStart(2, '0')}`);
        });
        return Array.from(periods).sort((a,b) => b.localeCompare(a));
    }, [consumptionReports, loading]);

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
    
    const { monthlyConsumptions, historicalAverages, abcClasses, deviations } = useMemo(() => {
        if (loading) return { monthlyConsumptions: new Map(), historicalAverages: new Map(), abcClasses: { A: [], B: [] }, deviations: new Map() };

        const kioskFilteredReports = kioskId === 'all' 
            ? consumptionReports 
            : consumptionReports.filter(r => r.kioskId === kioskId);

        const consumptions = new Map<string, Map<string, number>>(); // Map<baseProductId, Map<monthStr, quantity>>
        const totals = new Map<string, number>();
        const monthsWithConsumption = new Map<string, Set<string>>();
        let totalNetworkConsumption = 0;
        const consumptionByProduct = new Map<string, number>();

        kioskFilteredReports.forEach(report => {
            const monthStr = `${report.year}-${String(report.month).padStart(2, '0')}`;
            report.results.forEach(item => {
                if (!item.baseProductId) return;
                
                if (!consumptions.has(item.baseProductId)) {
                    consumptions.set(item.baseProductId, new Map());
                }
                const monthMap = consumptions.get(item.baseProductId)!;
                monthMap.set(monthStr, (monthMap.get(monthStr) || 0) + item.consumedQuantity);
                
                if (!monthsWithConsumption.has(item.baseProductId)) {
                    monthsWithConsumption.set(item.baseProductId, new Set());
                }
                if (item.consumedQuantity > 0) {
                    monthsWithConsumption.get(item.baseProductId)!.add(monthStr);
                    totals.set(item.baseProductId, (totals.get(item.baseProductId) || 0) + item.consumedQuantity);
                    const currentTotal = consumptionByProduct.get(item.baseProductId) || 0;
                    consumptionByProduct.set(item.baseProductId, currentTotal + item.consumedQuantity);
                    totalNetworkConsumption += item.consumedQuantity;
                }
            });
        });

        const averages = new Map<string, number>();
        totals.forEach((total, bpId) => {
            const monthsCount = monthsWithConsumption.get(bpId)?.size || 1;
            averages.set(bpId, total / monthsCount);
        });

        const devMap = new Map<string, number>();
        consumptions.forEach((monthData, bpId) => {
            devMap.set(bpId, stdDev(Array.from(monthData.values())));
        });

        const consumptionPercentages = Array.from(consumptionByProduct.entries()).map(([id, total]) => ({
            id,
            total,
            percentage: totalNetworkConsumption > 0 ? (total / totalNetworkConsumption) * 100 : 0
        })).sort((a,b) => b.total - a.total);
        
        const classA = consumptionPercentages.slice(0, 5).map(p => p.id);
        const classB = consumptionPercentages.slice(5).map(p => p.id);

        return { monthlyConsumptions: consumptions, historicalAverages: averages, abcClasses: { A: classA, B: classB }, deviations: devMap };

    }, [loading, consumptionReports, kioskId]);
    
     useEffect(() => {
        if (!loading && baseProducts.length > 0 && selectedBaseProducts.length === 0) {
            const topOfensores = Array.from(deviations.entries())
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([id]) => id);
            setSelectedBaseProducts(topOfensores);
        }
    }, [loading, baseProducts, deviations, selectedBaseProducts.length]);


    const chartData = useMemo(() => {
        if (!startPeriod || !endPeriod || selectedBaseProducts.length === 0 || loading) {
            return [];
        }
        
        const uniqueUnitsOnSelected = new Set(selectedBaseProducts.map(bpId => baseProducts.find(p => p.id === bpId)?.unit).filter(Boolean));
        const usePercentage = uniqueUnitsOnSelected.size > 1;

        const [startYear, startMonth] = startPeriod.split('-').map(Number);
        const [endYear, endMonth] = endPeriod.split('-').map(Number);
        
        const start = startOfMonth(new Date(startYear, startMonth - 1, 1));
        const end = endOfMonth(new Date(endYear, endMonth - 1, 1));
        
        const interval: Date[] = [];
        let current = start;
        while (current <= end) {
            interval.push(current);
            current = addMonths(current, 1);
        }

        return interval.map(month => {
            const monthStr = format(month, 'yyyy-MM');
            const dayData: Record<string, any> = {
                date: format(month, 'MMM/yy', {locale: ptBR}),
            };
            selectedBaseProducts.forEach(bpId => {
                const bp = baseProducts.find(p => p.id === bpId);
                if (bp) {
                    const monthlyValue = monthlyConsumptions.get(bpId)?.get(monthStr) || 0;
                    if(usePercentage) {
                        const historicalAvg = historicalAverages.get(bpId);
                        if (historicalAvg && historicalAvg > 0) {
                            dayData[bp.name] = ((monthlyValue / historicalAvg) - 1) * 100;
                        } else {
                            dayData[bp.name] = monthlyValue > 0 ? 100 : 0;
                        }
                    } else {
                         dayData[bp.name] = monthlyValue;
                    }
                }
            });
            return dayData;
        });
    }, [startPeriod, endPeriod, selectedBaseProducts, loading, baseProducts, monthlyConsumptions, historicalAverages]);
    
     const availableBaseProducts = useMemo(() => {
        return baseProducts;
    }, [baseProducts]);

    const productOptions = useMemo(() => 
        availableBaseProducts.map(p => ({ value: p.id, label: p.name })),
    [availableBaseProducts]);
    
     const cardData: CardModel[] = useMemo(() => {
        if (loading || !startPeriod || !endPeriod) return [];
        
        const baseList = selectedBaseProducts.length > 0 ? baseProducts.filter(bp => selectedBaseProducts.includes(bp.id)) : availableBaseProducts;

        const [startYear, startMonth] = startPeriod.split('-').map(Number);
        const [endYear, endMonth] = endPeriod.split('-').map(Number);
        
        const start = startOfMonth(new Date(startYear, startMonth - 1, 1));
        const end = endOfMonth(new Date(endYear, endMonth - 1, 1));

        return baseList.map(bp => {
            const histAvg = historicalAverages.get(bp.id) || 0;
            const deviation = deviations.get(bp.id) || 0;

            const consumptionsInPeriod = Array.from(monthlyConsumptions.get(bp.id)?.entries() || [])
                .filter(([monthStr,]) => {
                    const monthDate = parseISO(`${monthStr}-01`);
                    return isWithinInterval(monthDate, {start, end});
                })
                .map(([label, value]) => ({ label: format(parseISO(`${label}-01`), 'MMM/yy'), value }));
            
            const periodAvg = consumptionsInPeriod.length > 0
                ? consumptionsInPeriod.reduce((a,b) => a + b.value, 0) / consumptionsInPeriod.length
                : 0;
            
            const historicalChangePct = histAvg > 0 ? ((periodAvg / histAvg) - 1) * 100 : (periodAvg > 0 ? Infinity : 0);
            
            let periodChangePct = 0;
            if (consumptionsInPeriod.length >= 2) {
                const first = consumptionsInPeriod[0].value;
                const last = consumptionsInPeriod[consumptionsInPeriod.length - 1].value;
                periodChangePct = first > 0 ? ((last / first) - 1) * 100 : (last > 0 ? Infinity : 0);
            }

            let volatility: CardModel['volatility'] = 'N/A';
            if (histAvg > 0) {
                const cv = deviation / histAvg; // Coefficient of Variation
                if (cv > 0.5) volatility = 'Alta';
                else if (cv > 0.2) volatility = 'Média';
                else volatility = 'Baixa';
            }

            let alertState: CardModel['alertState'] = 'no_data';
            let historicalStatus: CardModel['historicalStatus'] = 'sem dados';
            if(histAvg > 0) {
                if (Math.abs(historicalChangePct) <= 15) {
                    historicalStatus = 'normal';
                    alertState = 'ok';
                } else if (Math.abs(historicalChangePct) <= 30) {
                    historicalStatus = historicalChangePct > 0 ? 'acima' : 'abaixo';
                    alertState = 'attention';
                } else {
                    historicalStatus = historicalChangePct > 0 ? 'acima' : 'abaixo';
                    alertState = 'alert';
                }
            }


            return {
                id: bp.id, name: bp.name, unit: bp.unit,
                series: consumptionsInPeriod, periodAvg, histAvg,
                periodChangePct, historicalChangePct, historicalStatus,
                volatility,
                abcClass: abcClasses.A.includes(bp.id) ? 'A' : abcClasses.B.includes(bp.id) ? 'B' : null,
                alertState,
            };
        }).sort((a,b) => {
            const statusOrder = { 'alert': 1, 'attention': 2, 'ok': 3, 'no_data': 4 };
    
            if (statusOrder[a.alertState] !== statusOrder[b.alertState]) {
                return statusOrder[a.alertState] - statusOrder[b.alertState];
            }
            
            const isA_a = a.abcClass === 'A';
            const isA_b = b.abcClass === 'A';
            if (isA_a !== isA_b) {
                return isA_a ? -1 : 1;
            }
            
            const impactA = Math.abs(a.historicalChangePct);
            const impactB = Math.abs(b.historicalChangePct);
            return impactB - impactA;
        });
    }, [loading, startPeriod, endPeriod, selectedBaseProducts, availableBaseProducts, baseProducts, historicalAverages, deviations, monthlyConsumptions, abcClasses]);

    const onCompareClick = (cardData: CardModel) => {
        const bp = baseProducts.find(p => p.id === cardData.id);
        if (bp) {
          setComparisonModalData({ open: true, baseProduct: bp });
        }
    };


    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChart3 /> Análise de Consumo</CardTitle>
                <CardDescription>Visualize e compare o consumo de insumos ao longo do tempo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                
                <div className="flex flex-col md:flex-row gap-2">
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

                    <div className="flex-1">
                        <MultiSelect
                            options={productOptions}
                            selected={selectedBaseProducts}
                            onChange={setSelectedBaseProducts}
                            placeholder="Selecione os insumos..."
                            className="w-full"
                        />
                    </div>
                     <ToggleGroup type="single" value={view} onValueChange={(v) => { if (v) setView(v as any)}}>
                        <ToggleGroupItem value="cards">Cards</ToggleGroupItem>
                        <ToggleGroupItem value="chart">Comparativo</ToggleGroupItem>
                    </ToggleGroup>
                </div>
                
                 {view === 'cards' ? (
                     cardData.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 grid-auto-rows-fr">
                            {cardData.map(data => <ConsumptionCard key={data.id} data={data} onCompareClick={onCompareClick} />)}
                        </div>
                     ) : (
                        <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                            <Inbox className="h-12 w-12 mb-2"/>
                            <p>Nenhum dado de consumo para os filtros selecionados.</p>
                        </div>
                     )
                ) : (
                    <div className="h-[500px]">
                        {selectedBaseProducts.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="date" />
                                    <YAxis tickFormatter={(value) => value.toLocaleString()} />
                                    <Tooltip formatter={(value: number) => value.toLocaleString()} />
                                    <Legend />
                                    {selectedBaseProducts.map((bpId, index) => {
                                        const bp = baseProducts.find(p => p.id === bpId);
                                        if (!bp) return null;
                                        return <Line key={bpId} type="monotone" dataKey={bp.name} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2} dot={false} />;
                                    })}
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                                <Inbox className="h-12 w-12 mb-2"/>
                                <p>Selecione um ou mais insumos para visualizar o gráfico comparativo.</p>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
            <ConsumptionComparisonModal
                open={comparisonModalData.open}
                onOpenChange={(open) => setComparisonModalData({ open, baseProduct: null })}
                baseProduct={comparisonModalData.baseProduct}
                kioskId={kioskId}
                startPeriod={startPeriod || ''}
                endPeriod={endPeriod || ''}
            />
        </Card>
    );
}
