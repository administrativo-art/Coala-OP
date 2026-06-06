
"use client";

import { useMemo, useState } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useCompetitors } from "@/hooks/use-competitors";
import { type CompetitorProduct } from "@/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";
import { Download, Inbox, AlertTriangle, Plus } from "lucide-react";
import { CompetitorPriceModal } from "./competitor-price-modal";

const formatCurrency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const STALE_DAYS = 30;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
const formatShortDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

interface PriceComparisonTableProps {
    selectedCompetitorIds?: string[];
}

export function PriceComparisonTable({ selectedCompetitorIds = [] }: PriceComparisonTableProps) {
    const { simulations, loading: loadingSimulations } = useProductSimulation();
    const { competitors, competitorProducts, competitorPrices, loading: loadingCompetitors } = useCompetitors();
    const [priceModalProduct, setPriceModalProduct] = useState<CompetitorProduct | null>(null);

    const loading = loadingSimulations || loadingCompetitors;

    // competitorProductId -> preço mais recente
    const priceMap = useMemo(() => {
        const map = new Map<string, { price: number; date: string }>();
        competitorPrices.forEach(price => {
            if (!map.has(price.competitorProductId) || new Date(price.data_coleta) > new Date(map.get(price.competitorProductId)!.date)) {
                map.set(price.competitorProductId, { price: price.price, date: price.data_coleta });
            }
        });
        return map;
    }, [competitorPrices]);

    const competitorProductMap = useMemo(() => {
        const map = new Map<string, CompetitorProduct[]>();
        competitorProducts.forEach(p => {
            const list = map.get(p.competitorId) || [];
            list.push(p);
            map.set(p.competitorId, list);
        });
        return map;
    }, [competitorProducts]);

    const correlatedSimulations = useMemo(() => {
        if (selectedCompetitorIds.length === 0) return [];
        const correlatedIds = new Set<string>();
        selectedCompetitorIds.forEach(competitorId => {
            (competitorProductMap.get(competitorId) || []).forEach(p => {
                if (p.ksProductId) correlatedIds.add(p.ksProductId);
            });
        });
        return simulations.filter(sim => correlatedIds.has(sim.id));
    }, [simulations, selectedCompetitorIds, competitorProductMap]);

    // Resumo: percorre cada (mercadoria × concorrente) com preço coletado.
    const summary = useMemo(() => {
        let above = 0, below = 0, neutral = 0, stale = 0;
        const gaps: number[] = [];
        correlatedSimulations.forEach(sim => {
            selectedCompetitorIds.forEach(competitorId => {
                const prod = (competitorProductMap.get(competitorId) || []).find(p => p.ksProductId === sim.id);
                const latest = prod ? priceMap.get(prod.id) : undefined;
                if (!latest || !(sim.salePrice > 0) || !(latest.price > 0)) return;
                const gap = ((sim.salePrice / latest.price) - 1) * 100;
                gaps.push(gap);
                if (gap > 5) above++; else if (gap < -5) below++; else neutral++;
                if (daysSince(latest.date) > STALE_DAYS) stale++;
            });
        });
        const avgGap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0;
        return { above, below, neutral, stale, avgGap, total: gaps.length };
    }, [correlatedSimulations, selectedCompetitorIds, competitorProductMap, priceMap]);

    const handleExportCsv = () => {
        const header = ['Mercadoria', 'Seu preço', 'Sua margem %', ...selectedCompetitorIds.map(id => competitors.find(c => c.id === id)?.name ?? id)];
        const rows = correlatedSimulations.map(sim => {
            const cols = [sim.name, sim.salePrice.toFixed(2).replace('.', ','), sim.profitPercentage?.toFixed(1).replace('.', ',') ?? ''];
            selectedCompetitorIds.forEach(competitorId => {
                const prod = (competitorProductMap.get(competitorId) || []).find(p => p.ksProductId === sim.id);
                const latest = prod ? priceMap.get(prod.id) : undefined;
                cols.push(latest ? latest.price.toFixed(2).replace('.', ',') : '');
            });
            return cols;
        });
        const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
        const blob = new Blob(["﻿" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `estudo-de-preco-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) return <Skeleton className="h-64 w-full" />;

    if (selectedCompetitorIds.length === 0) {
        return (
            <div className="rounded-lg border-2 border-dashed py-16 text-center text-muted-foreground">
                <Inbox className="mx-auto mb-4 h-12 w-12" />
                <p className="font-semibold">Selecione um ou mais concorrentes</p>
                <p className="text-sm">A análise comparativa será exibida aqui.</p>
            </div>
        );
    }

    if (correlatedSimulations.length === 0) {
        return (
            <div className="rounded-lg border-2 border-dashed py-16 text-center text-muted-foreground">
                <Inbox className="mx-auto mb-4 h-12 w-12" />
                <p className="font-semibold">Nenhuma mercadoria correlacionada</p>
                <p className="text-sm">Nenhuma de suas mercadorias está vinculada a produtos dos concorrentes selecionados.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Resumo */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold text-red-600">{summary.above}</p>
                    <p className="text-xs text-muted-foreground">Itens acima do concorrente</p>
                </div>
                <div className="rounded-lg border p-3">
                    <p className="text-2xl font-bold text-green-600">{summary.below}</p>
                    <p className="text-xs text-muted-foreground">Itens abaixo do concorrente</p>
                </div>
                <div className="rounded-lg border p-3">
                    <p className={cn("text-2xl font-bold", summary.avgGap > 0 ? "text-red-600" : summary.avgGap < 0 ? "text-green-600" : "")}>
                        {summary.avgGap > 0 ? '+' : ''}{summary.avgGap.toFixed(0)}%
                    </p>
                    <p className="text-xs text-muted-foreground">Gap médio de preço</p>
                </div>
                <div className="rounded-lg border p-3">
                    <p className={cn("text-2xl font-bold", summary.stale > 0 && "text-amber-600")}>{summary.stale}</p>
                    <p className="text-xs text-muted-foreground">Preços desatualizados (&gt;{STALE_DAYS}d)</p>
                </div>
            </div>

            <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                    <Download className="mr-2 h-4 w-4" /> Exportar CSV
                </Button>
            </div>

            <div className="overflow-x-auto rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[28%]">Sua Mercadoria</TableHead>
                            <TableHead className="text-right">Seu Preço</TableHead>
                            <TableHead className="text-right">Sua Margem</TableHead>
                            {selectedCompetitorIds.map(id => {
                                const competitor = competitors.find(c => c.id === id);
                                return <TableHead key={id} className="text-right">{competitor?.name}</TableHead>;
                            })}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {correlatedSimulations.map(sim => (
                            <TableRow key={sim.id}>
                                <TableCell className="font-medium">{sim.name}</TableCell>
                                <TableCell className="text-right font-bold">{formatCurrency(sim.salePrice)}</TableCell>
                                <TableCell className="text-right">
                                    {typeof sim.profitPercentage === 'number' ? (
                                        <span className={cn(sim.profitPercentage < 0 && "text-red-600")}>{sim.profitPercentage.toFixed(0)}%</span>
                                    ) : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                {selectedCompetitorIds.map(competitorId => {
                                    const competitorProds = competitorProductMap.get(competitorId) || [];
                                    const correlatedProd = competitorProds.find(p => p.ksProductId === sim.id);
                                    const latestPrice = correlatedProd ? priceMap.get(correlatedProd.id) : undefined;

                                    if (!correlatedProd) {
                                        return <TableCell key={competitorId} className="text-right text-muted-foreground">—</TableCell>;
                                    }

                                    if (!latestPrice) {
                                        return (
                                            <TableCell key={competitorId} className="text-right">
                                                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setPriceModalProduct(correlatedProd)}>
                                                    <Plus className="mr-1 h-3 w-3" /> Registrar preço
                                                </Button>
                                            </TableCell>
                                        );
                                    }

                                    const impact = sim.salePrice > 0 ? ((sim.salePrice / latestPrice.price) - 1) * 100 : null;
                                    const stale = daysSince(latestPrice.date) > STALE_DAYS;
                                    const marginAtComp = latestPrice.price > 0 ? ((latestPrice.price - sim.totalCmv) / latestPrice.price) * 100 : null;

                                    let impactBadge = null;
                                    if (impact !== null) {
                                        if (impact > 5) impactBadge = <Badge className="bg-red-100 text-red-800">+{impact.toFixed(0)}% Acima</Badge>;
                                        else if (impact < -5) impactBadge = <Badge className="bg-green-100 text-green-800">{impact.toFixed(0)}% Abaixo</Badge>;
                                        else impactBadge = <Badge variant="secondary">Neutro</Badge>;
                                    }

                                    return (
                                        <TableCell key={competitorId} className="text-right">
                                            <button
                                                type="button"
                                                onClick={() => setPriceModalProduct(correlatedProd)}
                                                className="ml-auto flex flex-col items-end gap-0.5 rounded-md p-1 transition-colors hover:bg-muted"
                                                title="Ver histórico / registrar preço"
                                            >
                                                <span className="font-medium">{formatCurrency(latestPrice.price)}</span>
                                                {impactBadge}
                                                <span className={cn("flex items-center gap-1 text-[10px]", stale ? "text-amber-600" : "text-muted-foreground")}>
                                                    {stale && <AlertTriangle className="h-2.5 w-2.5" />}
                                                    {formatShortDate(latestPrice.date)}
                                                </span>
                                                {impact !== null && impact > 5 && marginAtComp !== null && (
                                                    <span className={cn("text-[10px]", marginAtComp < 0 ? "text-red-600" : "text-muted-foreground")}>
                                                        margem a esse preço: {marginAtComp.toFixed(0)}%
                                                    </span>
                                                )}
                                            </button>
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {priceModalProduct && (
                <CompetitorPriceModal
                    isOpen={!!priceModalProduct}
                    onClose={() => setPriceModalProduct(null)}
                    product={priceModalProduct}
                />
            )}
        </div>
    );
}
