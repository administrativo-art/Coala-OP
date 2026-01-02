

"use client";

import { useState, useMemo } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from './ui/skeleton';
import { DollarSign, Download, Package, Warehouse, Inbox, Scale } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { useProducts } from '@/hooks/use-products';
import { convertValue } from '@/lib/conversion';
import { FinancialPeriodAnalysisModal } from './financial-period-analysis-modal';
import { usePurchase } from '@/hooks/use-purchase';

const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
  ];

interface LotWithValue {
    lotNumber: string;
    productName: string;
    quantity: number;
    pricePerPackage: number;
    totalValue: number;
    baseProductId: string;
}

const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export function StockValuation() {
    const { kiosks, loading: kiosksLoading } = useKiosks();
    const { lots, loading: lotsLoading } = useExpiryProducts();
    const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
    const { products, getProductFullName, loading: productsLoading } = useProducts();
    const { priceHistory, loading: historyLoading } = usePurchase();
    
    const [selectedKioskId, setSelectedKioskId] = useState<string>('');
    const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

    const valuedLots = useMemo((): LotWithValue[] => {
        if (!selectedKioskId || lotsLoading || baseProductsLoading || productsLoading || historyLoading) return [];
        
        const productMap = new Map(products.map(p => [p.id, p]));
        const baseProductMap = new Map(baseProducts.map(bp => [bp.id, bp]));

        return lots
            .filter(lot => lot.kioskId === selectedKioskId && lot.quantity > 0)
            .map(lot => {
                const product = productMap.get(lot.productId);
                if (!product || !product.baseProductId) return null;

                const baseProduct = baseProductMap.get(product.baseProductId);
                if (!baseProduct) return null;
                
                const pricePerBaseUnit = baseProduct.lastEffectivePrice?.pricePerUnit ?? baseProduct.initialCostPerUnit ?? 0;
                if(pricePerBaseUnit === 0) return null;

                const packageSizeInBaseUnits = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                
                if(packageSizeInBaseUnits === 0) return null;

                const pricePerPackage = packageSizeInBaseUnits * pricePerBaseUnit;
                const totalValue = lot.quantity * pricePerPackage;
                
                if (totalValue <= 0) return null;

                return {
                    lotNumber: lot.lotNumber,
                    productName: getProductFullName(product),
                    quantity: lot.quantity,
                    pricePerPackage,
                    totalValue,
                    baseProductId: product.baseProductId,
                };
            })
            .filter((item): item is LotWithValue => item !== null)
            .sort((a, b) => a.productName.localeCompare(b.productName));

    }, [selectedKioskId, lots, lotsLoading, baseProducts, baseProductsLoading, products, productsLoading, getProductFullName, historyLoading]);
    
    const summaryByBaseProduct = useMemo(() => {
        const summary: { [key: string]: { name: string; quantity: number; value: number; unit: string; } } = {};
        
        valuedLots.forEach(lot => {
            const baseProduct = baseProducts.find(bp => bp.id === lot.baseProductId);
            if (!baseProduct) return;

            if (!summary[lot.baseProductId]) {
                summary[lot.baseProductId] = {
                    name: baseProduct.name,
                    quantity: 0,
                    value: 0,
                    unit: baseProduct.unit,
                };
            }
            summary[lot.baseProductId].quantity += lot.quantity;
            summary[lot.baseProductId].value += lot.totalValue;
        });

        return Object.values(summary).sort((a,b) => a.name.localeCompare(b.name));
    }, [valuedLots, baseProducts]);

    const totalStockValue = useMemo(() => {
        return valuedLots.reduce((acc, lot) => acc + lot.totalValue, 0);
    }, [valuedLots]);
    
    const totalSkuCount = useMemo(() => {
        return new Set(valuedLots.map(lot => lot.baseProductId)).size;
    }, [valuedLots]);
    
    const sortedKiosks = useMemo(() => {
        return [...kiosks].sort((a, b) => {
            if (a.id === 'matriz') return -1;
            if (b.id === 'matriz') return 1;
            return a.name.localeCompare(b.name);
        });
    }, [kiosks]);
    
    const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading || historyLoading;

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-10 w-full max-w-sm" />
                <div className="grid gap-4 md:grid-cols-2">
                    <Skeleton className="h-32" />
                    <Skeleton className="h-32" />
                </div>
                <Skeleton className="h-64" />
                <Skeleton className="h-64" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
                <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
                    <SelectTrigger className="w-full sm:w-[300px]">
                        <SelectValue placeholder="Selecione um quiosque para avaliar..." />
                    </SelectTrigger>
                    <SelectContent>
                        {sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                 <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsAnalysisModalOpen(true)}>
                        <Scale className="mr-2" />
                        Análise por período
                    </Button>
                </div>
            </div>

            {!selectedKioskId ? (
                 <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <p>Selecione um quiosque para começar.</p>
                </div>
            ) : valuedLots.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Inbox className="h-12 w-12 mx-auto mb-4" />
                    <p className="font-semibold">Nenhum lote valorizado encontrado.</p>
                    <p className="text-sm max-w-md mx-auto">Isso pode ocorrer se não houver lotes em estoque para este quiosque, ou se os preços dos insumos base correspondentes ainda não foram efetivados no módulo de compras.</p>
                </div>
            ) : (
                <>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Valor total do estoque</CardTitle>
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent><div className="text-2xl font-bold">{formatCurrency(totalStockValue)}</div></CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Insumos base em estoque</CardTitle>
                                <Package className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent><div className="text-2xl font-bold">{totalSkuCount}</div></CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Card>
                             <CardHeader>
                                <CardTitle>Composição do valor do estoque</CardTitle>
                                <CardDescription>Participação de cada insumo base no valor total.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <PieChart>
                                        <Pie data={summaryByBaseProduct} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                                            {summaryByBaseProduct.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader>
                                <CardTitle>Resumo por insumo base</CardTitle>
                                <CardDescription>Totalização por tipo de insumo.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-80">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Insumo</TableHead>
                                                <TableHead className="text-right">Quantidade (pct)</TableHead>
                                                <TableHead className="text-right">Valor total</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {summaryByBaseProduct.map(item => (
                                                <TableRow key={item.name}>
                                                    <TableCell className="font-medium">{item.name}</TableCell>
                                                    <TableCell className="text-right">{item.quantity.toLocaleString()} pct</TableCell>
                                                    <TableCell className="text-right font-semibold">{formatCurrency(item.value)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </div>

                     <Card>
                        <CardHeader>
                            <CardTitle>Detalhes por lote</CardTitle>
                            <CardDescription>Valor individual de cada lote em estoque.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-96">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Lote</TableHead>
                                            <TableHead>Insumo vinculado</TableHead>
                                            <TableHead className="text-right">Quantidade (pct)</TableHead>
                                            <TableHead className="text-right">R$/pct.</TableHead>
                                            <TableHead className="text-right">Valor do lote</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {valuedLots.map((item, index) => (
                                            <TableRow key={`${item.lotNumber}-${index}`}>
                                                <TableCell className="font-medium">{item.lotNumber}</TableCell>
                                                <TableCell>{item.productName}</TableCell>
                                                <TableCell className="text-right">{item.quantity}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(item.pricePerPackage)}</TableCell>
                                                <TableCell className="text-right font-semibold">{formatCurrency(item.totalValue)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </>
            )}

            <FinancialPeriodAnalysisModal 
                open={isAnalysisModalOpen}
                onOpenChange={setIsAnalysisModalOpen}
            />
        </div>
    );
}
