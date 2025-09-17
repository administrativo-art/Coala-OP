
"use client";

import { useMemo, useState } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useCompetitors } from "@/hooks/use-competitors";
import { type ProductSimulation, type Competitor, type CompetitorProduct, type CompetitorPrice } from "@/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";
import { Wand2, Download, Inbox } from "lucide-react";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

interface PriceComparisonTableProps {
    selectedCompetitorIds: string[];
}

export function PriceComparisonTable({ selectedCompetitorIds }: PriceComparisonTableProps) {
    const { simulations, loading: loadingSimulations } = useProductSimulation();
    const { competitors, competitorProducts, competitorPrices, loading: loadingCompetitors } = useCompetitors();

    const loading = loadingSimulations || loadingCompetitors;

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
            const products = competitorProductMap.get(competitorId) || [];
            products.forEach(p => {
                if(p.ksProductId) correlatedIds.add(p.ksProductId);
            });
        });

        return simulations.filter(sim => correlatedIds.has(sim.id));

    }, [simulations, selectedCompetitorIds, competitorProductMap]);
    
    const handleExportPdf = () => {
        const doc = new jsPDF();
        const selectedCompetitors = competitors.filter(c => selectedCompetitorIds.includes(c.id));

        doc.setFontSize(18);
        doc.text(`Análise de Preços vs Concorrência`, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Concorrentes: ${selectedCompetitors.map(c => c.name).join(', ')}`, 14, 29);

        const head = [['Sua Mercadoria', 'Seu Preço', ...selectedCompetitors.map(c => c.name)]];
        const body = correlatedSimulations.map(sim => {
             const row = [sim.name, formatCurrency(sim.salePrice)];
             selectedCompetitors.forEach(c => {
                const competitorProds = competitorProductMap.get(c.id) || [];
                const correlatedProd = competitorProds.find(p => p.ksProductId === sim.id);
                const latestPrice = correlatedProd ? priceMap.get(correlatedProd.id) : undefined;
                
                let cellText = '-';
                if (latestPrice) {
                    cellText = formatCurrency(latestPrice.price);
                    if (sim.salePrice > 0) {
                        const impact = ((sim.salePrice / latestPrice.price) - 1) * 100;
                        if (impact > 5) {
                            cellText += `\n(+${impact.toFixed(0)}% Acima)`;
                        } else if (impact < -5) {
                            cellText += `\n(${impact.toFixed(0)}% Abaixo)`;
                        }
                    }
                }
                row.push(cellText);
             });
             return row;
        });

        autoTable(doc, {
            startY: 40,
            head: head,
            body: body,
            theme: 'grid',
            headStyles: { fillColor: '#3F51B5' },
        });

        doc.save(`analise_precos_${new Date().toISOString().slice(0,10)}.pdf`);
    };

    if (loading) {
        return <Skeleton className="h-64 w-full" />;
    }
    
    if (selectedCompetitorIds.length === 0) {
        return (
             <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                <Inbox className="h-12 w-12 mx-auto mb-4" />
                <p className="font-semibold">Selecione um ou mais concorrentes</p>
                <p className="text-sm">A análise comparativa será exibida aqui.</p>
            </div>
        );
    }
    
     if (correlatedSimulations.length === 0) {
        return (
             <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                <Inbox className="h-12 w-12 mx-auto mb-4" />
                <p className="font-semibold">Nenhuma mercadoria correlacionada</p>
                <p className="text-sm">Nenhuma de suas mercadorias está vinculada a produtos dos concorrentes selecionados.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
             <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleExportPdf}>
                    <Download className="mr-2" /> Exportar Análise em PDF
                </Button>
            </div>
            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[30%]">Sua Mercadoria</TableHead>
                            <TableHead className="text-right">Seu Preço</TableHead>
                            {selectedCompetitorIds.map(id => {
                                const competitor = competitors.find(c => c.id === id);
                                return <TableHead key={id} className="text-right">{competitor?.name}</TableHead>
                            })}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {correlatedSimulations.map(sim => (
                            <TableRow key={sim.id}>
                                <TableCell className="font-medium">{sim.name}</TableCell>
                                <TableCell className="text-right font-bold">{formatCurrency(sim.salePrice)}</TableCell>
                                {selectedCompetitorIds.map(competitorId => {
                                    const competitorProds = competitorProductMap.get(competitorId) || [];
                                    const correlatedProd = competitorProds.find(p => p.ksProductId === sim.id);
                                    const latestPrice = correlatedProd ? priceMap.get(correlatedProd.id) : undefined;
                                    
                                    let impact = null;
                                    if (latestPrice && sim.salePrice > 0) {
                                        impact = ((sim.salePrice / latestPrice.price) - 1) * 100;
                                    }

                                    let impactBadge;
                                    if (impact !== null) {
                                        if (impact > 5) impactBadge = <Badge className="bg-red-100 text-red-800">+{impact.toFixed(0)}% Acima</Badge>;
                                        else if (impact < -5) impactBadge = <Badge className="bg-green-100 text-green-800">{impact.toFixed(0)}% Abaixo</Badge>;
                                        else impactBadge = <Badge variant="secondary">Neutro</Badge>;
                                    }

                                    return (
                                        <TableCell key={competitorId} className="text-right">
                                            {latestPrice ? (
                                                <div className="flex flex-col items-end">
                                                    <span>{formatCurrency(latestPrice.price)}</span>
                                                    {impactBadge}
                                                </div>
                                            ) : <Badge variant="outline">Sem preço</Badge>}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
