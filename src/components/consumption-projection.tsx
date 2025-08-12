
"use client";

import { useState, useMemo, useEffect } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { convertValue } from '@/lib/conversion';
import { differenceInDays, parseISO, addDays, format, isAfter } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from './ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Package, Inbox, ListFilter } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
import { ScrollArea } from './ui/scroll-area';

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
    const [selectedBaseProductIds, setSelectedBaseProductIds] = useState<string[]>([]);
    const [initialSelectionMade, setInitialSelectionMade] = useState(false);

    const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading || consumptionLoading;

    useEffect(() => {
        if (!initialSelectionMade && baseProducts.length > 0) {
          setSelectedBaseProductIds(baseProducts.map(p => p.id));
          setInitialSelectionMade(true);
        }
    }, [baseProducts, initialSelectionMade]);

    const projectionResults = useMemo((): ProjectionResult[] => {
        if (!selectedKioskId || loading) return [];

        const dailyAverages = new Map<string, number>();
        const reportsForAnalysis = selectedKioskId === 'matriz' ? consumptionHistory : consumptionHistory.filter(report => report.kioskId === selectedKioskId);

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
        
        const lotsByBaseProduct = kioskLots.reduce((acc, lot) => {
            const product = products.find(p => p.id === lot.productId);
            if (product && product.baseProductId && selectedBaseProductIds.includes(product.baseProductId)) {
                if (!acc[product.baseProductId]) {
                    acc[product.baseProductId] = [];
                }
                acc[product.baseProductId].push(lot);
            }
            return acc;
        }, {} as Record<string, import('@/types').LotEntry[]>);

        const allResults: ProjectionResult[] = [];

        Object.keys(lotsByBaseProduct).forEach(baseProductId => {
            let consumptionStartsOn = new Date();
            const groupLots = lotsByBaseProduct[baseProductId].sort((a,b) => {
                if (!a.expiryDate) return 1;
                if (!b.expiryDate) return -1;
                return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
            });

            const baseProduct = baseProducts.find(bp => bp.id === baseProductId);
            if (!baseProduct) return;

            const dailyAvg = dailyAverages.get(baseProductId);

            for (const lot of groupLots) {
                const product = products.find(p => p.id === lot.productId)!;
                let result: ProjectionResult;

                if (!lot.expiryDate) {
                    result = {
                        lot, productName: getProductFullName(product), daysRemaining: Infinity,
                        projectedLoss: 0, baseUnit: '', status: 'no_expiry',
                        projectedConsumptionDate: null, expiryDate: null,
                    };
                    allResults.push(result);
                    continue;
                }

                const expiryDate = parseISO(lot.expiryDate);
                const daysRemaining = differenceInDays(expiryDate, new Date());

                if (dailyAvg === undefined || dailyAvg <= 0) {
                     result = {
                        lot, productName: getProductFullName(product), daysRemaining,
                        projectedLoss: 0, baseUnit: baseProduct.unit, status: 'no_data',
                        projectedConsumptionDate: null, expiryDate
                    };
                    allResults.push(result);
                    continue;
                }

                let lotQtyInBaseUnit = 0;
                let hasConversionError = false;
                try {
                     if (product.category === baseProduct.category) {
                        const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                        lotQtyInBaseUnit = lot.quantity * valueOfOnePackageInBase;
                    } else if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                        const secondaryUnitCategory = product.category === 'Unidade' ? 'Massa' : product.category;
                        if (secondaryUnitCategory !== baseProduct.category) throw new Error('Incompatible secondary unit category');
                        const valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                        lotQtyInBaseUnit = lot.quantity * valueOfOnePackageInBase;
                    } else {
                        throw new Error('Incompatible categories without secondary unit');
                    }
                } catch (err) {
                    console.error("Error converting lot quantity for projection:", err);
                    hasConversionError = true;
                }

                if (hasConversionError) {
                     result = {
                        lot, productName: getProductFullName(product), daysRemaining,
                        projectedLoss: 0, baseUnit: baseProduct.unit, status: 'conversion_error',
                        projectedConsumptionDate: null, expiryDate
                    };
                    allResults.push(result);
                    continue;
                }
                
                const daysToConsume = lotQtyInBaseUnit / dailyAvg;
                const projectedConsumptionDate = addDays(consumptionStartsOn, daysToConsume);
                
                let status: ProjectionResult['status'] = 'ok';
                let projectedLoss = 0;

                if (isAfter(projectedConsumptionDate, expiryDate)) {
                    status = 'at_risk';
                    const daysAfterExpiry = differenceInDays(projectedConsumptionDate, expiryDate);
                    projectedLoss = daysAfterExpiry * dailyAvg;
                }
                
                result = {
                    lot, productName: getProductFullName(product), daysRemaining,
                    projectedLoss, baseUnit: baseProduct.unit, status,
                    projectedConsumptionDate, expiryDate
                };

                allResults.push(result);
                consumptionStartsOn = projectedConsumptionDate;
            }
        });

        return allResults.sort((a,b) => {
            if (a.status === 'at_risk' && b.status !== 'at_risk') return -1;
            if (b.status === 'at_risk' && a.status !== 'at_risk') return 1;
            return a.daysRemaining - b.daysRemaining;
        });

    }, [selectedKioskId, loading, consumptionHistory, baseProducts, lots, products, getProductFullName, selectedBaseProductIds]);
    
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
    
    const handleBaseProductSelection = (baseProductId: string, checked: boolean) => {
        setSelectedBaseProductIds(current => {
            if (checked) {
                return [...current, baseProductId];
            } else {
                return current.filter(id => id !== baseProductId);
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Projeção de Consumo vs. Vencimento</CardTitle>
                <CardDescription>
                    Selecione um quiosque para verificar se os lotes em estoque serão consumidos antes de vencerem, com base na média de consumo.
                </CardDescription>
                <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    <Select value={selectedKioskId} onValueChange={setSelectedKioskId} disabled={loading}>
                        <SelectTrigger className="w-full sm:max-w-xs">
                            <SelectValue placeholder="Selecione um quiosque..." />
                        </SelectTrigger>
                        <SelectContent>
                            {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full sm:w-auto" disabled={!selectedKioskId}>
                                <ListFilter className="mr-2 h-4 w-4" />
                                Filtrar insumos ({selectedBaseProductIds.length})
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-64">
                            <DropdownMenuLabel>Exibir insumos base</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSelectedBaseProductIds(baseProducts.map(p => p.id)); }}>Selecionar todos</DropdownMenuItem>
                            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSelectedBaseProductIds([]); }}>Limpar seleção</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <ScrollArea className="h-60">
                            {baseProducts.sort((a,b) => a.name.localeCompare(b.name)).map(product => (
                                <DropdownMenuCheckboxItem
                                    key={product.id}
                                    checked={selectedBaseProductIds.includes(product.id)}
                                    onCheckedChange={(checked) => handleBaseProductSelection(product.id, !!checked)}
                                    onSelect={(e) => e.preventDefault()}
                                >
                                    {product.name}
                                </DropdownMenuCheckboxItem>
                            ))}
                            </ScrollArea>
                        </DropdownMenuContent>
                    </DropdownMenu>
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
                        <p className="mt-4 font-semibold">Nenhum lote encontrado para este quiosque e filtros.</p>
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

    
