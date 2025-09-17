
"use client";

import { useMemo, useState } from "react";
import { useProductSimulation } from "@/hooks/use-product-simulation";
import { useCompetitors } from "@/hooks/use-competitors";
import { type ProductSimulation, type Competitor, type CompetitorProduct, type CompetitorPrice } from "@/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function PriceComparisonTable() {
    const { simulations, loading: loadingSimulations } = useProductSimulation();
    const { competitors, competitorProducts, competitorPrices, loading: loadingCompetitors } = useCompetitors();
    
    const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<string[]>([]);

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

    if (loading) {
        return <Skeleton className="h-64 w-full" />
    }

    const handleCompetitorSelection = (competitorId: string) => {
        setSelectedCompetitorIds(prev => 
            prev.includes(competitorId) 
            ? prev.filter(id => id !== competitorId)
            : [...prev, competitorId]
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Comparação de Preços</CardTitle>
                <CardDescription>
                    Selecione os concorrentes para comparar os preços com suas mercadorias.
                </CardDescription>
                <div className="flex flex-wrap gap-2 pt-4">
                    {competitors.map(c => (
                        <Button
                            key={c.id}
                            variant={selectedCompetitorIds.includes(c.id) ? "default" : "outline"}
                            onClick={() => handleCompetitorSelection(c.id)}
                        >
                            {c.name}
                        </Button>
                    ))}
                </div>
            </CardHeader>
            <CardContent>
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
                            {simulations.map(sim => (
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
            </CardContent>
        </Card>
    );
}
