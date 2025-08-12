"use client";

import { useState, useMemo, useEffect } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { convertValue } from '@/lib/conversion';
import { format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from './ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Package, Inbox, ListFilter, HelpCircle, ArrowDownUp } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
import { ScrollArea } from './ui/scroll-area';
import { type LotEntry, type BaseProduct } from '@/types';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ISODate = string; // "YYYY-MM-DD"

// Consistent date helpers to avoid timezone issues
const fmtDate = (d: Date): ISODate => {
  return format(d, 'yyyy-MM-dd');
};

const parseISODate = (isoDate: ISODate): Date => {
    return parse(isoDate, 'yyyy-MM-dd', new Date());
};

const addDays = (d: ISODate, n: number): ISODate => {
  const dt = parseISODate(d);
  dt.setDate(dt.getDate() + n);
  return fmtDate(dt);
};

const diffISODays = (a: ISODate, b: ISODate): number => {
  const da = parseISODate(a);
  const db = parseISODate(b);
  return Math.floor((db.getTime() - da.getTime()) / (24 * 60 * 60 * 1000));
};


interface ProjectionResult {
    lot: LotEntry;
    productName: string;
    lotQtyInBaseUnit: number;
    dailyAvg: number;
    daysRemaining: number;
    projectedLoss: number;
    baseUnit: string;
    status: 'ok' | 'at_risk' | 'no_data' | 'no_expiry' | 'conversion_error';
    projectedConsumptionDate: Date | null;
    projectedConsumptionStartDate: Date | null;
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
    const [showOnlyAtRisk, setShowOnlyAtRisk] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: keyof ProjectionResult | 'productName', direction: 'asc' | 'desc' }>({ key: 'daysRemaining', direction: 'asc' });

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
        }, {} as Record<string, LotEntry[]>);

        const allResults: ProjectionResult[] = [];
        const todayISO = fmtDate(new Date());

        Object.keys(lotsByBaseProduct).forEach(baseProductId => {
            let consumptionTrackerDate = todayISO;
            
            const groupLots = lotsByBaseProduct[baseProductId].sort((a,b) => {
                const ae = a.expiryDate ? fmtDate(parseISODate(a.expiryDate.split('T')[0])) : '9999-12-31';
                const be = b.expiryDate ? fmtDate(parseISODate(b.expiryDate.split('T')[0])) : '9999-12-31';
                if (ae !== be) return ae < be ? -1 : 1;
                return String(a.lotNumber ?? a.id).localeCompare(String(b.lotNumber ?? b.id));
            });

            const baseProduct = baseProducts.find(bp => bp.id === baseProductId);
            if (!baseProduct) return;

            const dailyAvg = dailyAverages.get(baseProductId) ?? 0;

            for (const lot of groupLots) {
                const product = products.find(p => p.id === lot.productId)!;
                let result: Omit<ProjectionResult, 'status'>;
                let status: ProjectionResult['status'];
                const startDateISO = consumptionTrackerDate;

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


                if (!lot.expiryDate) {
                    status = 'no_expiry';
                    result = {
                        lot, productName: getProductFullName(product), lotQtyInBaseUnit, dailyAvg, daysRemaining: Number.MAX_SAFE_INTEGER,
                        projectedLoss: 0, baseUnit: baseProduct.unit, projectedConsumptionDate: null, 
                        projectedConsumptionStartDate: null, expiryDate: null,
                    };
                    allResults.push({ ...result, status });
                    continue;
                }
                
                const expiryDateISO = fmtDate(parseISODate(lot.expiryDate.split('T')[0]));
                const daysRemaining = diffISODays(todayISO, expiryDateISO);

                if (hasConversionError) {
                    status = 'conversion_error';
                } else if (dailyAvg <= 0) {
                     status = 'no_data';
                } else {
                    const daysToConsumeLot = Math.ceil(lotQtyInBaseUnit / dailyAvg);
                    const validDaysForConsumption = Math.max(0, diffISODays(startDateISO, expiryDateISO) + 1);
                    const consumptionUntilExpiry = Math.min(lotQtyInBaseUnit, validDaysForConsumption * dailyAvg);
                    const estimatedLoss = Math.max(0, lotQtyInBaseUnit - consumptionUntilExpiry);
                    
                    let projectedEndDateISO: ISODate;
                    if (estimatedLoss > 0.001) { // Use tolerance for float comparison
                        status = 'at_risk';
                        projectedEndDateISO = expiryDateISO;
                        consumptionTrackerDate = addDays(expiryDateISO, 1);
                    } else {
                        status = 'ok';
                        projectedEndDateISO = addDays(startDateISO, Math.max(0, daysToConsumeLot - 1));
                        consumptionTrackerDate = addDays(projectedEndDateISO, 1);
                    }

                    result = {
                        lot, productName: getProductFullName(product), lotQtyInBaseUnit, dailyAvg, daysRemaining,
                        projectedLoss: estimatedLoss, baseUnit: baseProduct.unit,
                        projectedConsumptionDate: parseISODate(projectedEndDateISO),
                        projectedConsumptionStartDate: parseISODate(startDateISO),
                        expiryDate: parseISODate(expiryDateISO)
                    };
                    allResults.push({ ...result, status });
                    continue; // Skip to next lot
                }

                // Common result structure for errors/no_data
                 result = {
                    lot, productName: getProductFullName(product), lotQtyInBaseUnit, dailyAvg, daysRemaining,
                    projectedLoss: 0, baseUnit: baseProduct.unit, projectedConsumptionDate: null,
                    projectedConsumptionStartDate: parseISODate(startDateISO), expiryDate: parseISODate(expiryDateISO)
                };
                allResults.push({ ...result, status });
            }
        });

        return allResults;

    }, [selectedKioskId, loading, consumptionHistory, baseProducts, lots, products, getProductFullName, selectedBaseProductIds]);
    
    const finalFilteredAndSortedResults = useMemo(() => {
        let results = projectionResults;
        if (showOnlyAtRisk) {
            results = results.filter(r => r.status === 'at_risk');
        }

        return results.sort((a, b) => {
            const key = sortConfig.key;
            let valA = a[key as keyof ProjectionResult];
            let valB = b[key as keyof ProjectionResult];

            // Special handling for productName which is not on the object itself
            if(key === 'productName') {
                valA = a.productName;
                valB = b.productName;
            }

            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            
            let comparison = 0;
            if (typeof valA === 'string' && typeof valB === 'string') {
                comparison = valA.localeCompare(valB);
            } else if (typeof valA === 'number' && typeof valB === 'number') {
                comparison = valA - valB;
            } else if (valA instanceof Date && valB instanceof Date) {
                comparison = valA.getTime() - valB.getTime();
            }

            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });

    }, [projectionResults, showOnlyAtRisk, sortConfig]);

    const getStatusBadge = (result: ProjectionResult) => {
        switch (result.status) {
            case 'ok':
                return <Badge variant="secondary" className="bg-green-600 text-white"><CheckCircle className="mr-1 h-3 w-3" /> OK</Badge>;
            case 'at_risk':
                return <Badge variant="destructive" className="bg-orange-500 text-white"><AlertTriangle className="mr-1 h-3 w-3" /> Risco</Badge>;
            case 'no_data':
                return <Badge variant="outline">Sem dados</Badge>;
             case 'no_expiry':
                return <Badge variant="secondary">S/ Vencimento</Badge>;
             case 'conversion_error':
                return <Badge variant="destructive">Erro Conversão</Badge>;
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
    
    const handleSort = (key: keyof ProjectionResult | 'productName') => {
        if (sortConfig.key === key) {
            setSortConfig({ key, direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' });
        } else {
            setSortConfig({ key, direction: 'asc' });
        }
    };

    const renderSortableHeader = (label: string, key: keyof ProjectionResult | 'productName') => (
        <TableHead className="cursor-pointer" onClick={() => handleSort(key)}>
            <div className="flex items-center gap-2">
                {label}
                {sortConfig.key === key && <ArrowDownUp className="h-3 w-3" />}
            </div>
        </TableHead>
    );

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
                            <DropdownMenuItem onSelect={() => setShowOnlyAtRisk(prev => !prev)}>
                                <DropdownMenuCheckboxItem checked={showOnlyAtRisk} onCheckedChange={() => {}} onSelect={e => e.preventDefault()} />
                                Mostrar somente em risco
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Exibir insumos base</DropdownMenuLabel>
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
                ) : finalFilteredAndSortedResults.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Inbox className="mx-auto h-12 w-12" />
                        <p className="mt-4 font-semibold">Nenhum lote encontrado para este quiosque e filtros.</p>
                    </div>
                ) : (
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    {renderSortableHeader('Insumo', 'productName')}
                                    <TableHead>Lote</TableHead>
                                    <TableHead className="text-center">Qtd. (Base)</TableHead>
                                    <TableHead className="text-center">Taxa/dia</TableHead>
                                    {renderSortableHeader('Período de Consumo', 'projectedConsumptionDate')}
                                    {renderSortableHeader('Vencimento', 'expiryDate')}
                                    <TableHead className="text-center">Perda Estimada</TableHead>
                                    <TableHead className="text-center">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {finalFilteredAndSortedResults.map(result => (
                                    <TableRow key={result.lot.id}>
                                        <TableCell className="font-medium">{result.productName}</TableCell>
                                        <TableCell>{result.lot.lotNumber}</TableCell>
                                        <TableCell className="text-center">{result.lotQtyInBaseUnit.toLocaleString(undefined, {maximumFractionDigits:1})} {result.baseUnit}</TableCell>
                                        <TableCell className="text-center">{result.dailyAvg.toLocaleString(undefined, {maximumFractionDigits:1})} {result.baseUnit}</TableCell>
                                        <TableCell className="text-center">
                                            {result.projectedConsumptionStartDate && result.projectedConsumptionDate ? (
                                                `${format(result.projectedConsumptionStartDate, 'dd/MM')} → ${format(result.projectedConsumptionDate, 'dd/MM/yy')}`
                                            ) : 'N/A'}
                                        </TableCell>
                                        <TableCell className="text-center font-semibold">
                                            {result.expiryDate ? (
                                                <div className="flex flex-col items-center">
                                                    <span>{format(result.expiryDate, 'dd/MM/yyyy')}</span>
                                                    <span className="text-xs text-muted-foreground">({result.daysRemaining} dias)</span>
                                                </div>
                                            ) : 'N/A'}
                                        </TableCell>
                                        <TableCell className="text-center text-destructive font-bold">
                                            {result.status === 'at_risk' && result.projectedLoss > 0 ? (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="flex items-center justify-center gap-1 cursor-help">
                                                                {result.projectedLoss.toLocaleString(undefined, {maximumFractionDigits: 2})} {result.baseUnit} <HelpCircle className="h-3 w-3" />
                                                            </span>
                                                        </TooltipTrigger>
                                                        <TooltipContent><p>Estimativa de perda se o consumo se mantiver.</p></TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                                ) : '-'}
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
