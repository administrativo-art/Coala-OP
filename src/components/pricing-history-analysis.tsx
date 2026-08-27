"use client";

import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { TrendingUp, TrendingDown, Search, CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { calculateGrossMargin, getPricingCommercialStatus } from '@/lib/pricing-insights';

const formatCurrency = (value: number) =>
    value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatPercent = (value: number) =>
    `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;

interface PricingHistoryAnalysisProps {
    simulations: any[];
    priceHistory: any[];
}

export function PricingHistoryAnalysis({ simulations, priceHistory }: PricingHistoryAnalysisProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

    const filtered = useMemo(() => {
        return [...priceHistory]
            .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())
            .filter(entry => {
                const simName = simulations.find(s => s.id === entry.simulationId)?.name || '';
                const matchesSearch = !searchTerm || simName.toLowerCase().includes(searchTerm.toLowerCase());

                let matchesPeriod = true;
                if (dateRange?.from || dateRange?.to) {
                    const entryDate = parseISO(entry.changedAt);
                    if (dateRange.from && isBefore(entryDate, startOfDay(dateRange.from))) matchesPeriod = false;
                    if (dateRange.to && isAfter(entryDate, endOfDay(dateRange.to))) matchesPeriod = false;
                }

                return matchesSearch && matchesPeriod;
            });
    }, [priceHistory, simulations, searchTerm, dateRange]);

    const periodLabel = useMemo(() => {
        if (!dateRange?.from && !dateRange?.to) return null;
        if (dateRange.from && dateRange.to) {
            return `${format(dateRange.from, 'dd/MM/yy')} – ${format(dateRange.to, 'dd/MM/yy')}`;
        }
        if (dateRange.from) return `A partir de ${format(dateRange.from, 'dd/MM/yy')}`;
        return `Até ${format(dateRange.to!, 'dd/MM/yy')}`;
    }, [dateRange]);

    const commercialSummary = useMemo(() => {
        const active = simulations.filter((simulation) => !simulation.isArchived);
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const recent = priceHistory.filter((entry) => new Date(entry.changedAt).getTime() >= cutoff);
        const averageAdjustment = recent.length
            ? recent.reduce((total, entry) => total + (entry.oldPrice > 0 ? ((entry.newPrice - entry.oldPrice) / entry.oldPrice) * 100 : 0), 0) / recent.length
            : 0;
        const averageMargin = active.length
            ? active.reduce((total, simulation) => total + calculateGrossMargin(simulation.salePrice, simulation.totalCmv || 0).percentage, 0) / active.length
            : 0;
        const risks = active
            .map((simulation) => ({
                simulation,
                margin: calculateGrossMargin(simulation.salePrice, simulation.totalCmv || 0).percentage,
                status: getPricingCommercialStatus(simulation.salePrice, simulation.totalCmv || 0, simulation.profitGoal),
            }))
            .sort((left, right) => left.margin - right.margin)
            .slice(0, 5);
        return {
            recentChanges: recent.length,
            changedProducts: new Set(recent.map((entry) => entry.simulationId)).size,
            averageAdjustment,
            averageMargin,
            lossCount: active.filter((simulation) => getPricingCommercialStatus(simulation.salePrice, simulation.totalCmv || 0, simulation.profitGoal) === 'loss').length,
            risks,
        };
    }, [priceHistory, simulations]);

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border bg-white p-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Alterações (30d)</p><p className="mt-1 text-2xl font-black">{commercialSummary.recentChanges}</p><p className="text-[11px] text-slate-400">em {commercialSummary.changedProducts} mercadoria(s)</p></div>
                <div className="rounded-2xl border bg-white p-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Reajuste médio</p><p className="mt-1 text-2xl font-black text-cyan-700">{commercialSummary.averageAdjustment >= 0 ? '+' : ''}{commercialSummary.averageAdjustment.toFixed(1)}%</p><p className="text-[11px] text-slate-400">preço de venda</p></div>
                <div className="rounded-2xl border bg-white p-4"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Margem média</p><p className="mt-1 text-2xl font-black text-emerald-600">{commercialSummary.averageMargin.toFixed(1)}%</p><p className="text-[11px] text-slate-400">margem bruta</p></div>
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4"><p className="text-[10px] font-black uppercase tracking-wide text-red-500">Em prejuízo</p><p className="mt-1 text-2xl font-black text-red-600">{commercialSummary.lossCount}</p><p className="text-[11px] text-red-500">exige reajuste</p></div>
            </div>
            <div className="grid gap-4 xl:grid-cols-[1.6fr_.7fr]">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            {/* Toolbar */}
            <div className="p-4 border-b bg-gray-50/30 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Buscar mercadoria..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 h-10 rounded-xl bg-white border-gray-200"
                    />
                </div>

                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            className={cn(
                                "h-10 rounded-xl border-gray-200 gap-2 font-bold text-xs uppercase",
                                periodLabel && "border-pink-300 text-pink-600 bg-pink-50"
                            )}
                        >
                            <CalendarIcon className="h-4 w-4" />
                            {periodLabel ?? 'Período'}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                        <Calendar
                            mode="range"
                            selected={dateRange}
                            onSelect={setDateRange}
                            locale={ptBR}
                            numberOfMonths={2}
                        />
                    </PopoverContent>
                </Popover>

                {(dateRange?.from || dateRange?.to) && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-muted-foreground"
                        onClick={() => setDateRange(undefined)}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}

                <span className="text-xs text-muted-foreground ml-auto">
                    {filtered.length} {filtered.length === 1 ? 'registro' : 'registros'}
                </span>
            </div>

            {/* Log table */}
            <ScrollArea className="h-[calc(100vh-320px)] min-h-[400px]">
                <Table>
                    <TableHeader className="sticky top-0 bg-white z-10">
                        <TableRow className="hover:bg-transparent border-b">
                            <TableHead className="text-[9px] font-black uppercase tracking-wider h-12 px-6">Data</TableHead>
                            <TableHead className="text-[9px] font-black uppercase tracking-wider h-12 px-6">Mercadoria</TableHead>
                            <TableHead className="text-[9px] font-black uppercase tracking-wider h-12 px-6">Campo</TableHead>
                            <TableHead className="text-[9px] font-black uppercase tracking-wider h-12 px-6">Antes</TableHead>
                            <TableHead className="text-[9px] font-black uppercase tracking-wider h-12 px-6">Depois</TableHead>
                            <TableHead className="text-[9px] font-black uppercase tracking-wider h-12 px-6">Variação</TableHead>
                            <TableHead className="text-[9px] font-black uppercase tracking-wider h-12 px-6">Usuário</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-sm">
                                    Nenhum registro encontrado.
                                </TableCell>
                            </TableRow>
                        ) : filtered.map((entry, i) => {
                            const simName = simulations.find(s => s.id === entry.simulationId)?.name || 'Removida';
                            const variation = entry.oldPrice > 0 ? ((entry.newPrice - entry.oldPrice) / entry.oldPrice) * 100 : 0;
                            const isUp = variation > 0;
                            return (
                                <TableRow key={i} className="hover:bg-gray-50/30 border-b last:border-0 h-12">
                                    <TableCell className="px-6 text-[10px] font-bold text-gray-400">
                                        {format(parseISO(entry.changedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                                    </TableCell>
                                    <TableCell className="px-6 font-bold text-gray-800 text-[11px]">
                                        {simName}
                                    </TableCell>
                                    <TableCell className="px-6">
                                        <Badge variant="outline" className="text-[9px] font-black uppercase border-gray-100 bg-gray-50 text-gray-500">
                                            Preço
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="px-6 text-[11px] font-medium text-gray-400">
                                        {formatCurrency(entry.oldPrice)}
                                    </TableCell>
                                    <TableCell className="px-6 text-[11px] font-black text-gray-900">
                                        {formatCurrency(entry.newPrice)}
                                    </TableCell>
                                    <TableCell className="px-6">
                                        <div className={cn(
                                            "text-[11px] font-black flex items-center gap-1",
                                            isUp ? "text-red-600" : "text-green-600"
                                        )}>
                                            {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                            {formatPercent(variation)}
                                        </div>
                                    </TableCell>
                                    <TableCell className="px-6 text-[10px] font-bold text-gray-600">
                                        {entry.changedBy?.username || 'Sistema'}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
            <h3 className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Maiores riscos de margem</h3>
            <div className="mt-3 space-y-2">
                {commercialSummary.risks.map(({ simulation, margin, status }) => <div key={simulation.id} className={cn('flex items-center justify-between gap-3 rounded-xl border border-l-4 p-3', status === 'loss' ? 'border-red-200 border-l-red-500 bg-red-50' : status === 'below' ? 'border-orange-200 border-l-orange-500 bg-orange-50' : 'border-emerald-200 border-l-emerald-500 bg-emerald-50')}><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{simulation.name}</p><p className="text-[10px] text-slate-500">{status === 'loss' ? 'Prejuízo' : status === 'below' ? 'Abaixo da meta' : status === 'met' ? 'Na meta' : 'Sem meta'}</p></div><strong className={cn('text-sm', status === 'loss' ? 'text-red-600' : status === 'below' ? 'text-orange-600' : 'text-emerald-600')}>{margin.toFixed(1)}%</strong></div>)}
                {!commercialSummary.risks.length ? <p className="py-8 text-center text-xs text-slate-400">Sem mercadorias ativas.</p> : null}
            </div>
        </aside>
            </div>
        </div>
    );
}
