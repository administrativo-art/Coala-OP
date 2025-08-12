
"use client";

import { useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { convertValue } from '@/lib/conversion';
import { format, addDays, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { ShoppingCart, AlertTriangle, CheckCircle, BellRing, Inbox, CalendarDays } from 'lucide-react';
import { type LotEntry, type BaseProduct, type Product } from '@/types';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';


interface GroupedProjectionResult {
    baseProductId: string;
    baseProductName: string;
    baseProductUnit: string;
    currentStock: number;
    dailyAvg: number;
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

        const matrizReports = consumptionHistory.filter(r => r.kioskId === 'matriz');
        const monthlyConsumptionByBaseId: Record<string, Record<string, number>> = {};
        matrizReports.forEach(report => {
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
                    const daysToOrder = differenceInDays(orderDate, new Date());
                    if (daysToOrder <= 0) orderStatus = 'urgent';
                    else if (daysToOrder <= 7) orderStatus = 'soon';
                    else orderStatus = 'ok';
                }
            } else {
                orderStatus = 'sem_lead_time';
            }
            
            allResults.push({ 
                baseProductId: baseProduct.id, 
                baseProductName: baseProduct.name,
                baseProductUnit: baseProduct.unit,
                currentStock: totalStockInBase,
                dailyAvg,
                ruptureDate, 
                orderDate, 
                orderStatus 
            });
        });

        return allResults.sort((a,b) => (a.orderDate?.getTime() || Infinity) - (b.orderDate?.getTime() || Infinity));

    }, [loading, baseProducts, lots, productsById, toBaseUnits, consumptionHistory]);

    if (loading) {
        return <Skeleton className="h-[250px] col-span-full" />
    }

    const getStatusBadge = (item: GroupedProjectionResult) => {
        if (!item.orderDate) return null;
    
        const daysToOrder = differenceInDays(item.orderDate, new Date());
    
        if (daysToOrder <= 0) {
            return <Badge variant="destructive">Pedir agora</Badge>;
        }
        if (daysToOrder <= 7) {
            return <Badge className="bg-orange-500 text-white hover:bg-orange-600">Pedir em breve</Badge>;
        }
        return <Badge variant="secondary" className="bg-green-600 text-white">OK</Badge>;
    };

    return (
        <Link href="/dashboard/stock/analysis/projection" className="col-span-full">
            <Card className="hover:bg-muted/50 transition-colors h-full">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <ShoppingCart className="h-4 w-4" /> Alerta de Compras (Matriz)
                         {projectionResults.filter(p => p.orderStatus === 'urgent' || p.orderStatus === 'soon').length > 0 && (
                            <Badge variant="destructive" className="h-5">{projectionResults.filter(p => p.orderStatus === 'urgent' || p.orderStatus === 'soon').length}</Badge>
                         )}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {projectionResults.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-full py-4">
                            <CheckCircle className="h-8 w-8 text-green-500 mb-2"/>
                            <p className="font-semibold">Nenhum item com Lead Time</p>
                            <p className="text-xs">Configure o lead time para os produtos base para ver os alertas de compra.</p>
                        </div>
                    ) : (
                        <ScrollArea className="h-[150px]">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Insumo</TableHead>
                                        <TableHead className="text-right">Estoque Atual</TableHead>
                                        <TableHead className="text-right">Consumo/dia</TableHead>
                                        <TableHead className="text-center">Data Pedido</TableHead>
                                        <TableHead className="text-center">Data Ruptura</TableHead>
                                        <TableHead className="text-right">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                 {projectionResults.map(item => (
                                    <TableRow key={item.baseProductId}>
                                        <TableCell className="font-semibold truncate">{item.baseProductName}</TableCell>
                                        <TableCell className="text-right">{item.currentStock.toFixed(1)} {item.baseProductUnit}</TableCell>
                                        <TableCell className="text-right">{item.dailyAvg.toFixed(1)} {item.baseProductUnit}</TableCell>
                                        <TableCell className="text-center">{item.orderDate ? format(item.orderDate, 'dd/MM') : 'N/A'}</TableCell>
                                        <TableCell className="text-center">{item.ruptureDate ? format(item.ruptureDate, 'dd/MM') : 'N/A'}</TableCell>
                                        <TableCell className="text-right">{getStatusBadge(item)}</TableCell>
                                    </TableRow>
                                 ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    )}
                </CardContent>
            </Card>
        </Link>
    );
}
