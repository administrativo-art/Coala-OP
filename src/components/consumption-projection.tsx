"use client";

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/use-validated-consumption-data';
import { convertValue } from '@/lib/conversion';
import { format, parseISO, addDays, isAfter, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from './ui/skeleton';
import { AlertTriangle, CheckCircle, Package, Inbox, ListFilter, ArrowUpDown, TrendingUp, LineChart, ShoppingCart, CalendarDays, BellRing, Search, Warehouse, ChevronsUpDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
import { ScrollArea } from './ui/scroll-area';
import { type LotEntry, type BaseProduct, type Product } from '@/types';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import { useAllTasks } from '@/hooks/use-all-tasks';

interface ProjectionResult {
    lot: LotEntry;
    productName: string;
    lotQtyInBaseUnit: number;
    dailyAvg: number;
    daysRemaining: number;
    projectedLoss: number;
    projectedLossCost: number; 
    baseUnit: string;
    status: 'ok' | 'at_risk' | 'no_data' | 'no_expiry' | 'conversion_error';
    projectedConsumptionDate: Date | null;
    projectedConsumptionStartDate: Date | null;
    expiryDate: Date | null;
}

interface GroupedProjectionResult {
    baseProductId: string;
    baseProductName: string;
    lots: ProjectionResult[];
    ruptureDate: Date | null;
    suggestedOrderQty: number | null;
    orderDate: Date | null;
    orderStatus: 'ok' | 'soon' | 'urgent' | 'no_data' | 'sem_lead_time';
    monthlyAvg: number;
}

const formatCurrency = (value: number | undefined | null) => {
    if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

function RuptureAlerts({ results, kioskId }: { results: GroupedProjectionResult[], kioskId: string }) {
    const alerts = useMemo(() => {
        return results
            .filter(r => r.orderStatus === 'urgent' || r.orderStatus === 'soon')
            .sort((a, b) => {
                const dateA = a.orderDate || a.ruptureDate;
                const dateB = b.orderDate || b.ruptureDate;
                if (!dateA) return 1;
                if (!dateB) return -1;
                return dateA.getTime() - dateB.getTime();
            });
    }, [results]);
    
    if (alerts.length === 0) {
        return null;
    }

    const isMatriz = kioskId === 'matriz';

    return (
        <Card className="border-amber-500/50 bg-amber-500/10 mb-6">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle /> Alertas de Reposição e Compra
                </CardTitle>
                <CardDescription>
                    {isMatriz
                        ? "Itens que precisam ser comprados com base no lead time para evitar ruptura na rede."
                        : "Itens que precisam de reposição da matriz para evitar ruptura no quiosque."
                    }
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {alerts.map(alert => {
                        const criticalDate = isMatriz ? alert.orderDate : alert.ruptureDate;
                        return (
                            <div key={alert.baseProductId} className="p-4 border rounded-lg bg-card shadow-sm flex flex-col gap-3">
                                <p className="font-semibold">{alert.baseProductName}</p>
                                <div className="text-sm space-y-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">{isMatriz ? "Pedir até:" : "Ruptura em:"}</span>
                                        <span className="font-bold">{criticalDate ? format(criticalDate, 'dd/MM/yyyy') : 'Imediata'}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Status:</span>
                                        <Badge variant={alert.orderStatus === 'urgent' ? 'destructive' : 'default'} className={alert.orderStatus === 'soon' ? 'bg-orange-500 hover:bg-orange-600' : ''}>
                                            {alert.orderStatus === 'urgent' ? 'Urgente' : 'Pedir em breve'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </CardContent>
        </Card>
    )
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
    const [simulationPercentage, setSimulationPercentage] = useState<number>(0);
    const [searchTerm, setSearchTerm] = useState<string>('');

    const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading || consumptionLoading;

    useEffect(() => {
        if (!initialSelectionMade && baseProducts.length > 0) {
          setSelectedBaseProductIds(baseProducts.map(p => p.id));
          setInitialSelectionMade(true);
        }
    }, [baseProducts, initialSelectionMade]);

    const productsById = useMemo(() => {
      const m = new Map<string, typeof products[number]>();
      products.forEach(p => m.set(p.id, p));
      return m;
    }, [products]);

    const toBaseUnits = useCallback((
        product: typeof products[number],
        packagesQty: number,
        baseProduct: typeof baseProducts[number]
    ): number => {
        const perPackageInBase = convertValue(
            product.packageSize ?? 1,
            product.unit,
            baseProduct.unit,
            product.category
        );
        return packagesQty * perPackageInBase;
    }, []);

    const projectionResults = useMemo((): GroupedProjectionResult[] => {
        if (loading || !selectedKioskId) return [];
        
        const today = new Date();
        const adjustmentFactor = 1 + (simulationPercentage / 100);
        const kioskStockLevels = (bp: BaseProduct) => bp.stockLevels?.[selectedKioskId];

        const isMatrixView = selectedKioskId === 'matriz';
        const relevantReports = isMatrixView
            ? consumptionHistory.filter(r => r.kioskId !== 'matriz')
            : consumptionHistory.filter(r => r.kioskId === selectedKioskId);

        const monthlyConsumptionByBaseId: Record<string, Record<string, number>> = {};
        relevantReports.forEach(report => {
            const key = `${report.year}-${String(report.month).padStart(2, '0')}`;
            report.results.forEach(res => {
                if (res.baseProductId) {
                    if (!monthlyConsumptionByBaseId[res.baseProductId]) monthlyConsumptionByBaseId[res.baseProductId] = {};
                    monthlyConsumptionByBaseId[res.baseProductId][key] = (monthlyConsumptionByBaseId[res.baseProductId][key] || 0) + res.consumedQuantity;
                }
            });
        });
        
        const dailyAverages = new Map<string, number>();
        const monthlyAverages = new Map<string, number>();
        
        Object.entries(monthlyConsumptionByBaseId).forEach(([baseId, monthlyData]) => {
            const months = Object.values(monthlyData);
            const numMonthsWithConsumption = months.filter(val => val > 0).length;

            if (numMonthsWithConsumption > 0) {
                const totalConsumption = months.reduce((sum, val) => sum + val, 0);
                const avg = totalConsumption / numMonthsWithConsumption;
                monthlyAverages.set(baseId, avg);
                dailyAverages.set(baseId, avg / 30);
            }
        });
        
        const kioskLots = lots.filter(lot => lot.kioskId === selectedKioskId && lot.quantity > 0);
        
        const lotsByBaseProduct = kioskLots.reduce((acc, lot) => {
            const product = products.find(p => p.id === lot.productId);
            if (product && product.baseProductId && selectedBaseProductIds.includes(product.baseProductId)) {
                if (!acc[product.baseProductId]) acc[product.baseProductId] = [];
                acc[product.baseProductId].push(lot);
            }
            return acc;
        }, {} as Record<string, LotEntry[]>);

        const allResults: GroupedProjectionResult[] = [];
        
        Object.keys(lotsByBaseProduct).forEach(baseProductId => {
            let currentStockDate = today;
            
            const groupLots = lotsByBaseProduct[baseProductId].sort((a, b) => {
                const dateA = a.expiryDate ? parseISO(a.expiryDate).getTime() : Infinity;
                const dateB = b.expiryDate ? parseISO(b.expiryDate).getTime() : Infinity;
                if (dateA === Infinity && dateB === Infinity) return 0;
                return dateA - dateB;
            });
            

            const baseProduct = baseProducts.find(bp => bp.id === baseProductId);
            if (!baseProduct) return;

            const kioskParams = kioskStockLevels(baseProduct);
            const dailyAvg = (dailyAverages.get(baseProductId) ?? 0) * adjustmentFactor;
            const monthlyAvg = (monthlyAverages.get(baseProductId) ?? 0) * adjustmentFactor;
            const projectedLots: ProjectionResult[] = [];

            let totalStockInBase = groupLots.reduce((sum, lot) => {
                const product = productsById.get(lot.productId)!;
                return sum + toBaseUnits(product, lot.quantity, baseProduct);
            }, 0);
            
            totalStockInBase -= (kioskParams?.safetyStock || 0);

            let ruptureDate: Date | null = null;
            if (dailyAvg > 0 && totalStockInBase > 0) {
                const daysUntilRupture = Math.floor(totalStockInBase / dailyAvg);
                ruptureDate = addDays(today, daysUntilRupture);
            }

            for (const lot of groupLots) {
                const product = products.find(p => p.id === lot.productId)!;
                let lotQtyInBaseUnit = 0;
                try {
                  lotQtyInBaseUnit = toBaseUnits(product, lot.quantity, baseProduct);
                } catch (err) {
                  projectedLots.push({ status: 'conversion_error', lot, productName: getProductFullName(product), lotQtyInBaseUnit: 0, dailyAvg, daysRemaining: 0, projectedLoss: 0, projectedLossCost: 0, baseUnit: baseProduct.unit, projectedConsumptionDate: null, projectedConsumptionStartDate: null, expiryDate: null });
                  continue;
                }

                if (!lot.expiryDate) {
                    let projConsumptionDate: Date | null = null;
                    if(dailyAvg > 0) {
                      const daysToConsumeLot = Math.ceil(lotQtyInBaseUnit / dailyAvg);
                      projConsumptionDate = addDays(currentStockDate, daysToConsumeLot - 1);
                    }
                    projectedLots.push({ status: 'no_expiry', lot, productName: getProductFullName(product), lotQtyInBaseUnit, dailyAvg, daysRemaining: Infinity, projectedLoss: 0, projectedLossCost: 0, baseUnit: baseProduct.unit, projectedConsumptionDate: projConsumptionDate, projectedConsumptionStartDate: currentStockDate, expiryDate: null });
                    if(projConsumptionDate) currentStockDate = addDays(projConsumptionDate, 1);
                    continue;
                }
                
                const expiryDate = parseISO(lot.expiryDate);
                const daysRemaining = differenceInDays(expiryDate, today);

                if (dailyAvg <= 0) {
                    projectedLots.push({ status: 'no_data', lot, productName: getProductFullName(product), lotQtyInBaseUnit, dailyAvg, daysRemaining, projectedLoss: 0, projectedLossCost: 0, baseUnit: baseProduct.unit, projectedConsumptionDate: null, projectedConsumptionStartDate: null, expiryDate });
                    continue;
                }

                const daysToConsumeLot = Math.ceil(lotQtyInBaseUnit / dailyAvg);
                const projectedConsumptionDate = addDays(currentStockDate, daysToConsumeLot - 1);
                
                let projectedLoss = 0;
                if(isAfter(projectedConsumptionDate, expiryDate)){
                    const daysOfLoss = differenceInDays(projectedConsumptionDate, expiryDate);
                    projectedLoss = daysOfLoss * dailyAvg;
                }
                projectedLoss = Math.min(lotQtyInBaseUnit, projectedLoss);
                
                const lastPrice = baseProduct.lastEffectivePrice?.pricePerUnit ?? 0;

                projectedLots.push({
                    lot, productName: getProductFullName(product), lotQtyInBaseUnit, dailyAvg, daysRemaining,
                    projectedLoss, projectedLossCost: projectedLoss * lastPrice, baseUnit: baseProduct.unit,
                    projectedConsumptionDate: projectedConsumptionDate,
                    projectedConsumptionStartDate: currentStockDate,
                    expiryDate: expiryDate,
                    status: projectedLoss > 0 ? 'at_risk' : 'ok'
                });
                currentStockDate = addDays(projectedConsumptionDate, 1);
            }

            let orderDate: Date | null = null;
            let orderStatus: GroupedProjectionResult['orderStatus'] = 'ok';
            
            const leadTime = kioskParams?.leadTime;
            if (ruptureDate && leadTime && leadTime > 0) {
                orderDate = addDays(ruptureDate, -leadTime);
                const daysToOrder = differenceInDays(orderDate, today);
                if (daysToOrder <= 7) orderStatus = 'urgent';
                else if (daysToOrder <= 15) orderStatus = 'soon';
            } else if (!leadTime || leadTime <= 0) {
                 orderStatus = 'sem_lead_time';
            }
            
            if (!isMatrixView) {
                if (ruptureDate) {
                    const daysToRupture = differenceInDays(ruptureDate, today);
                    if (daysToRupture <= 4) orderStatus = 'urgent';
                    else if (daysToRupture <= 9) orderStatus = 'soon';
                    else orderStatus = 'ok';
                } else {
                    orderStatus = dailyAvg > 0 ? 'urgent' : 'no_data';
                }
            }


            let suggestedOrderQty = null;
            if (baseProduct.consumptionMonths && baseProduct.consumptionMonths > 0) {
                const monthlyAvgForSuggestion = monthlyAverages.get(baseProductId) || 0;
                suggestedOrderQty = monthlyAvgForSuggestion * baseProduct.consumptionMonths;
            }
            
            if (projectedLots.length > 0) {
                allResults.push({ baseProductId, baseProductName: baseProduct.name, lots: projectedLots, ruptureDate, orderDate, orderStatus, suggestedOrderQty, monthlyAvg });
            }
        });

        return allResults;

    }, [loading, consumptionHistory, baseProducts, lots, products, getProductFullName, selectedBaseProductIds, productsById, toBaseUnits, simulationPercentage, selectedKioskId, kiosks]);
    
    const finalFilteredAndSortedResults = useMemo(() => {
        let results = [...projectionResults];
        
        if (searchTerm) {
            const lowerCaseSearch = searchTerm.toLowerCase();
            results = results.filter(group => {
                const baseProductMatch = group.baseProductName.toLowerCase().includes(lowerCaseSearch);
                if (baseProductMatch) return true;
    
                const lotMatch = group.lots.some(lotResult => 
                    lotResult.productName.toLowerCase().includes(lowerCaseSearch) || 
                    lotResult.lot.lotNumber.toLowerCase().includes(lowerCaseSearch)
                );
                return lotMatch;
            });
        }

        if (showOnlyAtRisk) {
            results = results.map(group => ({
                ...group,
                lots: group.lots.filter(r => r.status === 'at_risk')
            })).filter(group => group.lots.length > 0);
        }

        results.forEach(group => {
            group.lots.sort((a, b) => {
                const key = sortConfig.key;
                let valA = a[key as keyof ProjectionResult];
                let valB = b[key as keyof ProjectionResult];

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
        });

        return results;

    }, [projectionResults, showOnlyAtRisk, sortConfig, searchTerm]);

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
                {sortConfig.key === key && <ArrowUpDown className="h-3 w-3" />}
            </div>
        </TableHead>
    );

    const getExpiryColorClass = (days: number | null) => {
        if (days === null) return '';
        if (days < 0) return 'bg-red-500/20';
        if (days <= 7) return 'bg-red-500/20';
        if (days <= 30) return 'bg-yellow-500/20';
        return '';
    };
    
    const getOrderStatusBadge = (status: GroupedProjectionResult['orderStatus']) => {
        switch(status) {
            case 'ok': return <Badge variant="secondary" className="bg-green-600 text-white">OK</Badge>;
            case 'soon': return <Badge variant="destructive" className="bg-yellow-500 text-white">Pedir em breve</Badge>;
            case 'urgent': return <Badge variant="destructive">Urgente</Badge>;
            case 'sem_lead_time': return null;
            default: return <Badge variant="secondary">Sem Dados</Badge>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Projeção de Consumo</h1>
                    <p className="text-muted-foreground">
                        Simule quanto tempo seu estoque atual vai durar com base nas médias de consumo.
                    </p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Unidade de Análise</CardTitle>
                        <Warehouse className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                                {kiosks.map(k => (
                                    <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Filtrar Insumos</CardTitle>
                        <Warehouse className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full justify-between">
                                    {selectedBaseProductIds.length} selecionados
                                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-64">
                                <DropdownMenuLabel>Insumos Base</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <ScrollArea className="h-64">
                                    {baseProducts.sort((a,b) => a.name.localeCompare(b.name)).map(bp => (
                                        <DropdownMenuCheckboxItem
                                            key={bp.id}
                                            checked={selectedBaseProductIds.includes(bp.id)}
                                            onCheckedChange={(checked) => handleBaseProductSelection(bp.id, checked)}
                                            onSelect={e => e.preventDefault()}
                                        >
                                            {bp.name}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </ScrollArea>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Simular Consumo</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                value={simulationPercentage}
                                onChange={e => setSimulationPercentage(Number(e.target.value))}
                                className="w-20"
                            />
                            <span className="text-sm font-medium">%</span>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Alertas Ativos</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {projectionResults.filter(r => r.orderStatus === 'urgent').length}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {selectedKioskId && <RuptureAlerts results={projectionResults} kioskId={selectedKioskId} />}

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Search className="h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Pesquisar resultados..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-64"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowOnlyAtRisk(!showOnlyAtRisk)}
                                className={cn(showOnlyAtRisk && "bg-primary/10 border-primary text-primary")}
                            >
                                Somente em Risco
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="space-y-4">
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                        </div>
                    ) : finalFilteredAndSortedResults.length > 0 ? (
                        <div className="space-y-8">
                            {finalFilteredAndSortedResults.map(group => (
                                <div key={group.baseProductId} className="space-y-4">
                                    <div className="flex items-center justify-between border-b pb-2">
                                        <div className="flex items-center gap-3">
                                            <h3 className="text-lg font-bold">{group.baseProductName}</h3>
                                            {getOrderStatusBadge(group.orderStatus)}
                                        </div>
                                        <div className="flex items-center gap-4 text-sm">
                                            <div className="flex items-center gap-1">
                                                <span className="text-muted-foreground">Média mensal:</span>
                                                <span className="font-semibold">{group.monthlyAvg.toFixed(1)} {group.lots[0]?.baseUnit}</span>
                                            </div>
                                            {group.ruptureDate && (
                                                <div className="flex items-center gap-1">
                                                    <span className="text-muted-foreground">Ruptura:</span>
                                                    <span className="font-semibold text-destructive">{format(group.ruptureDate, 'dd/MM/yyyy')}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="rounded-md border">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Lote</TableHead>
                                                    <TableHead className="text-right">Qtd (Base)</TableHead>
                                                    <TableHead>Início Consumo</TableHead>
                                                    <TableHead>Fim Consumo</TableHead>
                                                    <TableHead>Vencimento</TableHead>
                                                    <TableHead className="text-right">Perda Estimada</TableHead>
                                                    <TableHead className="text-center">Status</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {group.lots.map(result => (
                                                    <TableRow key={result.lot.id}>
                                                        <TableCell className="font-medium">{result.lot.lotNumber}</TableCell>
                                                        <TableCell className="text-right">{result.lotQtyInBaseUnit.toFixed(1)} {result.baseUnit}</TableCell>
                                                        <TableCell>
                                                            {result.projectedConsumptionStartDate ? format(result.projectedConsumptionStartDate, 'dd/MM/yyyy') : '-'}
                                                        </TableCell>
                                                        <TableCell>
                                                            {result.projectedConsumptionDate ? format(result.projectedConsumptionDate, 'dd/MM/yyyy') : '-'}
                                                        </TableCell>
                                                        <TableCell className={cn("font-medium", getExpiryColorClass(result.daysRemaining))}>
                                                            {result.expiryDate ? (
                                                                <div className="flex flex-col">
                                                                    <span>{format(result.expiryDate, 'dd/MM/yyyy')}</span>
                                                                    <span className="text-[10px] text-muted-foreground">{result.daysRemaining} dias restantes</span>
                                                                </div>
                                                            ) : 'Indefinida'}
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-destructive">
                                                            {result.projectedLoss > 0 ? (
                                                                <div className="flex flex-col">
                                                                    <span>{result.projectedLoss.toFixed(1)} {result.baseUnit}</span>
                                                                    <span className="text-[10px] font-normal">{formatCurrency(result.projectedLossCost)}</span>
                                                                </div>
                                                            ) : '-'}
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            {getStatusBadge(result)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <Inbox className="h-12 w-12 mb-4 opacity-20" />
                            <p>Selecione um quiosque para visualizar as projeções.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
