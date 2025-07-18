
"use client";

import { useState, useMemo, useEffect } from "react";
import { type ProductSimulation, type PricingParameters } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, ReferenceLine } from 'recharts';
import { DollarSign, BarChart3, TrendingDown, TrendingUp, CheckCircle2, AlertTriangle, Inbox, Gauge, ArrowUpCircle, Search } from 'lucide-react';
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { cn } from "@/lib/utils";
import { Input } from "./ui/input";


const formatCurrency = (value: number | undefined | null, showSign = false) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    const isNegative = value < 0;
    const formatted = Math.abs(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (showSign) {
        if (isNegative) return `- ${formatted}`;
        if (value > 0) return `+ ${formatted}`;
    }
    return isNegative ? `- ${formatted}` : formatted;
};

interface PricingDashboardProps {
    simulations: ProductSimulation[];
    isLoading: boolean;
    getProfitColorClass: (percentage: number) => string;
    pricingParameters: PricingParameters | null;
    activeFilters: {
        categoryName: string | null;
        lineName: string | null;
        profitGoalFilter: string;
        statusFilter: string;
    }
}

export function PricingDashboard({ simulations, isLoading, getProfitColorClass, pricingParameters, activeFilters }: PricingDashboardProps) {
    const [chartSearchTerm, setChartSearchTerm] = useState('');
    const [selectedItemForCharts, setSelectedItemForCharts] = useState<ProductSimulation | null>(null);

    useEffect(() => {
        if (simulations.length > 0) {
            const currentSelectionExists = simulations.some(s => s.id === selectedItemForCharts?.id);
            if (!currentSelectionExists) {
                setSelectedItemForCharts(simulations[0]);
            }
        } else {
            setSelectedItemForCharts(null);
        }
    }, [simulations, selectedItemForCharts]);

    const { kpis, profitChartData } = useMemo(() => {
        const filteredSimulations = chartSearchTerm 
            ? simulations.filter(s => s.name.toLowerCase().includes(chartSearchTerm.toLowerCase()))
            : simulations;
            
        if (!filteredSimulations || filteredSimulations.length === 0) {
            return { kpis: {}, profitChartData: [] };
        }

        const totalSimulations = filteredSimulations.length;
        const itemsWithGoal = filteredSimulations.filter(s => s.profitGoal != null && s.profitGoal > 0);
        const itemsMeetingGoal = itemsWithGoal.filter(s => s.profitPercentage >= s.profitGoal!);
        const itemsBelowGoal = itemsWithGoal.filter(s => s.profitPercentage < s.profitGoal!);

        let highestMarginItem = filteredSimulations[0];
        let lowestMarginItem = filteredSimulations[0];

        for (const s of filteredSimulations) {
            if (s.profitPercentage > highestMarginItem.profitPercentage) highestMarginItem = s;
            if (s.profitPercentage < lowestMarginItem.profitPercentage) lowestMarginItem = s;
        }

        const totalMarkup = filteredSimulations.reduce((acc, s) => acc + s.markup, 0);

        const priceDeltas = itemsBelowGoal.map(s => {
            const priceForGoal = s.grossCost / (1 - (s.profitGoal! / 100));
            return priceForGoal - s.salePrice;
        });

        const averagePriceDelta = priceDeltas.length > 0 ? priceDeltas.reduce((acc, delta) => acc + delta, 0) / priceDeltas.length : 0;

        const kpisResult = {
            okCount: itemsMeetingGoal.length,
            reviewCount: itemsBelowGoal.length,
            highestMarginItem,
            lowestMarginItem,
            averageMarkup: totalSimulations > 0 ? totalMarkup / totalSimulations : 0,
            averagePriceDelta: averagePriceDelta,
        };

        const profitChartDataResult = filteredSimulations
            .map(s => ({
                id: s.id,
                name: s.name,
                'Lucro %': s.profitPercentage,
            }))
            .sort((a, b) => a['Lucro %'] - b['Lucro %']);

        return { kpis: kpisResult, profitChartData: profitChartDataResult };
    }, [simulations, chartSearchTerm]);
    
    const costCompositionData = useMemo(() => {
        if (!selectedItemForCharts) return [];
        return [
            { name: 'Insumos', value: selectedItemForCharts.totalCmv },
            { name: 'Operacional', value: selectedItemForCharts.grossCost - selectedItemForCharts.totalCmv }
        ];
    }, [selectedItemForCharts]);
    
    const handleSelectionChange = (data: any) => {
        if (data && data.activePayload && data.activePayload[0]) {
            const selectedId = data.activePayload[0].payload.id;
            const item = simulations.find(s => s.id === selectedId);
            if (item) {
                setSelectedItemForCharts(item);
            }
        }
    };
    
    const getBarColor = (percentage: number) => {
        if (!pricingParameters?.profitRanges) return 'hsl(var(--primary))';
        const sortedRanges = [...pricingParameters.profitRanges].sort((a, b) => a.from - b.from);
        
        for (const range of sortedRanges) {
            if (percentage >= range.from && (range.to === Infinity || percentage < range.to)) {
                if(range.color.includes('green')) return '#16A34A';
                if(range.color.includes('orange')) return '#F97316';
                if(range.color.includes('yellow')) return '#FBBF24';
                if(range.color.includes('destructive')) return '#EF4444';
                if(range.color.includes('blue')) return '#3B82F6';
                if(range.color.includes('primary')) return '#F43F5E';
            }
        }
        
        return 'hsl(var(--primary))'; 
    };

    if (isLoading) {
        return (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-80 col-span-full lg:col-span-2" />
                <Skeleton className="h-80 col-span-full lg:col-span-2" />
            </div>
        );
    }
    
    if (simulations.length === 0) {
        return (
            <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                <Inbox className="mx-auto h-12 w-12" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">Sem dados para o dashboard</h3>
                <p className="mt-1 text-sm">Crie análises de custo ou ajuste os filtros para visualizar os dados no painel.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Itens na meta</CardTitle>
                        <PackageCheck className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{kpis.okCount}</div>
                         <p className="text-xs text-muted-foreground">Itens que atendem ou superam a meta de lucro</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Itens abaixo da meta</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">{kpis.reviewCount}</div>
                        <p className="text-xs text-muted-foreground">Itens abaixo da meta de lucro definida</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Markup Médio</CardTitle>
                        <Gauge className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.averageMarkup?.toFixed(2)}x</div>
                         <p className="text-xs text-muted-foreground">Preço / Custo bruto</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Aumento Médio</CardTitle>
                        <ArrowUpCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(kpis.averagePriceDelta)}</div>
                        <p className="text-xs text-muted-foreground">Necessário para atingir a meta</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Maior Margem</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.highestMarginItem?.profitPercentage.toFixed(2)}%</div>
                         <p className="text-xs text-muted-foreground truncate">{kpis.highestMarginItem?.name}</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Menor Margem</CardTitle>
                        <TrendingDown className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.lowestMarginItem?.profitPercentage.toFixed(2)}%</div>
                         <p className="text-xs text-muted-foreground truncate">{kpis.lowestMarginItem?.name}</p>
                    </CardContent>
                </Card>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <div className="flex justify-between items-start gap-4">
                            <div>
                                <CardTitle>Lucratividade por mercadoria</CardTitle>
                                <CardDescription>Clique em uma barra para selecionar o item e ver mais detalhes.</CardDescription>
                            </div>
                            <div className="relative w-full max-w-xs">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    placeholder="Filtrar mercadoria..."
                                    className="pl-10"
                                    value={chartSearchTerm}
                                    onChange={(e) => setChartSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                         <ResponsiveContainer width="100%" height={350}>
                            <BarChart data={profitChartData} onClick={handleSelectionChange}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={80} interval={0} />
                                <YAxis unit="%" />
                                <Tooltip formatter={(value: number, name, props) => [`${value.toFixed(2)}%`, props.payload.name]} cursor={{ fill: 'hsl(var(--muted))' }}/>
                                {activeFilters.profitGoalFilter !== 'all' && (
                                    <ReferenceLine y={Number(activeFilters.profitGoalFilter)} label={{ value: `Meta ${activeFilters.profitGoalFilter}%`, position: 'insideTopRight' }} stroke="hsl(var(--primary))" strokeDasharray="3 3" />
                                )}
                                <Bar dataKey="Lucro %">
                                    {profitChartData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={getBarColor(entry['Lucro %'])}
                                            radius={[4, 4, 0, 0]}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Composição de Custo</CardTitle>
                         <CardDescription>{selectedItemForCharts ? `Para: ${selectedItemForCharts.name}`: "Selecione um item no gráfico"}</CardDescription>
                    </CardHeader>
                     <CardContent>
                        <ResponsiveContainer width="100%" height={350}>
                            <PieChart>
                                <Pie data={costCompositionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                                    <Cell fill="#E57373" />
                                    <Cell fill="#64B5F6" />
                                </Pie>
                                <Tooltip formatter={(value) => formatCurrency(value)} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
