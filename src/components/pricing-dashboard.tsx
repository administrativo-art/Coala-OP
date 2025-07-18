

"use client";

import { useState, useMemo, useEffect } from "react";
import { type ProductSimulation, type PricingParameters } from '@/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, PieChart, Pie, Legend, ReferenceLine } from 'recharts';
import { DollarSign, BarChart3, TrendingDown, TrendingUp, CheckCircle2, AlertTriangle, Inbox, Target, ArrowUpCircle, Gauge, SlidersHorizontal, PackageCheck, FileQuestion, Star } from 'lucide-react';
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useCompanySettings } from "@/hooks/use-company-settings";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Label } from "./ui/label";


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

function ScenarioTable({ selectedItem, pricingParameters }: { selectedItem: ProductSimulation | null, pricingParameters: PricingParameters | null }) {
    if (!selectedItem) return null;

    const scenarios = pricingParameters?.profitGoals || [50, 55, 60];

    const calculatePriceForGoal = (goal: number) => selectedItem.grossCost / (1 - (goal / 100));

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="text-right">Margem %</TableHead>
                    <TableHead className="text-right">Preço Sugerido</TableHead>
                    <TableHead className="text-right">Delta (vs Atual)</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {scenarios.map(goal => {
                    const priceForGoal = calculatePriceForGoal(goal);
                    const delta = priceForGoal - selectedItem.salePrice;
                    return (
                        <TableRow key={goal}>
                            <TableCell className="text-right font-bold">{goal}%</TableCell>
                            <TableCell className="text-right font-semibold text-primary">{formatCurrency(priceForGoal)}</TableCell>
                            <TableCell className={cn("text-right font-semibold", delta > 0 ? "text-orange-500" : "text-green-600")}>
                                {formatCurrency(delta, true)}
                            </TableCell>
                        </TableRow>
                    )
                })}
            </TableBody>
        </Table>
    );
}

function WhatIfSimulator({ item }: { item: ProductSimulation | null }) {
    const [simulatedPrice, setSimulatedPrice] = useState<number | undefined>(undefined);

    useEffect(() => {
        if (item) {
            setSimulatedPrice(item.salePrice);
        }
    }, [item]);

    if (!item || simulatedPrice === undefined) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-4">
                <FileQuestion className="h-10 w-10 mb-2" />
                <p className="font-semibold">Selecione uma mercadoria</p>
                <p className="text-sm">Clique em uma mercadoria na tabela ou no gráfico para simular cenários aqui.</p>
            </div>
        )
    }

    const simulatedMargin = item.grossCost > 0 && simulatedPrice > 0
        ? ((simulatedPrice - item.grossCost) / simulatedPrice) * 100
        : 0;

    const minPrice = item.grossCost;
    const maxPrice = minPrice * 3;

    return (
        <div className="p-4 space-y-4">
            <h4 className="font-semibold">{item.name}</h4>
             <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                    <p className="text-sm text-muted-foreground">Margem Simulada</p>
                    <p className="text-3xl font-bold">{simulatedMargin.toFixed(1)}<span className="text-lg">%</span></p>
                </div>
                <div>
                    <p className="text-sm text-muted-foreground">Preço Simulado</p>
                    <p className="text-3xl font-bold">{formatCurrency(simulatedPrice)}</p>
                </div>
            </div>
            <div>
                <Label>Ajustar Preço de Venda</Label>
                <Slider
                    value={[simulatedPrice]}
                    min={minPrice}
                    max={maxPrice}
                    step={0.05}
                    onValueChange={(value) => setSimulatedPrice(value[0])}
                />
                 <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{formatCurrency(minPrice)}</span>
                    <span>{formatCurrency(maxPrice)}</span>
                </div>
            </div>
        </div>
    );
}

export function PricingDashboard({ simulations, isLoading, getProfitColorClass, pricingParameters, onSelectItem, activeFilters }: PricingDashboardProps) {
    const [selectedItemForCharts, setSelectedItemForCharts] = useState<ProductSimulation | null>(null);

    useEffect(() => {
        if (simulations.length > 0) {
            // If the current selection is no longer in the filtered list, select the first one.
            const currentSelectionExists = simulations.some(s => s.id === selectedItemForCharts?.id);
            if (!currentSelectionExists) {
                onSelectItem(simulations[0]);
                setSelectedItemForCharts(simulations[0]);
            }
        } else {
            onSelectItem(null);
            setSelectedItemForCharts(null);
        }
    }, [simulations, onSelectItem, selectedItemForCharts]);

    const { kpis, profitChartData, costCompositionData } = useMemo(() => {
        if (!simulations || simulations.length === 0) {
            return { kpis: {}, profitChartData: [], costCompositionData: [] };
        }

        const totalSimulations = simulations.length;
        const itemsWithGoal = simulations.filter(s => s.profitGoal != null && s.profitGoal > 0);
        const itemsMeetingGoal = itemsWithGoal.filter(s => s.profitPercentage >= s.profitGoal!);
        const itemsBelowGoal = itemsWithGoal.filter(s => s.profitPercentage < s.profitGoal!);

        let highestMarginItem = simulations[0];
        let lowestMarginItem = simulations[0];

        for (const s of simulations) {
            if (s.profitPercentage > highestMarginItem.profitPercentage) highestMarginItem = s;
            if (s.profitPercentage < lowestMarginItem.profitPercentage) lowestMarginItem = s;
        }

        const totalMarkup = simulations.reduce((acc, s) => acc + s.markup, 0);

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

        const profitChartDataResult = simulations
            .map(s => ({
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
    }, [simulations, selectedItemForCharts]);
    
    const handleSelectionChange = (id: string) => {
        const item = simulations.find(s => s.id === id);
        if (item) {
            setSelectedItemForCharts(item);
            onSelectItem(item);
        }
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
                        <CardTitle className="text-sm font-medium">Itens OK</CardTitle>
                        <PackageCheck className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{kpis.okCount}</div>
                         <p className="text-xs text-muted-foreground">Itens que atendem ou superam a meta de lucro</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Para Revisar</CardTitle>
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
                        <CardTitle>Lucratividade por mercadoria</CardTitle>
                        <CardDescription>Clique em uma barra para selecionar o item e ver mais detalhes.</CardDescription>
                    </CardHeader>
                    <CardContent>
                         <ResponsiveContainer width="100%" height={350}>
                            <BarChart data={profitChartData} onClick={(data) => {
                                if (data && data.activePayload && data.activePayload[0]) {
                                    const selectedName = data.activePayload[0].payload.name;
                                    const item = simulations.find(s => s.name === selectedName);
                                    if(item) {
                                      handleSelectionChange(item.id);
                                    }
                                }
                            }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={80} interval={0} />
                                <YAxis unit="%" />
                                <Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} />
                                {activeFilters.profitGoalFilter !== 'all' && (
                                    <ReferenceLine y={Number(activeFilters.profitGoalFilter)} label={`Meta ${activeFilters.profitGoalFilter}%`} stroke="hsl(var(--primary))" strokeDasharray="3 3" />
                                )}
                                <Bar dataKey="Lucro %" radius={[4, 4, 0, 0]}>
                                    {profitChartData.map((entry, index) => (
                                        <Cell 
                                            key={`cell-${index}`} 
                                            fill={getProfitColorClass(entry['Lucro %'])} 
                                            className={cn("cursor-pointer", selectedItemForCharts?.name === entry.name && "opacity-100", selectedItemForCharts?.name !== entry.name && "opacity-50 hover:opacity-75")}
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
            
            <div className="border-t pt-4">
                 <div className="mb-4">
                    <Label>Selecionar Mercadoria para Análise</Label>
                    <Select value={selectedItemForCharts?.id} onValueChange={handleSelectionChange}>
                        <SelectTrigger><SelectValue placeholder="Selecione uma mercadoria..."/></SelectTrigger>
                        <SelectContent>
                            {simulations.map(sim => (
                                <SelectItem key={sim.id} value={sim.id}>{sim.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                 </div>
                 <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <Card className="lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><SlidersHorizontal/> Simulador "What-If"</CardTitle>
                            <CardDescription>Arraste o slider de preço e veja o impacto na margem em tempo real.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <WhatIfSimulator item={selectedItemForCharts} />
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Tabela de Cenários</CardTitle>
                            <CardDescription>Preços sugeridos para atingir as principais metas de margem.</CardDescription>
                        </CardHeader>
                        <CardContent>
                        <ScenarioTable selectedItem={selectedItemForCharts} pricingParameters={pricingParameters} />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

