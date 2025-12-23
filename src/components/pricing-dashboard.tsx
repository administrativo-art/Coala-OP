
"use client";

import { useState, useMemo, useEffect } from "react";
import { type ProductSimulation, type PricingParameters, type SimulationCategory } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, ReferenceLine } from 'recharts';
import { DollarSign, BarChart3, TrendingDown, TrendingUp, CheckCircle2, AlertTriangle, Inbox, Gauge, ArrowUpCircle, Search, PackageCheck, Layers, Tag, AppWindow, Percent, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import { SimulationItemsModal } from "./simulation-items-modal";
import { Button } from "./ui/button";


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
    categories: SimulationCategory[];
    isLoading: boolean;
    getProfitColorClass: (percentage: number) => string;
    pricingParameters: PricingParameters | null;
    activeFilters: {
        categoryName: string | null;
        lineName: string | null;
        profitGoalFilter: string;
        statusFilter: string;
    },
    kpis: any;
    profitChartData: any[];
    chartFilter: string;
    setChartFilter: (filter: string) => void;
}

export function PricingDashboard({ simulations, categories, isLoading, getProfitColorClass, pricingParameters, activeFilters, kpis, profitChartData, chartFilter, setChartFilter }: PricingDashboardProps) {
    const [modalData, setModalData] = useState<{ open: boolean; title: string; items: ProductSimulation[] }>({ open: false, title: '', items: [] });
    
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

    const filterOptions = useMemo(() => {
        const mainCategories = categories.filter(c => c.type === 'category').map(c => ({ value: `category:${c.id}`, label: c.name, group: 'Categorias' }));
        const lines = categories.filter(c => c.type === 'line').map(l => ({ value: `line:${l.id}`, label: l.name, group: 'Linhas' }));
        return [...mainCategories, ...lines];
    }, [categories]);
    

    if (isLoading) {
        return (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
                <Skeleton className="h-80 col-span-full" />
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de mercadorias</CardTitle>
                        <Layers className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.totalSimulations}</div>
                         <p className="text-xs text-muted-foreground">Total de mercadorias cadastradas para venda</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Qtd. por Categoria</CardTitle>
                        <Tag className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-1">
                            {Object.entries(kpis.categoryCounts || {}).map(([name, count]) => (
                                <div key={name} className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">{name}</span>
                                    <span className="font-bold">{count as number}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Qtd. por Linha</CardTitle>
                        <AppWindow className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-1">
                            {Object.entries(kpis.lineCounts || {}).map(([name, count]) => (
                                <div key={name} className="flex justify-between items-center text-sm">
                                    <span className="text-muted-foreground">{name}</span>
                                    <span className="font-bold">{count as number}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Média de lucro</CardTitle>
                        <Percent className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.averageProfitPercentage?.toFixed(2)}%</div>
                         <p className="text-xs text-muted-foreground">Média da margem de lucro de todas as mercadorias</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Mercadorias na meta</CardTitle>
                        <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground" onClick={() => setModalData({ open: true, title: 'Mercadorias na Meta', items: kpis.itemsMeetingGoal })}>
                            <Eye />
                        </Button>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{kpis.itemsMeetingGoal?.length || 0}</div>
                         <p className="text-xs text-muted-foreground">Mercadorias que atendem ou superam a meta de lucro</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Mercadorias abaixo da meta</CardTitle>
                         <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground" onClick={() => setModalData({ open: true, title: 'Mercadorias Abaixo da Meta', items: kpis.itemsBelowGoal })}>
                            <Eye />
                        </Button>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">{kpis.itemsBelowGoal?.length || 0}</div>
                        <p className="text-xs text-muted-foreground">Mercadorias abaixo da meta de lucro definida</p>
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
            <div>
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-start gap-4">
                            <div>
                                <CardTitle>Lucratividade por mercadoria</CardTitle>
                                <CardDescription>Clique em uma barra para selecionar a mercadoria e ver mais detalhes.</CardDescription>
                            </div>
                             <Select value={chartFilter} onValueChange={setChartFilter}>
                                <SelectTrigger className="w-[300px]">
                                    <SelectValue placeholder="Filtrar por..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as mercadorias</SelectItem>
                                    {filterOptions.filter(o => o.group === 'Categorias').length > 0 && (
                                        <>
                                            <Separator />
                                            <p className="px-2 py-1.5 text-xs font-semibold">Categorias</p>
                                        </>
                                    )}
                                    {filterOptions.filter(o => o.group === 'Categorias').map(opt => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                    {filterOptions.filter(o => o.group === 'Linhas').length > 0 && (
                                        <>
                                            <Separator />
                                            <p className="px-2 py-1.5 text-xs font-semibold">Linhas</p>
                                        </>
                                    )}
                                     {filterOptions.filter(o => o.group === 'Linhas').map(opt => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardHeader>
                    <CardContent>
                         <ResponsiveContainer width="100%" height={350}>
                            <BarChart data={profitChartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={80} interval={0} />
                                <YAxis unit="%" />
                                <Tooltip formatter={(value: number, name, props) => [`${value.toFixed(2)}%`, props.payload.name]} cursor={{ fill: 'hsl(var(--muted))' }}/>
                                {activeFilters.profitGoalFilter !== 'all' && (
                                    <ReferenceLine y={Number(activeFilters.profitGoalFilter)} label={{ value: `Meta ${activeFilters.profitGoalFilter}%`, position: 'insideTopRight' }} stroke="hsl(var(--primary))" strokeDasharray="3 3" />
                                )}
                                <Bar dataKey="Lucro %" radius={[4, 4, 0, 0]}>
                                    {profitChartData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={getBarColor(entry['Lucro %'])}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
            <SimulationItemsModal 
                open={modalData.open}
                onOpenChange={(open) => setModalData(prev => ({ ...prev, open }))}
                title={modalData.title}
                items={modalData.items}
            />
        </div>
    );
}
