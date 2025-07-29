
"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { convertValue } from '@/lib/conversion';
import { differenceInDays, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from './ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Package, Inbox } from 'lucide-react';

interface ProjectionResult {
    lot: import('@/types').LotEntry;
    productName: string;
    daysRemaining: number;
    projectedConsumption: number;
    status: 'ok' | 'at_risk' | 'no_data';
}

export function ConsumptionProjection() {
    const { kiosks, loading: kiosksLoading } = useKiosks();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { products, getProductFullName, loading: productsLoading } = useProducts();
    const { reports: consumptionHistory, isLoading: consumptionLoading } = useValidatedConsumptionData();
    const [selectedKioskId, setSelectedKioskId] = useState<string>('');

    const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading || consumptionLoading;

    const projectionResults = useMemo((): ProjectionResult[] => {
        if (!selectedKioskId || loading) return [];

        // 1. Calculate daily average consumption for the selected kiosk
        const dailyAverages = new Map<string, number>(); // Map<baseProductId, dailyAvg>
        const kioskReports = consumptionHistory.filter(report => report.kioskId === selectedKioskId);
        
        baseProducts.forEach(bp => {
            const totalConsumption = kioskReports.reduce((sum, report) => {
                const item = report.results.find(res => res.baseProductId === bp.id);
                return sum + (item?.consumedQuantity || 0);
            }, 0);
            
            if (kioskReports.length > 0) {
                const monthlyAvg = totalConsumption / kioskReports.length;
                dailyAverages.set(bp.id, monthlyAvg / 30);
            }
        });
        
        // 2. Analyze each lot in the selected kiosk
        const kioskLots = lots.filter(lot => lot.kioskId === selectedKioskId && lot.quantity > 0);
        
        return kioskLots.map(lot => {
            const product = products.find(p => p.id === lot.productId);
            if (!product || !product.baseProductId) return null;

            const baseProduct = baseProducts.find(bp => bp.id === product.baseProductId);
            if (!baseProduct) return null;

            const dailyAvg = dailyAverages.get(baseProduct.id);
            if (dailyAvg === undefined || dailyAvg <= 0) {
                return {
                    lot,
                    productName: getProductFullName(product),
                    daysRemaining: 0,
                    projectedConsumption: 0,
                    status: 'no_data',
                };
            }
            
            // 3. Calculate days remaining
            const daysRemaining = Math.max(0, differenceInDays(parseISO(lot.expiryDate), new Date()));
            
            // 4. Calculate projected consumption
            const projectedConsumption = dailyAvg * daysRemaining;
            
            // 5. Convert lot quantity to base unit
            let lotQtyInBaseUnit = 0;
            try {
                 const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                 lotQtyInBaseUnit = lot.quantity * valueOfOnePackageInBase;
            } catch (err) {
                 return null; // Cannot convert
            }
            
            // 6. Compare and determine status
            const status = projectedConsumption >= lotQtyInBaseUnit ? 'ok' : 'at_risk';
            
            return {
                lot,
                productName: getProductFullName(product),
                daysRemaining,
                projectedConsumption,
                status,
            };
        }).filter((item): item is ProjectionResult => item !== null)
          .sort((a,b) => {
             if (a.status === 'at_risk' && b.status !== 'at_risk') return -1;
             if (b.status === 'at_risk' && a.status !== 'at_risk') return 1;
             return a.daysRemaining - b.daysRemaining;
          });

    }, [selectedKioskId, loading, consumptionHistory, baseProducts, lots, products, getProductFullName]);
    
    const getStatusBadge = (result: ProjectionResult) => {
        switch (result.status) {
            case 'ok':
                return <Badge variant="secondary" className="bg-green-600 text-white"><CheckCircle className="mr-1 h-3 w-3" /> Será consumido</Badge>;
            case 'at_risk':
                return <Badge variant="destructive" className="bg-orange-500 text-white"><AlertTriangle className="mr-1 h-3 w-3" /> Risco de vencimento</Badge>;
            case 'no_data':
                return <Badge variant="outline">Sem dados de consumo</Badge>;
        }
    };
    
    return (
        <Card>
            <CardHeader>
                <CardTitle>Projeção de Consumo vs. Vencimento</CardTitle>
                <CardDescription>
                    Selecione um quiosque para verificar se os lotes em estoque serão consumidos antes de vencerem, com base na média de consumo.
                </CardDescription>
                <div className="pt-2">
                    <Select value={selectedKioskId} onValueChange={setSelectedKioskId} disabled={loading}>
                        <SelectTrigger className="w-full max-w-sm">
                            <SelectValue placeholder="Selecione um quiosque..." />
                        </SelectTrigger>
                        <SelectContent>
                            {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Skeleton className="h-64 w-full" />
                ) : !selectedKioskId ? (
                    <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Package className="mx-auto h-12 w-12" />
                        <p className="mt-4 font-semibold">Selecione um quiosque para iniciar a análise.</p>
                    </div>
                ) : projectionResults.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Inbox className="mx-auto h-12 w-12" />
                        <p className="mt-4 font-semibold">Nenhum lote encontrado para este quiosque.</p>
                    </div>
                ) : (
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Insumo</TableHead>
                                    <TableHead>Lote</TableHead>
                                    <TableHead className="text-center">Qtd. no Lote</TableHead>
                                    <TableHead className="text-center">Consumo Projetado</TableHead>
                                    <TableHead className="text-center">Situação</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {projectionResults.map(result => (
                                    <TableRow key={result.lot.id}>
                                        <TableCell className="font-medium">{result.productName}</TableCell>
                                        <TableCell>{result.lot.lotNumber}</TableCell>
                                        <TableCell className="text-center">{result.lot.quantity}</TableCell>
                                        <TableCell className="text-center">{result.projectedConsumption.toFixed(2)}</TableCell>
                                        <TableCell className="text-center">{getStatusBadge(result)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
