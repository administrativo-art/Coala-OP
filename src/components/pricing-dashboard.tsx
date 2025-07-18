
"use client";

import { useMemo } from 'react';
import { type ProductSimulation, type PricingParameters } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, PieChart, Pie, Legend } from 'recharts';
import { DollarSign, BarChart3, TrendingDown, TrendingUp, CheckCircle2, AlertTriangle, Inbox, Target, ArrowUpCircle } from 'lucide-react';

interface PricingDashboardProps {
    simulations: ProductSimulation[];
    isLoading: boolean;
    getProfitColorClass: (percentage: number) => string;
    formatCurrency: (value: number) => string;
    pricingParameters: PricingParameters | null;
}

export function PricingDashboard({ simulations, isLoading, getProfitColorClass, formatCurrency, pricingParameters }: PricingDashboardProps) {

    const { kpis, profitChartData, costCompositionData } = useMemo(() => {
        if (!simulations || simulations.length === 0) {
            return { kpis: {}, profitChartData: [], costCompositionData: [] };
        }

        const totalSimulations = simulations.length;

        const itemsWithGoal = simulations.filter(s => s.profitGoal != null && s.profitGoal > 0);
        const itemsMeetingGoal = itemsWithGoal.filter(s => s.profitPercentage >= s.profitGoal!);
        const itemsBelowGoal = itemsWithGoal.filter(s => s.profitPercentage < s.profitGoal!);

        const totalProfitPercentage = simulations.reduce((acc, s) => acc + (s.profitPercentage || 0), 0);
        const lowestMarginItem = simulations.reduce((min, s) => (s.profitPercentage < min.profitPercentage ? s : min), simulations[0]);
        
        const totalMarkup = simulations.reduce((acc, s) => acc + s.markup, 0);

        const priceDeltas = itemsBelowGoal.map(s => {
            const priceForGoal = s.grossCost / (1 - (s.profitGoal! / 100));
            return priceForGoal - s.salePrice;
        });

        const averagePriceDelta = priceDeltas.length > 0 ? priceDeltas.reduce((acc, delta) => acc + delta, 0) / priceDeltas.length : 0;


        const kpisResult = {
            okPercentage: totalSimulations > 0 ? (itemsMeetingGoal.length / totalSimulations) * 100 : 0,
            reviewPercentage: totalSimulations > 0 ? (itemsWithGoal.filter(s => s.profitPercentage < s.profitGoal!).length / totalSimulations) * 100 : 0,
            averageProfit: totalSimulations > 0 ? totalProfitPercentage / totalSimulations : 0,
            lowestMarginItem: lowestMarginItem,
            averageMarkup: totalSimulations > 0 ? totalMarkup / totalSimulations : 0,
            averagePriceDelta: averagePriceDelta,
        };

        const profitChartDataResult = simulations
            .map(s => ({
                name: s.name,
                'Lucro %': s.profitPercentage,
            }))
            .sort((a, b) => b['Lucro %'] - a['Lucro %']);
            
        const totalCmvInsumo = simulations.reduce((acc, s) => acc + s.totalCmv, 0);
        const totalCmvOp = simulations.reduce((acc, s) => acc + (s.grossCost - s.totalCmv), 0);
        
        const costCompositionDataResult = [
            { name: 'Custo de insumos', value: totalCmvInsumo },
            { name: 'Custo operacional', value: totalCmvOp },
        ];

        return { kpis: kpisResult, profitChartData: profitChartDataResult, costCompositionData: costCompositionDataResult };
    }, [simulations, pricingParameters]);

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
                <p className="mt-1 text-sm">Crie ou ajuste os filtros para visualizar os dados no dashboard.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Itens na meta</CardTitle>
                        <Target className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{kpis.okPercentage?.toFixed(1)}%</div>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Lucratividade Média</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.averageProfit?.toFixed(2)}%</div>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Markup Médio</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.averageMarkup?.toFixed(2)}x</div>
                         <p className="text-xs text-muted-foreground">
                           Preço de venda / Custo Bruto
                        </p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Aumento Médio</CardTitle>
                        <ArrowUpCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(kpis.averagePriceDelta)}</div>
                        <p className="text-xs text-muted-foreground">
                           Necessário para atingir a meta
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Menor Margem</CardTitle>
                        <TrendingDown className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-lg font-bold truncate">{kpis.lowestMarginItem?.name}</div>
                        <p className="text-xs text-muted-foreground">
                            {kpis.lowestMarginItem?.profitPercentage?.toFixed(2)}%
                        </p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Itens p/ Revisar</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-500">{kpis.reviewPercentage?.toFixed(1)}%</div>
                    </CardContent>
                </Card>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle>Lucratividade por mercadoria</CardTitle>
                        <CardDescription>Visualização do lucro percentual de cada item.</CardDescription>
                    </CardHeader>
                    <CardContent>
                         <ResponsiveContainer width="100%" height={350}>
                            <BarChart data={profitChartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={80} interval={0} />
                                <YAxis unit="%" />
                                <Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} />
                                <Bar dataKey="Lucro %" radius={[4, 4, 0, 0]}>
                                    {profitChartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={getProfitColorClass(entry['Lucro %'])} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Composição de custo</CardTitle>
                         <CardDescription>Proporção média entre custos de insumos e custos operacionais.</CardDescription>
                    </CardHeader>
                     <CardContent>
                        <ResponsiveContainer width="100%" height={350}>
                            <PieChart>
                                <Pie data={costCompositionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                                    <Cell fill="hsl(var(--chart-1))" />
                                    <Cell fill="hsl(var(--chart-2))" />
                                </Pie>
                                <Tooltip formatter={formatCurrency} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
