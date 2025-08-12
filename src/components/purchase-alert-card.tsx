
"use client";

import { useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/use-validatedConsumptionData';
import { convertValue } from '@/lib/conversion';
import { format, addDays, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { ShoppingCart, AlertTriangle, CheckCircle, BellRing, Inbox } from 'lucide-react';
import { type LotEntry, type BaseProduct, type Product } from '@/types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from './ui/scroll-area';

interface GroupedProjectionResult {
    baseProductId: string;
    baseProductName: string;
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
        if (loading) return [];

        const baseProductsWithLeadTime = baseProducts.filter(bp =>
            Object.values(bp.stockLevels || {}).some(sl => sl.leadTime && sl.leadTime > 0)
        );

        if (baseProductsWithLeadTime.length === 0) return [];

        const monthlyConsumptionByBaseId: Record<string, Record<string, number>> = {};
        consumptionHistory.forEach(report => {
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
        const today = new Date();

        baseProductsWithLeadTime.forEach(baseProduct => {
            const kioskParams = Object.values(baseProduct.stockLevels || {});
            const totalSafetyStock = kioskParams.reduce((sum, level) => sum + (level.safetyStock || 0), 0);
            const leadTime = Math.max(...kioskParams.map(sl => sl.leadTime || 0));
            const dailyAvg = dailyAverages.get(baseProduct.id) ?? 0;
            
            const totalStockInBase = lots
                .filter(lot => productsById.get(lot.productId)?.baseProductId === baseProduct.id)
                .reduce((sum, lot) => {
                    const product = productsById.get(lot.productId)!;
                    return sum + toBaseUnits(product, lot.quantity, baseProduct);
                }, 0);
                
            const effectiveStock = Math.max(0, totalStockInBase - totalSafetyStock);

            let ruptureDate: Date | null = null;
            if (dailyAvg > 0 && effectiveStock > 0) {
                const daysUntilRupture = Math.floor(effectiveStock / dailyAvg);
                ruptureDate = addDays(today, daysUntilRupture);
            }
            
            let orderDate: Date | null = null;
            let orderStatus: GroupedProjectionResult['orderStatus'] = 'no_data';
            
            if (leadTime > 0) {
                if(ruptureDate) {
                    orderDate = addDays(ruptureDate, -leadTime);
                    const daysToOrder = differenceInDays(orderDate, today);
                    if (daysToOrder <= 0) orderStatus = 'urgent';
                    else if (daysToOrder <= 7) orderStatus = 'soon';
                    else orderStatus = 'ok';
                }
            } else {
                orderStatus = 'sem_lead_time';
            }
            
            if (orderStatus === 'urgent' || orderStatus === 'soon') {
                allResults.push({ baseProductId: baseProduct.id, baseProductName: baseProduct.name, ruptureDate, orderDate, orderStatus });
            }
        });

        return allResults.sort((a,b) => (a.orderDate?.getTime() || 0) - (b.orderDate?.getTime() || 0));

    }, [loading, baseProducts, lots, productsById, toBaseUnits, consumptionHistory]);

    if (loading) {
        return <Skeleton className="h-32" />
    }

    const urgentItems = projectionResults.filter(p => p.orderStatus === 'urgent');
    const soonItems = projectionResults.filter(p => p.orderStatus === 'soon');
    const alertCount = urgentItems.length + soonItems.length;
    
    return (
        <Link href="/dashboard/stock/analysis/projection" className="col-span-1 lg:col-span-2">
            <Card className="hover:bg-muted/50 transition-colors h-full">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm font-medium">
                        <ShoppingCart className="h-4 w-4" /> Alerta de Compras
                         {alertCount > 0 && (
                            <Badge variant="destructive" className="h-5">{alertCount}</Badge>
                         )}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {alertCount === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-full py-4">
                            <CheckCircle className="h-8 w-8 text-green-500 mb-2"/>
                            <p className="font-semibold">Estoque em dia!</p>
                            <p className="text-xs">Nenhum item com necessidade de compra imediata.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                             {urgentItems.length > 0 && urgentItems.map(item => (
                                <div key={item.baseProductId} className="flex items-center justify-between text-sm p-2 rounded-md bg-destructive/10">
                                    <span className="font-semibold text-destructive">{item.baseProductName}</span>
                                    <div className="flex items-center gap-1 text-destructive">
                                        <BellRing className="h-3 w-3"/>
                                        <span>Pedir agora</span>
                                    </div>
                                </div>
                             ))}
                             {soonItems.length > 0 && soonItems.map(item => (
                                <div key={item.baseProductId} className="flex items-center justify-between text-sm p-2 rounded-md bg-orange-500/10">
                                    <span className="font-semibold text-orange-600">{item.baseProductName}</span>
                                    <div className="flex items-center gap-1 text-orange-600">
                                        <BellRing className="h-3 w-3"/>
                                        <span>Pedir até {item.orderDate ? format(item.orderDate, 'dd/MM') : ''}</span>
                                    </div>
                                </div>
                             ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </Link>
    );
}

