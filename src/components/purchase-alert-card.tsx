
"use client";

import { useMemo, useCallback, useState } from 'react';
import Link from 'next/link';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/use-validatedConsumption-data';
import { convertValue } from '@/lib/conversion';
import { format, addDays, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { ShoppingCart, AlertTriangle, CheckCircle, BellRing, Inbox, CalendarDays, Warehouse, TrendingUp } from 'lucide-react';
import { type LotEntry, type BaseProduct, type Product } from '@/types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from '@/lib/utils';


interface GroupedProjectionResult {
    baseProductId: string;
    baseProductName: string;
    baseProductUnit: string;
    currentStock: number;
    minimumStock: number;
    dailyAvg: number;
    daysOfCoverage: number;
    ruptureDate: Date | null;
    orderDate: Date | null;
    orderStatus: 'ok' | 'soon' | 'urgent' | 'no_data' | 'sem_lead_time';
}

export function PurchaseAlertCard() {
    const { kiosks, loading: kiosksLoading } = useKiosks();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { products, loading: productsLoading } = useProducts();
    const { reports: consumptionHistory, isLoading: consumptionLoading } = useValidatedConsumptionData();
    
    const [selectedKioskId, setSelectedKioskId] = useState('matriz');

    const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading || consumptionLoading;

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
        if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
            const secondaryUnitCategory = product.category === 'Unidade' ? 'Massa' : product.category === 'Embalagem' ? 'Unidade' : product.category;
            const perPackageInBase = convertValue(
                product.secondaryUnitValue,
                product.secondaryUnit,
                baseProduct.unit,
                secondaryUnitCategory
            );
            return packagesQty * perPackageInBase;
        }

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

        // MATRIZ LOGIC: Based on network consumption and lead time
        if (selectedKioskId === 'matriz') {
            const baseProductsWithLeadTime = baseProducts.filter(bp =>
                Object.values(bp.stockLevels || {}).some(sl => sl.leadTime && sl.leadTime > 0)
            );
            if (baseProductsWithLeadTime.length === 0) return [];

            const networkKioskIds = kiosks.filter(k => k.id !== 'matriz').map(k => k.id);
            const networkConsumptionReports = consumptionHistory.filter(r => networkKioskIds.includes(r.kioskId));
            
            const monthlyConsumptionByBaseId: Record<string, Record<string, number>> = {};
            networkConsumptionReports.forEach(report => {
                const key = `${report.year}-${String(report.month).padStart(2, '0')}`;
                report.results.forEach(res => {
                    if (res.baseProductId) {
                        if (!monthlyConsumptionByBaseId[res.baseProductId]) monthlyConsumptionByBaseId[res.baseProductId] = {};
                        monthlyConsumptionByBaseId[res.baseProductId][key] = (monthlyConsumptionByBaseId[res.baseProductId][key] || 0) + res.consumedQuantity;
                    }
                });
            });

            const dailyAverages = new Map<string, number>();
            Object.entries(monthlyConsumptionByBaseId).forEach(([baseId, monthlyData]) => {
                const months = Object.values(monthlyData);
                if (months.length > 0) {
                    const totalConsumption = months.reduce((sum, val) => sum + val, 0);
                    dailyAverages.set(baseId, (totalConsumption / months.length) / 30);
                }
            });

            const allResults: GroupedProjectionResult[] = [];

            baseProductsWithLeadTime.forEach(baseProduct => {
                const matrizStockLevels = baseProduct.stockLevels?.['matriz'];
                const leadTime = matrizStockLevels?.leadTime || 0;
                const dailyAvg = dailyAverages.get(baseProduct.id) ?? 0;
                
                const totalStockInBase = lots
                    .filter(lot => productsById.get(lot.productId)?.baseProductId === baseProduct.id && lot.kioskId === 'matriz')
                    .reduce((sum, lot) => {
                        const product = productsById.get(lot.productId)!;
                        return sum + toBaseUnits(product, lot.quantity, baseProduct);
                    }, 0);
                    
                const effectiveStock = Math.max(0, totalStockInBase - (matrizStockLevels?.safetyStock || 0));
                const daysOfCoverage = dailyAvg > 0 ? Math.floor(effectiveStock / dailyAvg) : Infinity;
                const ruptureDate = daysOfCoverage !== Infinity ? addDays(today, daysOfCoverage) : null;
                
                let orderDate: Date | null = null;
                let orderStatus: GroupedProjectionResult['orderStatus'] = 'no_data';
                
                if (leadTime > 0 && ruptureDate) {
                    orderDate = addDays(ruptureDate, -leadTime);
                    const daysToOrder = differenceInDays(orderDate, today);
                    if (daysToOrder <= 0) orderStatus = 'urgent';
                    else if (daysToOrder <= 7) orderStatus = 'soon';
                    else orderStatus = 'ok';
                } else if (!leadTime) {
                    orderStatus = 'sem_lead_time';
                }
                
                allResults.push({ 
                    baseProductId: baseProduct.id, 
                    baseProductName: baseProduct.name,
                    baseProductUnit: baseProduct.unit,
                    currentStock: totalStockInBase,
                    minimumStock: matrizStockLevels?.min || 0,
                    dailyAvg,
                    daysOfCoverage,
                    ruptureDate, 
                    orderDate, 
                    orderStatus 
                });
            });
            return allResults.sort((a,b) => (a.orderDate?.getTime() || Infinity) - (b.orderDate?.getTime() || Infinity));
        }

        // KIOSK LOGIC: Based on its own consumption and 15-day rupture window
        const monthlyConsumptionByBaseId: Record<string, Record<string, number>> = {};
        consumptionHistory.filter(r => r.kioskId === selectedKioskId).forEach(report => {
            const key = `${report.year}-${String(report.month).padStart(2, '0')}`;
            report.results.forEach(res => {
                if(res.baseProductId){
                    if (!monthlyConsumptionByBaseId[res.baseProductId]) monthlyConsumptionByBaseId[res.baseProductId] = {};
                    monthlyConsumptionByBaseId[res.baseProductId][key] = (monthlyConsumptionByBaseId[res.baseProductId][key] || 0) + res.consumedQuantity;
                }
            });
        });
        
        const dailyAverages = new Map<string, number>();
        Object.entries(monthlyConsumptionByBaseId).forEach(([baseId, monthlyData]) => {
            const months = Object.values(monthlyData);
            if (months.length > 0) {
                const totalConsumption = months.reduce((sum, val) => sum + val, 0);
                dailyAverages.set(baseId, (totalConsumption / months.length) / 30);
            }
        });

        return baseProducts.map(baseProduct => {
            const totalStockInBase = lots
                .filter(lot => productsById.get(lot.productId)?.baseProductId === baseProduct.id && lot.kioskId === selectedKioskId)
                .reduce((sum, lot) => {
                    const product = productsById.get(lot.productId)!;
                    return sum + toBaseUnits(product, lot.quantity, baseProduct);
                }, 0);
            
            const dailyAvg = dailyAverages.get(baseProduct.id) ?? 0;
            const daysOfCoverage = dailyAvg > 0 ? Math.floor(totalStockInBase / dailyAvg) : Infinity;
            const ruptureDate = daysOfCoverage !== Infinity ? addDays(today, daysOfCoverage) : null;
            
            let orderStatus: GroupedProjectionResult['orderStatus'] = 'no_data';
            if (ruptureDate) {
                 const daysToRupture = differenceInDays(ruptureDate, today);
                 if (daysToRupture <= 7) orderStatus = 'urgent';
                 else if (daysToRupture <= 15) orderStatus = 'soon';
                 else orderStatus = 'ok';
            }

            return {
                baseProductId: baseProduct.id,
                baseProductName: baseProduct.name,
                baseProductUnit: baseProduct.unit,
                currentStock: totalStockInBase,
                minimumStock: baseProduct.stockLevels?.[selectedKioskId]?.min || 0,
                dailyAvg,
                daysOfCoverage,
                ruptureDate,
                orderDate: null, // Not used for kiosks
                orderStatus
            };
        }).filter(p => p.orderStatus === 'urgent' || p.orderStatus === 'soon').sort((a,b) => (a.ruptureDate?.getTime() || Infinity) - (b.ruptureDate?.getTime() || Infinity));

    }, [loading, selectedKioskId, baseProducts, lots, productsById, toBaseUnits, consumptionHistory, kiosks]);

    const sortedKiosks = useMemo(() => {
        return [...kiosks].sort((a,b) => {
            if (a.id === 'matriz') return -1;
            if (b.id === 'matriz') return 1;
            return a.name.localeCompare(b.name);
        });
    }, [kiosks]);

    const getStatusBadge = (item: GroupedProjectionResult) => {
        switch (item.orderStatus) {
            case 'ok': return <Badge variant="secondary" className="bg-green-600 text-white">OK</Badge>;
            case 'soon': return <Badge className="bg-orange-500 text-white hover:bg-orange-600">Atenção</Badge>;
            case 'urgent': return <Badge variant="destructive">Urgente</Badge>;
            default: return null;
        }
    };
    
    const hasAlerts = projectionResults.filter(p => p.orderStatus === 'urgent' || p.orderStatus === 'soon').length > 0;
    const titleText = selectedKioskId === 'matriz' ? "Alerta de Compras (Matriz)" : `Alerta de Reposição (${kiosks.find(k => k.id === selectedKioskId)?.name})`;
    const linkTarget = selectedKioskId === 'matriz' ? '/dashboard/stock/analysis/projection' : '/dashboard/stock/analysis/restock';

    return (
        <Card className="hover:bg-muted/50 transition-colors h-full col-span-full">
            <CardHeader className="flex flex-row items-start justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <ShoppingCart className="h-4 w-4" /> {titleText}
                         {hasAlerts && (
                            <Badge variant="destructive" className="h-5">{projectionResults.filter(p => p.orderStatus === 'urgent' || p.orderStatus === 'soon').length}</Badge>
                         )}
                    </CardTitle>
                </div>
                 <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                        {sortedKiosks.map(kiosk => (
                             <SelectItem key={kiosk.id} value={kiosk.id}>{kiosk.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </CardHeader>
            <CardContent>
                <Link href={linkTarget}>
                {projectionResults.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-full py-4">
                        <CheckCircle className="h-8 w-8 text-green-500 mb-2"/>
                        <p className="font-semibold">Nenhum alerta de reposição</p>
                        <p className="text-xs">
                             {selectedKioskId === 'matriz' ? 'Nenhum item com Lead Time requer compra.' : 'O estoque desta unidade está OK.'}
                        </p>
                    </div>
                ) : (
                    <ScrollArea className="h-[150px]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Insumo</TableHead>
                                    <TableHead className="text-right">Estoque</TableHead>
                                    <TableHead className="text-right">Cobertura</TableHead>
                                    <TableHead className="text-center">{selectedKioskId === 'matriz' ? 'Data Pedido' : 'Data Ruptura'}</TableHead>
                                    <TableHead className="text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                             {projectionResults.map(item => (
                                <TableRow key={item.baseProductId}>
                                    <TableCell className="font-semibold truncate">{item.baseProductName}</TableCell>
                                    <TableCell className="text-right">
                                        {item.currentStock.toFixed(1)}
                                        <span className="text-muted-foreground">/{item.minimumStock} {item.baseProductUnit}</span>
                                    </TableCell>
                                    <TableCell className="text-right">{isFinite(item.daysOfCoverage) ? `${item.daysOfCoverage} dias` : 'N/A'}</TableCell>
                                    <TableCell className="text-center">
                                        {(selectedKioskId === 'matriz' ? item.orderDate : item.ruptureDate) 
                                            ? format((selectedKioskId === 'matriz' ? item.orderDate : item.ruptureDate)!, 'dd/MM/yy') 
                                            : 'N/A'
                                        }
                                    </TableCell>
                                    <TableCell className="text-right">{getStatusBadge(item)}</TableCell>
                                </TableRow>
                             ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                )}
                </Link>
            </CardContent>
        </Card>
    );
}

    