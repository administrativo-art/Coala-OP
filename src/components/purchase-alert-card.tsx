
"use client";

import { useMemo, useCallback, useState } from 'react';
import Link from 'next/link';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/use-validated-consumption-data';
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
    const { reports: consumptionHistory, isLoading: consumptionLoading, baseProducts: validatedBaseProducts } = useValidatedConsumptionData();
    
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

        const getDailyAverage = (baseProductId: string, forKioskId: string) => {
            const relevantReports = forKioskId === 'matriz'
                ? consumptionHistory.filter(r => r.kioskId !== 'matriz')
                : consumptionHistory.filter(r => r.kioskId === forKioskId);

            const monthlyConsumption: Record<string, number> = {};
            relevantReports.forEach(report => {
                const key = `${report.year}-${String(report.month).padStart(2, '0')}`;
                const totalForMonth = report.results
                    .filter(res => res.baseProductId === baseProductId)
                    .reduce((sum, res) => sum + res.consumedQuantity, 0);

                if (totalForMonth > 0) {
                    monthlyConsumption[key] = (monthlyConsumption[key] || 0) + totalForMonth;
                }
            });

            const months = Object.values(monthlyConsumption);
            if (months.length === 0) return 0;

            const totalConsumption = months.reduce((sum, val) => sum + val, 0);
            return (totalConsumption / months.length) / 30;
        };

        return validatedBaseProducts.map(baseProduct => {
            const dailyAvg = getDailyAverage(baseProduct.id, selectedKioskId);
            
            const totalStockInBase = lots
                .filter(lot => productsById.get(lot.productId)?.baseProductId === baseProduct.id && lot.kioskId === selectedKioskId)
                .reduce((sum, lot) => {
                    const product = productsById.get(lot.productId)!;
                    return sum + toBaseUnits(product, lot.quantity, baseProduct);
                }, 0);
            
            const kioskParams = baseProduct.stockLevels?.[selectedKioskId];
            const minimumStock = kioskParams?.min || 0;
            const safetyStock = kioskParams?.safetyStock || 0;

            const effectiveStock = Math.max(0, totalStockInBase - safetyStock);
            const daysOfCoverage = dailyAvg > 0 ? Math.floor(effectiveStock / dailyAvg) : Infinity;
            
            let orderStatus: GroupedProjectionResult['orderStatus'] = 'ok';
            let orderDate: Date | null = null;
            const ruptureDate = daysOfCoverage !== Infinity ? addDays(today, daysOfCoverage) : null;
            
            if (selectedKioskId === 'matriz') {
                const leadTime = kioskParams?.leadTime;
                if (leadTime && leadTime > 0) {
                    if (ruptureDate) {
                        orderDate = addDays(ruptureDate, -leadTime);
                        const daysToOrder = differenceInDays(orderDate, today);
                        if (daysToOrder <= 7) orderStatus = 'urgent';
                        else if (daysToOrder <= 15) orderStatus = 'soon';
                    }
                } else {
                    orderStatus = 'sem_lead_time';
                }
            } else { // Kiosk Logic
                 if (ruptureDate) {
                    const daysToRupture = differenceInDays(ruptureDate, today);
                    if (daysToRupture <= 4) orderStatus = 'urgent';
                    else if (daysToRupture <= 9) orderStatus = 'soon';
                } else if (dailyAvg > 0) {
                    orderStatus = 'urgent';
                }
            }

            return {
                baseProductId: baseProduct.id,
                baseProductName: baseProduct.name,
                baseProductUnit: baseProduct.unit,
                currentStock: totalStockInBase,
                minimumStock: minimumStock,
                dailyAvg,
                daysOfCoverage,
                ruptureDate,
                orderDate,
                orderStatus
            };
        }).filter(p => {
            if (selectedKioskId === 'matriz') {
                 const leadTime = baseProducts.find(bp => bp.id === p.baseProductId)?.stockLevels?.['matriz']?.leadTime || 0;
                 return leadTime > 0 && (p.orderStatus === 'urgent' || p.orderStatus === 'soon');
            }
            return p.orderStatus === 'urgent' || p.orderStatus === 'soon';
        })
          .sort((a, b) => (a.orderDate?.getTime() || a.ruptureDate?.getTime() || Infinity) - (b.orderDate?.getTime() || b.ruptureDate?.getTime() || Infinity));

    }, [loading, selectedKioskId, validatedBaseProducts, baseProducts, lots, productsById, toBaseUnits, consumptionHistory]);


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
    
    const hasAlerts = projectionResults.length > 0;
    const titleText = selectedKioskId === 'matriz' ? "Alerta de Compras (Matriz)" : `Alerta de Reposição (${kiosks.find(k => k.id === selectedKioskId)?.name})`;
    const linkTarget = selectedKioskId === 'matriz' ? '/dashboard/stock/purchasing' : '/dashboard/stock/analysis/restock';

    return (
        <Card className="hover:bg-muted/50 transition-colors h-full col-span-full">
            <CardHeader className="flex flex-row items-start justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <ShoppingCart className="h-4 w-4" /> {titleText}
                         {hasAlerts && (
                            <Badge variant="destructive" className="h-5">{projectionResults.length}</Badge>
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
                {!hasAlerts ? (
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
                                    <TableHead className="text-right">Estoque / Mínimo</TableHead>
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
