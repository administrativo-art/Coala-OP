
"use client";

import { useState, useMemo, useEffect } from "react";
import { type ProductSimulation, type PricingParameters, type SimulationCategory } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, ReferenceLine } from 'recharts';
import { DollarSign, BarChart3, TrendingDown, TrendingUp, CheckCircle2, AlertTriangle, Inbox, Gauge, ArrowUpCircle, Search, PackageCheck, Layers, Tag, AppWindow } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
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
    categories: SimulationCategory[];
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

export function PricingDashboard({ simulations, categories, isLoading, getProfitColorClass, pricingParameters, activeFilters }: PricingDashboardProps) {
    const [chartSearchTerm, setChartSearchTerm] = useState('');
    const [popoverOpen, setPopoverOpen] = useState(false);

    const filteredSimulations = useMemo(() => {
        if (!chartSearchTerm) return simulations;
        const searchTermLower = chartSearchTerm.toLowerCase();
        
        return simulations.filter(s => {
            const category = s.categoryId ? categories.find(c => c.id === s.categoryId) : null;
            const line = s.lineId ? categories.find(c => c.id === s.lineId) : null;

            return s.name.toLowerCase().includes(searchTermLower) ||
                   (category && category.name.toLowerCase() === searchTermLower) ||
                   (line && line.name.toLowerCase() === searchTermLower);
        });
    }, [simulations, chartSearchTerm, categories]);

    const { kpis, profitChartData } = useMemo(() => {
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
        
        const categoryCounts: { [name: string]: number } = {};
        const lineCounts: { [name: string]: number } = {};

        filteredSimulations.forEach(s => {
            s.categoryIds.forEach(catId => {
                const category = categories.find(c => c.id === catId);
                if (category && category.type === 'category') {
                    categoryCounts[category.name] = (categoryCounts[category.name] || 0) + 1;
                }
            });
            if (s.lineId) {
                const line = categories.find(c => c.id === s.lineId);
                if (line && line.type === 'line') {
                    lineCounts[line.name] = (lineCounts[line.name] || 0) + 1;
                }
            }
        });


        const kpisResult = {
            totalSimulations,
            okCount: itemsMeetingGoal.length,
            reviewCount: itemsBelowGoal.length,
            highestMarginItem,
            lowestMarginItem,
            averageMarkup: totalSimulations > 0 ? totalMarkup / totalSimulations : 0,
            averagePriceDelta: averagePriceDelta,
            categoryCounts,
            lineCounts
        };

        const profitChartDataResult = filteredSimulations
            .map(s => ({
                id: s.id,
                name: s.name,
                'Lucro %': s.profitPercentage,
            }))
            .sort((a, b) => a['Lucro %'] - b['Lucro %']);

        return { kpis: kpisResult, profitChartData: profitChartDataResult };
    }, [filteredSimulations, categories]);
    
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
        const mercadorias = simulations.map(s => ({ value: s.name.toLowerCase(), label: s.name, group: 'Mercadorias' }));
        const mainCategories = categories.filter(c => c.type === 'category').map(c => ({ value: c.name.toLowerCase(), label: c.name, group: 'Categorias' }));
        const lines = categories.filter(c => c.type === 'line').map(l => ({ value: l.name.toLowerCase(), label: l.name, group: 'Linhas' }));
        return [...mercadorias, ...mainCategories, ...lines];
    }, [simulations, categories]);
    

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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de mercadorias</CardTitle>
                        <Layers className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.totalSimulations}</div>
                         <p className="text-xs text-muted-foreground">Total de itens cadastrados para venda</p>
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
                                    <span className="font-bold">{count}</span>
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
                                    <span className="font-bold">{count}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
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
            <div>
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-start gap-4">
                            <div>
                                <CardTitle>Lucratividade por mercadoria</CardTitle>
                                <CardDescription>Clique em uma barra para selecionar o item e ver mais detalhes.</CardDescription>
                            </div>
                            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={popoverOpen}
                                    className="w-[300px] justify-between"
                                >
                                    {chartSearchTerm
                                    ? filterOptions.find(option => option.value === chartSearchTerm)?.label || "Filtrar..."
                                    : "Filtrar mercadoria, categoria..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[300px] p-0">
                                <Command>
                                    <CommandInput placeholder="Buscar..." />
                                    <CommandList>
                                        <CommandEmpty>Nenhum item encontrado.</CommandEmpty>
                                        <CommandGroup heading="Mercadorias">
                                        {filterOptions.filter(o => o.group === 'Mercadorias').map((option) => (
                                            <CommandItem
                                            key={option.value}
                                            value={option.value}
                                            onSelect={(currentValue) => {
                                                setChartSearchTerm(currentValue === chartSearchTerm ? "" : currentValue)
                                                setPopoverOpen(false)
                                            }}
                                            >
                                            <Check
                                                className={cn(
                                                "mr-2 h-4 w-4",
                                                chartSearchTerm === option.value ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            {option.label}
                                            </CommandItem>
                                        ))}
                                        </CommandGroup>
                                         <CommandGroup heading="Categorias">
                                        {filterOptions.filter(o => o.group === 'Categorias').map((option) => (
                                            <CommandItem
                                            key={option.value}
                                            value={option.value}
                                            onSelect={(currentValue) => {
                                                setChartSearchTerm(currentValue === chartSearchTerm ? "" : currentValue)
                                                setPopoverOpen(false)
                                            }}
                                            >
                                            <Check
                                                className={cn(
                                                "mr-2 h-4 w-4",
                                                chartSearchTerm === option.value ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            {option.label}
                                            </CommandItem>
                                        ))}
                                        </CommandGroup>
                                         <CommandGroup heading="Linhas">
                                        {filterOptions.filter(o => o.group === 'Linhas').map((option) => (
                                            <CommandItem
                                            key={option.value}
                                            value={option.value}
                                            onSelect={(currentValue) => {
                                                setChartSearchTerm(currentValue === chartSearchTerm ? "" : currentValue)
                                                setPopoverOpen(false)
                                            }}
                                            >
                                            <Check
                                                className={cn(
                                                "mr-2 h-4 w-4",
                                                chartSearchTerm === option.value ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            {option.label}
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
                            <BarChart data={profitChartData}>
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
            </div>
        </div>
    );
}
