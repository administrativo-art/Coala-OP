
"use client";

import { useMemo, useState, useCallback } from 'react';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useValidatedConsumptionData } from '@/hooks/use-validated-consumption-data';
import { useKiosks } from '@/hooks/use-kiosks';
import { usePurchase } from '@/hooks/use-purchase';
import { convertValue, units, type UnitCategory } from '@/lib/conversion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ShoppingCart, Inbox, Loader2, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import { Skeleton } from './ui/skeleton';
import { format } from 'date-fns';
import Papa from 'papaparse';

interface Suggestion {
    baseProductId: string;
    baseProductName: string;
    baseProductUnit: string;
    matrizStock: number;
    networkDailyAvg: number;
    coverageDays: number;
    leadTime: number;
    status: 'ok' | 'urgent' | 'attention' | 'no_lead_time';
    suggestedQty: number;
}

export function PurchaseSuggestionList() {
    const { baseProducts, loading: loadingBase } = useBaseProducts();
    const { products, loading: loadingProducts } = useProducts();
    const { lots, loading: loadingLots } = useExpiryProducts();
    const { reports, isLoading: loadingConsumption } = useValidatedConsumptionData();
    const { kiosks, loading: loadingKiosks } = useKiosks();
    const { addSession, loading: loadingPurchase } = usePurchase();
    const { toast } = useToast();
    const router = useRouter();

    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
    
    const loading = loadingBase || loadingProducts || loadingLots || loadingConsumption || loadingKiosks;

    const suggestions: Suggestion[] = useMemo(() => {
        if (loading) return [];

        const productMap = new Map(products.filter(p => !p.isArchived).map(p => [p.id, p]));
        const matrizLots = lots.filter(lot => lot.kioskId === 'matriz');
        const networkReports = reports.filter(r => r.kioskId !== 'matriz');
        
        return baseProducts.map(bp => {
            // Calculate Matriz Stock
            const matrizStock = matrizLots
                .filter(l => productMap.get(l.productId)?.baseProductId === bp.id)
                .reduce((sum, lot) => {
                    const product = productMap.get(lot.productId);
                    if (!product) return sum;
                    try {
                        if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                            let secondaryUnitCategory: UnitCategory | undefined;
                            for (const category in units) {
                                if (Object.keys(units[category as UnitCategory]).includes(product.secondaryUnit)) {
                                    secondaryUnitCategory = category as UnitCategory;
                                    break;
                                }
                            }
                            if (!secondaryUnitCategory) return sum;
                            
                            const valueInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, bp.unit, secondaryUnitCategory);
                            return sum + (lot.quantity * valueInBase);
                        }
            
                        const valueInBase = convertValue(product.packageSize, product.unit, bp.unit, product.category);
                        return sum + (lot.quantity * valueInBase);
                    } catch {
                        return sum;
                    }
                }, 0);

            // Calculate Network Daily Avg
            const monthlyConsumption: Record<string, number> = {};
            networkReports.forEach(report => {
                const key = `${report.year}-${report.month}`;
                const totalForMonth = report.results
                    .filter(res => res.baseProductId === bp.id)
                    .reduce((sum, res) => sum + res.consumedQuantity, 0);
                if (totalForMonth > 0) {
                    monthlyConsumption[key] = (monthlyConsumption[key] || 0) + totalForMonth;
                }
            });

            const months = Object.values(monthlyConsumption);
            const monthlyAvg = months.length > 0 ? months.reduce((sum, val) => sum + val, 0) / months.length : 0;
            const networkDailyAvg = monthlyAvg / 30;

            const coverageDays = networkDailyAvg > 0 ? matrizStock / networkDailyAvg : Infinity;
            
            const leadTime = bp.stockLevels?.['matriz']?.leadTime || 0;

            let status: Suggestion['status'] = 'ok';
            if (leadTime === 0) {
                status = 'no_lead_time';
            } else if (coverageDays <= leadTime) {
                status = 'urgent';
            } else if (coverageDays <= leadTime * 1.5) { // 50% buffer
                status = 'attention';
            }
            
            const suggestedQty = monthlyAvg * (bp.consumptionMonths || 1);

            return {
                baseProductId: bp.id,
                baseProductName: bp.name,
                baseProductUnit: bp.unit,
                matrizStock,
                networkDailyAvg,
                coverageDays,
                leadTime,
                status,
                suggestedQty,
            };
        }).sort((a,b) => {
            const statusOrder = { 'urgent': 1, 'attention': 2, 'no_lead_time': 3, 'ok': 4 };
            if (statusOrder[a.status] !== statusOrder[b.status]) {
                return statusOrder[a.status] - statusOrder[b.status];
            }
            return a.baseProductName.localeCompare(b.baseProductName);
        });

    }, [loading, baseProducts, products, lots, reports]);

    const handleSelectProduct = (productId: string) => {
        setSelectedProducts(prev => {
            const newSet = new Set(prev);
            if (newSet.has(productId)) {
                newSet.delete(productId);
            } else {
                newSet.add(productId);
            }
            return newSet;
        });
    };
    
    const handleCreatePurchaseSession = async () => {
        if (selectedProducts.size === 0) return;
        const description = `Cotação sugerida pelo assistente - ${format(new Date(), 'dd/MM/yyyy')}`;
        await addSession({ description, baseProductIds: Array.from(selectedProducts), type: 'automatic' });
        toast({
            title: "Sessão de cotação criada!",
            description: "Você será redirecionado para a tela de compras.",
        });
        router.push('/dashboard/stock/purchasing');
    };

    const handleExport = () => {
        if (suggestions.length === 0) {
            toast({
                title: "Nada para exportar",
                description: "A lista de sugestões está vazia.",
            });
            return;
        }

        const dataForCsv = suggestions.map(s => ({
            'Produto Base': s.baseProductName,
            'Estoque Matriz': `${s.matrizStock.toFixed(1)} ${s.baseProductUnit}`,
            'Consumo/dia (Rede)': `${s.networkDailyAvg.toFixed(2)} ${s.baseProductUnit}`,
            'Cobertura': isFinite(s.coverageDays) ? `${s.coverageDays.toFixed(0)} dias` : '∞',
            'Lead Time': s.leadTime > 0 ? `${s.leadTime} dias` : '-',
            'Status': s.status === 'urgent' ? 'Urgente' : s.status === 'attention' ? 'Atenção' : s.status === 'ok' ? 'OK' : 'Sem Lead Time',
            'Sugestão de Compra': `${s.suggestedQty.toFixed(1)} ${s.baseProductUnit}`,
        }));

        const csv = Papa.unparse(dataForCsv);
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const filename = `sugestoes_compra_${format(new Date(), 'yyyy-MM-dd')}.csv`;
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Sugestões de Compra</CardTitle>
                <CardDescription>
                    Lista de insumos com recomendação de compra para o estoque da Matriz.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {suggestions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Inbox className="h-12 w-12 mb-4" />
                        <p>Nenhuma sugestão de compra no momento.</p>
                    </div>
                ) : (
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10"><Checkbox onCheckedChange={(checked) => setSelectedProducts(checked ? new Set(suggestions.map(s => s.baseProductId)) : new Set())} /></TableHead>
                                    <TableHead>Produto Base</TableHead>
                                    <TableHead className="text-right">Estoque Matriz</TableHead>
                                    <TableHead className="text-right">Consumo/dia (Rede)</TableHead>
                                    <TableHead className="text-right">Cobertura</TableHead>
                                    <TableHead className="text-right">Lead Time</TableHead>
                                    <TableHead className="text-center">Status</TableHead>
                                    <TableHead className="text-right">Sugestão (30d)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {suggestions.map(s => (
                                    <TableRow key={s.baseProductId} className={s.status === 'urgent' ? 'bg-destructive/10' : s.status === 'attention' ? 'bg-amber-500/10' : ''}>
                                        <TableCell><Checkbox checked={selectedProducts.has(s.baseProductId)} onCheckedChange={() => handleSelectProduct(s.baseProductId)} /></TableCell>
                                        <TableCell className="font-medium">{s.baseProductName}</TableCell>
                                        <TableCell className="text-right">{s.matrizStock.toFixed(1)} {s.baseProductUnit}</TableCell>
                                        <TableCell className="text-right">{s.networkDailyAvg.toFixed(2)} {s.baseProductUnit}</TableCell>
                                        <TableCell className="text-right">{isFinite(s.coverageDays) ? `${s.coverageDays.toFixed(0)} dias` : '∞'}</TableCell>
                                        <TableCell className="text-right">{s.leadTime > 0 ? `${s.leadTime} dias` : '-'}</TableCell>
                                        <TableCell className="text-center">
                                            {s.status === 'urgent' && <Badge variant="destructive">Urgente</Badge>}
                                            {s.status === 'attention' && <Badge className="bg-amber-500 text-white">Atenção</Badge>}
                                            {s.status === 'ok' && <Badge variant="secondary">OK</Badge>}
                                            {s.status === 'no_lead_time' && <Badge variant="outline">Sem Lead Time</Badge>}
                                        </TableCell>
                                        <TableCell className="text-right font-bold">{s.suggestedQty.toFixed(1)} {s.baseProductUnit}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
            <CardFooter className="justify-between border-t pt-4">
                 <Button onClick={handleExport} variant="outline" disabled={suggestions.length === 0}>
                    <Download className="mr-2 h-4 w-4"/>
                    Exportar Lista
                </Button>
                <Button onClick={handleCreatePurchaseSession} disabled={selectedProducts.size === 0 || loadingPurchase}>
                    {loadingPurchase ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <ShoppingCart className="mr-2 h-4 w-4"/>}
                    Criar Cotação com Itens ({selectedProducts.size})
                </Button>
            </CardFooter>
        </Card>
    );
}
