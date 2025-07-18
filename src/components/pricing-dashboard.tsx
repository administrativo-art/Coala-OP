
"use client";

import { useState, useMemo, useEffect } from "react";
import { type ProductSimulation, type PricingParameters } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, PieChart, Pie, Legend, ReferenceLine, LineChart, Line, Dot } from 'recharts';
import { DollarSign, BarChart3, TrendingDown, TrendingUp, CheckCircle2, AlertTriangle, Inbox, Target, ArrowUpCircle, Gauge, SlidersHorizontal, PackageCheck, FileQuestion, Star, Search } from 'lucide-react';
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "./ui/button";
import { useProductSimulationCategories } from "@/hooks/use-product-simulation-categories";


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
    onSelectItem: (item: ProductSimulation | null) => void;
    activeFilters: {
        categoryName: string | null;
        lineName: string | null;
        profitGoalFilter: string;
        statusFilter: string;
    }
}

export function PricingDashboard({ simulations, isLoading, getProfitColorClass, pricingParameters, onSelectItem, activeFilters }: PricingDashboardProps) {
    const [selectedItemForCharts, setSelectedItemForCharts] = useState<ProductSimulation | null>(null);
    const { categories } = useProductSimulationCategories();
    const [searchFilter, setSearchFilter] = useState('');
    const [isPopoverOpen, setIsPopoverOpen] = useState(false);

    const categoryMap = useMemo(() => {
        return new Map(categories.map(c => [c.id, c]));
    }, [categories]);

    const filteredSimulations = useMemo(() => {
        if (!searchFilter) return simulations;
        const lowerCaseFilter = searchFilter.toLowerCase();
        return simulations.filter(s => {
            const category = s.categoryId ? categoryMap.get(s.categoryId) : null;
            const line = s.lineId ? categoryMap.get(s.lineId) : null;
            return (
                s.name.toLowerCase().includes(lowerCaseFilter) ||
                (category && category.name.toLowerCase().includes(lowerCaseFilter)) ||
                (line && line.name.toLowerCase().includes(lowerCaseFilter))
            );
        });
    }, [simulations, searchFilter, categoryMap]);
    
    useEffect(() => {
        if (filteredSimulations.length > 0) {
            const currentSelectionExists = filteredSimulations.some(s => s.id === selectedItemForCharts?.id);
            if (!currentSelectionExists) {
                const newSelection = filteredSimulations[0];
                onSelectItem(newSelection);
                setSelectedItemForCharts(newSelection);
            }
        } else {
            onSelectItem(null);
            setSelectedItemForCharts(null);
        }
    }, [filteredSimulations, onSelectItem, selectedItemForCharts]);

    const { kpis, profitChartData, costCompositionData } = useMemo(() => {
        const simsToProcess = filteredSimulations.length > 0 ? filteredSimulations : simulations;

        if (!simsToProcess || simsToProcess.length === 0) {
            return { kpis: {}, profitChartData: [], costCompositionData: [] };
        }

        const totalSimulations = simsToProcess.length;
        const itemsWithGoal = simsToProcess.filter(s => s.profitGoal != null && s.profitGoal > 0);
        const itemsMeetingGoal = itemsWithGoal.filter(s => s.profitPercentage >= s.profitGoal!);
        const itemsBelowGoal = itemsWithGoal.filter(s => s.profitPercentage < s.profitGoal!);

        let highestMarginItem = simsToProcess[0];
        let lowestMarginItem = simsToProcess[0];

        for (const s of simsToProcess) {
            if (s.profitPercentage > highestMarginItem.profitPercentage) highestMarginItem = s;
            if (s.profitPercentage < lowestMarginItem.profitPercentage) lowestMarginItem = s;
        }

        const totalMarkup = simsToProcess.reduce((acc, s) => acc + s.markup, 0);

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

        const profitChartDataResult = simsToProcess
            .map(s => ({
                id: s.id,
                name: s.name,
                'Lucro %': s.profitPercentage,
            }))
            .sort((a, b) => b['Lucro %'] - a['Lucro %']);
            
        let costCompData: { name: string, value: number }[] = [];
        if (selectedItemForCharts) {
            costCompData = [
                { name: 'Insumos', value: selectedItemForCharts.totalCmv },
                { name: 'Operacional', value: selectedItemForCharts.grossCost - selectedItemForCharts.totalCmv }
            ];
        }

        return { kpis: kpisResult, profitChartData: profitChartDataResult, costCompositionData: costCompData };
    }, [simulations, filteredSimulations, selectedItemForCharts]);
    
    const handleSelectionChange = (id: string | null) => {
        const item = simulations.find(s => s.id === id);
        if (item) {
            setSelectedItemForCharts(item);
            onSelectItem(item);
        }
        setIsPopoverOpen(false);
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
                        <CardTitle className="text-sm font-medium">Itens abaixo meta</CardTitle>
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
                        <div className="flex justify-between items-start">
                            <div>
                                <CardTitle>Lucratividade por mercadoria</CardTitle>
                                <CardDescription>Clique em um ponto para selecionar o item e ver mais detalhes.</CardDescription>
                            </div>
                            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-[300px]" role="combobox">
                                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50"/>
                                        {selectedItemForCharts ? selectedItemForCharts.name : "Buscar mercadoria, categoria ou linha..."}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[300px] p-0">
                                    <Command>
                                        <CommandInput placeholder="Buscar..." onValueChange={setSearchFilter} />
                                        <CommandEmpty>Nenhum item encontrado.</CommandEmpty>
                                        <CommandList>
                                            <CommandGroup>
                                            {filteredSimulations.map((sim) => (
                                                <CommandItem
                                                    key={sim.id}
                                                    value={sim.name}
                                                    onSelect={() => handleSelectionChange(sim.id)}
                                                >
                                                {sim.name}
                                                </CommandItem>
                                            ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </CardHeader>
                    <CardContent>
                         <ResponsiveContainer width="100%" height={350}>
                            <LineChart data={profitChartData} onClick={(data) => {
                                if (data && data.activePayload && data.activePayload[0]) {
                                    const selectedId = data.activePayload[0].payload.id;
                                    handleSelectionChange(selectedId);
                                }
                            }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={80} interval={0} />
                                <YAxis unit="%" />
                                <Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} />
                                {activeFilters.profitGoalFilter !== 'all' && (
                                    <ReferenceLine y={Number(activeFilters.profitGoalFilter)} label={`Meta ${activeFilters.profitGoalFilter}%`} stroke="hsl(var(--primary))" strokeDasharray="3 3" />
                                )}
                                <Line 
                                    dataKey="Lucro %" 
                                    type="monotone"
                                    stroke="hsl(var(--primary))" 
                                    strokeWidth={2}
                                    dot={(props) => {
                                        const { cx, cy, payload } = props;
                                        if (payload.id === selectedItemForCharts?.id) {
                                            return <Dot cx={cx} cy={cy} r={6} fill="hsl(var(--primary))" stroke="hsl(var(--background))" strokeWidth={2} />;
                                        }
                                        return <Dot cx={cx} cy={cy} r={3} fill="hsl(var(--primary))" />;
                                    }}
                                    activeDot={{ r: 8 }}
                                />
                            </LineChart>
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
