
"use client";

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useValidatedConsumptionData } from '@/hooks/useValidatedConsumptionData';
import { convertValue } from '@/lib/conversion';
import { format, parseISO, addDays, isAfter, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from './ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Package, Inbox, ListFilter, HelpCircle, ArrowUpDown, TrendingUp, Download, LineChart, ShoppingCart, CalendarDays, BellRing, ListTodo, Check } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Button } from '@/components/ui/button';
import { ScrollArea } from './ui/scroll-area';
import { type LotEntry, type BaseProduct, type Product, type Task } from '@/types';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { QuickProjectionModal } from './quick-projection-modal';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
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

function RuptureAlerts({ results, kioskId }: { results: GroupedProjectionResult[], kioskId: string }) {
    const { legacyTasks } = useAllTasks();

    const alerts = useMemo(() => {
        return results
            .filter(r => r.orderStatus === 'urgent' || r.orderStatus === 'soon')
            .sort((a, b) => {
                const dateA = a.orderDate || a.ruptureDate;
                const dateB = b.orderDate || b.ruptureDate;
                if (!dateA) return 1;
                if (!dateB) return -1;
                return dateA.getTime() - b.getTime();
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
    const [quickProjectionProduct, setQuickProjectionProduct] = useState<BaseProduct | null>(null);
    const router = useRouter();


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
        const adjustmentFactor = 1 + (simulationPercentage / 100);
        const kioskStockLevels = (bp: BaseProduct) => bp.stockLevels?.[selectedKioskId];

        const consumptionData = (kioskId: string) => {
            if (kioskId === 'matriz') {
                const networkKioskIds = kiosks.filter(k => k.id !== 'matriz').map(k => k.id);
                return consumptionHistory.filter(r => networkKioskIds.includes(r.kioskId));
            }
            return consumptionHistory.filter(r => r.kioskId === kioskId);
        }

        const relevantReports = consumptionData(selectedKioskId);

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
            if (months.length > 0) {
                const totalConsumption = months.reduce((sum, val) => sum + val, 0);
                const avg = totalConsumption / months.length;
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
    
     const handleExportPdf = () => {
        const doc = new jsPDF();
        const kioskName = kiosks.find(k => k.id === 'matriz')?.name || 'Matriz';

        doc.setFontSize(18);
        doc.text(`Projeção de Consumo - ${kioskName}`, 14, 22);
        
        let yPos = 30;

        finalFilteredAndSortedResults.forEach(group => {
            if (yPos > 250) {
                doc.addPage();
                yPos = 20;
            }
            doc.setFontSize(14);
            doc.text(group.baseProductName, 14, yPos);
            yPos += 5;

            const tableData = group.lots.map(result => [
                result.productName,
                result.lot.lotNumber,
                result.projectedConsumptionDate ? format(result.projectedConsumptionDate, 'dd/MM/yy') : 'N/A',
                result.expiryDate ? format(result.expiryDate, 'dd/MM/yy') : 'N/A',
                result.projectedLoss > 0 ? `${result.projectedLoss.toFixed(2)} ${result.baseUnit}` : '-',
                result.status
            ]);
            
            autoTable(doc, {
                startY: yPos,
                head: [['Insumo', 'Lote', 'Consumo até', 'Vencimento', 'Perda', 'Status']],
                body: tableData,
                theme: 'striped',
                headStyles: { fillColor: '#273344' }
            });
            yPos = (doc as any).lastAutoTable.finalY + 10;
        });

        doc.save(`projecao_consumo_${kioskName.replace(/\s/g, '_')}.pdf`);
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
        <Card>
            <CardHeader>
                <CardTitle>Projeção de Consumo vs. Vencimento</CardTitle>
                <CardDescription>
                   Selecione um quiosque para verificar se os lotes em estoque serão consumidos antes de vencerem.
                </CardDescription>
                <div className="pt-2 flex flex-wrap items-center gap-2">
                     <Select value={selectedKioskId} onValueChange={setSelectedKioskId}>
                        <SelectTrigger className="w-full sm:w-[250px]">
                           <SelectValue placeholder="Selecione um quiosque..."/>
                        </SelectTrigger>
                        <SelectContent>
                            {kiosks.map(k => (
                               <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                            ))}
                        </SelectContent>
                     </Select>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full sm:w-auto">
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
                             <DropdownMenuItem onSelect={handleExportPdf} disabled={finalFilteredAndSortedResults.length === 0}>
                                <Download className="mr-2 h-4 w-4" />
                                Exportar PDF
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
                    <div className="relative w-full sm:w-auto">
                        <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="number"
                            placeholder="Simular consumo (+/- %)"
                            className="w-full sm:w-[200px] pl-10"
                            value={simulationPercentage || ''}
                            onChange={(e) => setSimulationPercentage(Number(e.target.value))}
                        />
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {selectedKioskId && <RuptureAlerts results={projectionResults} kioskId={selectedKioskId} />}
                {loading ? (
                    <Skeleton className="h-64 w-full" />
                ) : finalFilteredAndSortedResults.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Inbox className="mx-auto h-12 w-12" />
                        <p className="mt-4 font-semibold">
                            {selectedKioskId ? "Nenhum lote encontrado para este quiosque e filtros." : "Selecione um quiosque para começar."}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {finalFilteredAndSortedResults.map(group => {
                            const baseProduct = baseProducts.find(bp => bp.id === group.baseProductId);
                            return (
                                <div key={group.baseProductId} className="rounded-md border">
                                    <div className="p-4 bg-muted/50 rounded-t-md space-y-2">
                                        <div className="flex justify-between items-center">
                                          <div className="flex items-center gap-2">
                                              <h3 className="text-lg font-semibold">{group.baseProductName}</h3>
                                              {baseProduct && Object.values(baseProduct.stockLevels).some(sl => sl.leadTime && sl.leadTime > 0) && (
                                                  <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-500 hover:text-blue-600" onClick={() => setQuickProjectionProduct(baseProduct)}>
                                                      <LineChart className="h-5 w-5" />
                                                  </Button>
                                              )}
                                          </div>
                                            <div className="flex items-center gap-2">
                                              {group.orderDate && (
                                                  <TooltipProvider>
                                                      <Tooltip>
                                                          <TooltipTrigger asChild>
                                                              <div>
                                                                  <Badge className="cursor-help"><BellRing className="mr-2 h-4 w-4" />Pedido até: {format(group.orderDate, 'dd/MM/yyyy')}</Badge>
                                                              </div>
                                                          </TooltipTrigger>
                                                          <TooltipContent>
                                                              <p>Data limite para pedir reposição e evitar ruptura, com base no lead time.</p>
                                                          </TooltipContent>
                                                      </Tooltip>
                                                  </TooltipProvider>
                                              )}
                                              {getOrderStatusBadge(group.orderStatus)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    {renderSortableHeader('Insumo', 'productName')}
                                                    <TableHead>Lote</TableHead>
                                                    <TableHead className="text-center">Qtd. (Base)</TableHead>
                                                    <TableHead className="text-center">Média/mês</TableHead>
                                                    <TableHead className="text-center">Taxa/dia</TableHead>
                                                    {renderSortableHeader('Período de Consumo', 'projectedConsumptionDate')}
                                                    {renderSortableHeader('Vencimento', 'expiryDate')}
                                                    <TableHead className="text-center">Perda Estimada</TableHead>
                                                    <TableHead className="text-center">Situação</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {group.lots.map(result => (
                                                    <TableRow key={result.lot.id}>
                                                        <TableCell className="font-medium">{result.productName}</TableCell>
                                                        <TableCell>{result.lot.lotNumber}</TableCell>
                                                        <TableCell className="text-center">{result.lotQtyInBaseUnit.toLocaleString(undefined, {maximumFractionDigits:1})} {result.baseUnit}</TableCell>
                                                        <TableCell className="text-center font-semibold">{group.monthlyAvg.toLocaleString(undefined, {maximumFractionDigits:1})} {result.baseUnit}</TableCell>
                                                        <TableCell className="text-center">{result.dailyAvg.toLocaleString(undefined, {maximumFractionDigits:1})} {result.baseUnit}</TableCell>
                                                        <TableCell className="text-center">
                                                            {result.projectedConsumptionStartDate && result.projectedConsumptionDate ? (
                                                                `${format(result.projectedConsumptionStartDate, 'dd/MM/yy')} → ${format(result.projectedConsumptionDate, 'dd/MM/yy')}`
                                                            ) : 'N/A'}
                                                        </TableCell>
                                                        <TableCell className={cn("text-center font-semibold rounded-md", getExpiryColorClass(result.daysRemaining))}>
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
                                                                                {result.projectedLossCost > 0 && `${result.projectedLossCost.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})} `}
                                                                                ({result.projectedLoss.toLocaleString(undefined, {maximumFractionDigits: 2})} {result.baseUnit})
                                                                                <HelpCircle className="h-3 w-3" />
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
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
             {quickProjectionProduct && (
                <QuickProjectionModal 
                    baseProduct={quickProjectionProduct}
                    onOpenChange={() => setQuickProjectionProduct(null)}
                />
            )}
        </Card>
    );
}
