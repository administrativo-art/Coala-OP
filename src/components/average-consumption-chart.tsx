
"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { format, startOfMonth, addMonths, isWithinInterval, parseISO, endOfMonth } from "date-fns"
import { ptBR } from 'date-fns/locale'

// Hooks
import { useValidatedConsumptionData } from "@/hooks/useValidatedConsumptionData"
import { useProducts } from "@/hooks/use-products"
import { useKiosks } from "@/hooks/use-kiosks"

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Skeleton } from "@/components/ui/skeleton"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { TrendingUp, X as XIcon, Inbox, Check, Lightbulb } from 'lucide-react'
import { cn } from "@/lib/utils"
import { Badge } from "./ui/badge"
import { InsightCard, type Insight } from './insight-card'
import type { BaseProduct } from "@/types"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { MultiSelect } from "@/components/ui/multi-select"


const stdDev = (arr: number[]): number => {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b) / arr.length;
    return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / arr.length);
};


// Chart Colors
const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

export function AverageConsumptionChart() {
    // State
    const [startPeriod, setStartPeriod] = useState<string | null>(null);
    const [endPeriod, setEndPeriod] = useState<string | null>(null);
    const [selectedBaseProducts, setSelectedBaseProducts] = useState<string[]>([]);
    const [viewMode, setViewMode] = useState<'absolute' | 'percentage'>('absolute');
    const [initialLoad, setInitialLoad] = useState(true);
    const [kioskId, setKioskId] = useState<string>('all');
    const [abcFilter, setAbcClassFilter] = useState<'ALL' | 'A' | 'B'>('ALL');

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
    
    const { monthlyConsumptions, historicalAverages, abcClasses } = useMemo(() => {
        if (loading) return { monthlyConsumptions: new Map(), historicalAverages: new Map(), abcClasses: { A: [], B: [] } };

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

                    // For ABC
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

        // ABC Calculation
        const consumptionPercentages = Array.from(consumptionByProduct.entries()).map(([id, total]) => ({
            id,
            total,
            percentage: totalNetworkConsumption > 0 ? (total / totalNetworkConsumption) * 100 : 0
        })).sort((a,b) => b.total - a.total);
        
        const classA = consumptionPercentages.slice(0, 5).map(p => p.id);
        const classB = consumptionPercentages.slice(5).map(p => p.id);

        return { monthlyConsumptions: consumptions, historicalAverages: averages, abcClasses: { A: classA, B: classB } };

    }, [loading, consumptionReports, kioskId]);
    
    const topOfensores = useMemo(() => {
        if (loading || monthlyConsumptions.size === 0) return [];
        
        const ofensores = Array.from(monthlyConsumptions.keys()).map(bpId => {
            const consumptions = Array.from(monthlyConsumptions.get(bpId)?.values() || []);
            const deviation = stdDev(consumptions);
            return { id: bpId, deviation };
        });

        return ofensores.sort((a,b) => b.deviation - a.deviation).slice(0, 3);
    }, [loading, monthlyConsumptions]);
    
    useEffect(() => {
        if (initialLoad && topOfensores.length > 0 && selectedBaseProducts.length === 0) {
            setSelectedBaseProducts(topOfensores.map(o => o.id));
            setInitialLoad(false);
        }
    }, [initialLoad, topOfensores, selectedBaseProducts.length]);


    const uniqueUnitsOnSelected = useMemo(() => {
        if (loading || selectedBaseProducts.length === 0) return new Set();
        const selectedProductsDetails = selectedBaseProducts.map(bpId => baseProducts.find(p => p.id === bpId)).filter(Boolean) as BaseProduct[];
        return new Set(selectedProductsDetails.map(p => p.unit));
    }, [selectedBaseProducts, baseProducts, loading]);

    useEffect(() => {
        if (uniqueUnitsOnSelected.size > 1) {
            setViewMode('percentage');
        } else {
            setViewMode('absolute');
        }
    }, [uniqueUnitsOnSelected]);


    // Memoized Data Processing
    const { chartData, yAxisLabel, insights } = useMemo(() => {
        if (!startPeriod || !endPeriod || selectedBaseProducts.length === 0 || loading) {
            return { chartData: [], yAxisLabel: 'Consumo', insights: [] };
        }
        
        const currentViewMode = uniqueUnitsOnSelected.size > 1 ? 'percentage' : viewMode;

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

        const finalChartData = interval.map(month => {
            const monthStr = format(month, 'yyyy-MM');
            const dayData: Record<string, any> = {
                date: format(month, 'MMM/yy', {locale: ptBR}),
            };
            selectedBaseProducts.forEach(bpId => {
                const bp = baseProducts.find(p => p.id === bpId);
                if (bp) {
                    const monthlyValue = monthlyConsumptions.get(bpId)?.get(monthStr) || 0;
                    
                    if (currentViewMode === 'percentage') {
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

        const finalInsights: Insight[] = selectedBaseProducts.map(bpId => {
            const historicalAvg = historicalAverages.get(bpId) || 0;
            
            const consumptionsInPeriod = Array.from(monthlyConsumptions.get(bpId)?.entries() || [])
                .filter(([monthStr,]) => {
                    const monthDate = parseISO(`${monthStr}-01`);
                    return isWithinInterval(monthDate, {start, end});
                })
                .map(([, value]) => value);

            const currentAvg = consumptionsInPeriod.length > 0
                ? consumptionsInPeriod.reduce((a,b) => a + b, 0) / consumptionsInPeriod.length
                : 0;

            const change = historicalAvg > 0 ? ((currentAvg / historicalAvg) - 1) * 100 : (currentAvg > 0 ? Infinity : 0);
            
            return {
                name: baseProducts.find(p => p.id === bpId)?.name || 'N/A',
                change: change,
                currentAvg: currentAvg / 30, // Show daily average for consistency
                unit: baseProducts.find(p => p.id === bpId)?.unit || ''
            };
        });

        let yLabel = 'Consumo';
        if (currentViewMode === 'percentage') {
            yLabel = 'Variação (%)';
        } else if (selectedBaseProducts.length > 0) {
            const firstSelectedProduct = baseProducts.find(p => p.id === selectedBaseProducts[0]);
            yLabel = `Consumo (${firstSelectedProduct?.unit || ''})`;
        }

        return { chartData: finalChartData, yAxisLabel: yLabel, insights: finalInsights };

    }, [startPeriod, endPeriod, selectedBaseProducts, loading, baseProducts, viewMode, monthlyConsumptions, historicalAverages, uniqueUnitsOnSelected]);
    
    const availableBaseProducts = useMemo(() => {
        if (abcFilter === 'A') return baseProducts.filter(bp => abcClasses.A.includes(bp.id));
        if (abcFilter === 'B') return baseProducts.filter(bp => abcClasses.B.includes(bp.id));
        return baseProducts;
    }, [baseProducts, abcFilter, abcClasses]);

    const productOptions = useMemo(() => 
        availableBaseProducts.map(p => ({ value: p.id, label: p.name })),
    [availableBaseProducts]);

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><TrendingUp /> Análise de Consumo</CardTitle>
                <CardDescription>Visualize e compare o consumo de insumos ao longo do tempo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <InsightCard insights={insights} />
                
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
                    
                    <ToggleGroup 
                        type="single" 
                        value={viewMode} 
                        onValueChange={(value) => {if (value) setViewMode(value as any)}} 
                        size="sm"
                        disabled={uniqueUnitsOnSelected.size > 1}
                    >
                        <ToggleGroupItem value="absolute">Absoluto</ToggleGroupItem>
                        <ToggleGroupItem value="percentage">Variação %</ToggleGroupItem>
                    </ToggleGroup>
                </div>
                 <Tabs value={abcFilter} onValueChange={(v) => setAbcClassFilter(v as any)}>
                    <TabsList>
                        <TabsTrigger value="ALL">Geral</TabsTrigger>
                        <TabsTrigger value="A">Curva A (Top 5)</TabsTrigger>
                        <TabsTrigger value="B">Curva B (Restante)</TabsTrigger>
                    </TabsList>
                </Tabs>
                
                {/* Chart */}
                <div className="h-[400px]">
                    {selectedBaseProducts.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="date" />
                                <YAxis 
                                    label={{ value: yAxisLabel, angle: -90, position: 'insideLeft' }}
                                    tickFormatter={(value) => uniqueUnitsOnSelected.size > 1 ? `${value}%` : value}
                                />
                                <Tooltip formatter={(value: number) => uniqueUnitsOnSelected.size > 1 ? `${value.toFixed(0)}%` : value} />
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
                            <p>Selecione um ou mais insumos para visualizar o gráfico.</p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
