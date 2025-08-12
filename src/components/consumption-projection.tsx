
"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { convertValue } from '@/lib/conversion';
import { differenceInDays, parseISO, addDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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
    projectedLoss: number;
    baseUnit: string;
    status: 'ok' | 'at_risk' | 'no_data' | 'no_expiry' | 'conversion_error';
    projectedConsumptionDate: Date | null;
    expiryDate: Date | null;
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

        const dailyAverages = new Map<string, number>();
        
        const reportsForAnalysis = selectedKioskId === 'matriz'
            ? consumptionHistory
            : consumptionHistory.filter(report => report.kioskId === selectedKioskId);

        baseProducts.forEach(bp => {
            const consumptionData: { [monthYear: string]: number } = {};
            const reportsToUse = selectedKioskId === 'matriz' ? consumptionHistory : reportsForAnalysis;
            
            reportsToUse.forEach(report => {
                const item = report.results.find(res => res.baseProductId === bp.id);
                if (item) {
                    const key = `${report.year}-${report.month}`;
                    consumptionData[key] = (consumptionData[key] || 0) + (item.consumedQuantity || 0);
                }
            });
            
            const monthsWithConsumption = Object.values(consumptionData);
            const totalConsumption = monthsWithConsumption.reduce((sum, qty) => sum + qty, 0);

            if (monthsWithConsumption.length > 0) {
                const monthlyAvg = totalConsumption / monthsWithConsumption.length;
                dailyAverages.set(bp.id, monthlyAvg / 30);
            }
        });
        
        const kioskLots = lots.filter(lot => lot.kioskId === selectedKioskId && lot.quantity > 0);
        
        return kioskLots.map(lot => {
            if (!lot.expiryDate) {
                 return {
                    lot,
                    productName: getProductFullName(products.find(p => p.id === lot.productId)),
                    daysRemaining: Infinity,
                    projectedLoss: 0,
                    baseUnit: '',
                    status: 'no_expiry',
                    projectedConsumptionDate: null,
                    expiryDate: null,
                };
            }

            const product = products.find(p => p.id === lot.productId);
            const expiryDate = parseISO(lot.expiryDate);

            if (!product || !product.baseProductId) return null;

            const baseProduct = baseProducts.find(bp => bp.id === product.baseProductId);
            if (!baseProduct) return null;

            const dailyAvg = dailyAverages.get(baseProduct.id);
            if (dailyAvg === undefined || dailyAvg <= 0) {
                return {
                    lot,
                    productName: getProductFullName(product),
                    daysRemaining: 0,
                    projectedLoss: 0,
                    baseUnit: baseProduct.unit,
                    status: 'no_data',
                    projectedConsumptionDate: null,
                    expiryDate
                };
            }
            
            let lotQtyInBaseUnit = 0;
            try {
                if (product.category === baseProduct.category) {
                    const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                    lotQtyInBaseUnit = lot.quantity * valueOfOnePackageInBase;
                } else if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                    const secondaryUnitCategory = product.category === 'Unidade' ? 'Massa' : product.category;
                    if (secondaryUnitCategory !== baseProduct.category) {
                         throw new Error('Incompatible secondary unit category');
                    }
                    const valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                    lotQtyInBaseUnit = lot.quantity * valueOfOnePackageInBase;
                } else {
                    throw new Error('Incompatible categories without secondary unit');
                }
            } catch (err) {
                 console.error("Error converting lot quantity for projection:", err);
                 return {
                    lot,
                    productName: getProductFullName(product),
                    daysRemaining: 0,
                    projectedLoss: 0,
                    baseUnit: baseProduct.unit,
                    status: 'conversion_error',
                    projectedConsumptionDate: null,
                    expiryDate
                };
            }
            
            const daysToConsume = lotQtyInBaseUnit > 0 && dailyAvg > 0 ? lotQtyInBaseUnit / dailyAvg : Infinity;
            const projectedConsumptionDate = isFinite(daysToConsume) ? addDays(new Date(), daysToConsume) : null;
            const status = (projectedConsumptionDate && projectedConsumptionDate < expiryDate) ? 'ok' : 'at_risk';
            
            const daysRemaining = differenceInDays(expiryDate, new Date());
            let projectedLoss = 0;
            if (status === 'at_risk' && daysRemaining > 0) {
                const consumptionUntilExpiry = dailyAvg * daysRemaining;
                projectedLoss = Math.max(0, lotQtyInBaseUnit - consumptionUntilExpiry);
            }

            return {
                lot,
                productName: getProductFullName(product),
                daysRemaining,
                projectedLoss,
                baseUnit: baseProduct.unit,
                status,
                projectedConsumptionDate,
                expiryDate
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
             case 'no_expiry':
                return <Badge variant="secondary">Validade indefinida</Badge>;
             case 'conversion_error':
                return <Badge variant="destructive">Erro de conversão</Badge>;
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
                                    <TableHead className="text-center">Vencimento do Lote</TableHead>
                                    <TableHead className="text-center">Previsão de Término</TableHead>
                                    <TableHead className="text-center">Perda Estimada</TableHead>
                                    <TableHead className="text-center">Situação</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {projectionResults.map(result => (
                                    <TableRow key={result.lot.id}>
                                        <TableCell className="font-medium">{result.productName}</TableCell>
                                        <TableCell>{result.lot.lotNumber}</TableCell>
                                        <TableCell className="text-center font-semibold">
                                            {result.expiryDate ? format(result.expiryDate, 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {result.projectedConsumptionDate ? format(result.projectedConsumptionDate, 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}
                                        </TableCell>
                                        <TableCell className="text-center text-destructive font-bold">
                                            {result.status === 'at_risk' && result.projectedLoss > 0 
                                                ? `${result.projectedLoss.toLocaleString(undefined, {maximumFractionDigits: 2})} ${result.baseUnit}`
                                                : '-'}
                                        </TableCell>
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
