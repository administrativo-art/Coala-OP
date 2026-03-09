"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { format, parseISO } from 'date-fns';
import Papa from 'papaparse';
import type { BlobProviderParams } from '@react-pdf/renderer';

import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { convertValue, units, type UnitCategory } from '@/lib/conversion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Package, Wand2, Truck, Trash2, Download, Info, Loader2, Inbox, ArrowRight, PlusCircle, LayoutGrid, List } from 'lucide-react';
import { type BaseProduct, type LotEntry, type Kiosk, type RepositionItem, type Product } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { RestockSuggestionModal } from './restock-suggestion-modal';
import { useReposition } from '@/hooks/use-reposition';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { RestockAnalysisDocument } from './pdf/RestockAnalysisDocument';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Checkbox } from './ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="outline" size="sm" className="relative" disabled>Carregando...</Button> }
);

interface SuggestedLot {
    lot: LotEntry;
    quantityToMove: number;
}

export interface AnalysisResult {
  baseProduct: BaseProduct;
  currentStock: number;
  minimumStock: number;
  restockNeeded: number;
  status: 'ok' | 'repor' | 'excesso' | 'sem_meta';
  stockPercentage: number | null;
  hasConversionError: boolean;
  suggestion?: SuggestedLot[];
}

function RestockSummaryModal({ open, onOpenChange, stagedItems, analysisResults, onConfirm, onCancel, kioskName, isLoading }: { open: boolean; onOpenChange: (open: boolean) => void; stagedItems: RepositionItem[]; analysisResults: AnalysisResult[]; onConfirm: () => void; onCancel: () => void; kioskName: string; isLoading: boolean; }) {
    const { products, getProductFullName } = useProducts();
    const { baseProducts } = useBaseProducts();

    const getUnitsPerPackage = (product: Product, baseProduct: BaseProduct): number => {
        try {
            return convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
        } catch (e) {
            console.error(e);
            return 0;
        }
    };
    
    const itemsWithDetails = useMemo(() => {
        return stagedItems.map(item => {
            const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
            if (!baseProduct) return null;
            
            const detailedLots = item.suggestedLots.map(lot => {
                const product = products.find(p => p.id === lot.productId);
                if (!product) return null;
                
                const unitsPerPackage = getUnitsPerPackage(product, baseProduct);
                
                let baseUnitQty = 0;
                let logisticUnitQty = null;

                if (unitsPerPackage > 0) {
                    baseUnitQty = lot.quantityToMove * unitsPerPackage;
                }

                if (product.multiplo_caixa && product.multiplo_caixa > 0) {
                    logisticUnitQty = lot.quantityToMove / product.multiplo_caixa;
                }

                return {
                    ...lot,
                    productName: getProductFullName(product),
                    packageType: product.packageType || 'pct',
                    baseUnitQty,
                    logisticUnitQty,
                    logisticUnitLabel: product.rotulo_caixa
                };
            }).filter((l): l is NonNullable<typeof l> => l !== null);
            
            const totalBaseUnitQty = detailedLots.reduce((sum, lot) => sum + lot.baseUnitQty, 0);

            return {
                ...item,
                baseUnit: baseProduct.unit,
                totalBaseUnitQty,
                detailedLots
            };
        }).filter((item): item is NonNullable<typeof item> => item !== null);
    }, [stagedItems, baseProducts, products, getProductFullName]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Revisão da Atividade de Reposição</DialogTitle>
                    <DialogDescription>
                        Confirme os itens e quantidades para a transferência para <strong>{kioskName}</strong>.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-auto -mx-6 px-6">
                    <ScrollArea className="h-full pr-4">
                       <Accordion type="multiple" className="w-full space-y-2">
                            {itemsWithDetails.map(item => {
                                const analysisResult = analysisResults.find(r => r.baseProduct.id === item.baseProductId);
                                return (
                                <AccordionItem key={item.baseProductId} value={item.baseProductId} className="border-b-0">
                                    <Card>
                                    <AccordionTrigger className="p-3 font-semibold hover:no-underline text-left">
                                        <div className="flex justify-between items-center w-full pr-2">
                                            <div>
                                                <p className="font-semibold text-lg">{item.productName}</p>
                                                {analysisResult && (
                                                    <div className="text-xs text-muted-foreground font-normal">
                                                        Estoque: {analysisResult.currentStock.toFixed(1)} {item.baseUnit} | 
                                                        Necessidade: {analysisResult.restockNeeded.toFixed(1)} {item.baseUnit}
                                                    </div>
                                                )}
                                            </div>
                                            <span className="font-bold text-primary">{item.totalBaseUnitQty.toFixed(1)} {item.baseUnit}</span>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="pt-0 px-3 pb-3">
                                        <div className="rounded-md border">
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Insumo</TableHead>
                                                        <TableHead>Lote</TableHead>
                                                        <TableHead className="text-right">Qtd. a Mover</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {item.detailedLots.map(lot => (
                                                        <TableRow key={lot.lotId}>
                                                            <TableCell>{lot.productName}</TableCell>
                                                            <TableCell>{lot.lotNumber}</TableCell>
                                                            <TableCell className="text-right">
                                                                <div className="font-semibold">{lot.quantityToMove} {lot.packageType}</div>
                                                                <div className="text-xs text-muted-foreground">
                                                                    ({lot.baseUnitQty.toFixed(1)} {item.baseUnit}
                                                                    {lot.logisticUnitQty && ` / ${lot.logisticUnitQty.toFixed(2)} ${lot.logisticUnitLabel}`})
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </AccordionContent>
                                    </Card>
                                </AccordionItem>
                            )})}
                        </Accordion>
                    </ScrollArea>
                </div>
                <DialogFooter className="pt-4 border-t">
                    <Button variant="outline" onClick={onCancel}>Voltar</Button>
                    <Button onClick={onConfirm} disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const formatNumberDisplay = (value: number, unit: string) => {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

export function RestockAnalysis() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const kioskId = searchParams.get('kioskId');
  const isMatriz = kioskId === 'matriz';
  
  const [suggestionToView, setSuggestionToView] = useState<AnalysisResult | null>(null);
  const [stagedItems, setStagedItems] = useState<RepositionItem[]>([]);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { products, loading: productsLoading } = useProducts();
  const { createRepositionActivity, loading: repositionLoading } = useReposition();

  const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading;

  useEffect(() => {
    const saved = localStorage.getItem('restock-view-mode');
    if (saved === 'grid' || saved === 'list') {
        setViewMode(saved);
    }
  }, []);

  const handleViewModeChange = (val: 'grid' | 'list') => {
    if (!val) return;
    setViewMode(val);
    localStorage.setItem('restock-view-mode', val);
  };
  
  const handleStageItem = (item: RepositionItem) => {
    setStagedItems(prev => {
        const existingIndex = prev.findIndex(i => i.baseProductId === item.baseProductId);
        if (existingIndex > -1) {
            const newItems = [...prev];
            newItems[existingIndex] = item;
            return newItems;
        }
        return [...prev, item];
    });
    setSuggestionToView(null);
  };
  
  const handleRemoveStagedItem = (baseProductId: string) => {
    setStagedItems(prev => prev.filter(i => i.baseProductId !== baseProductId));
  };
  
  const handleCreateRepositionActivity = async () => {
    if (stagedItems.length === 0 || !kioskId || isMatriz) return;

    const destinationKiosk = kiosks.find(k => k.id === kioskId);
    if (!destinationKiosk) return;
    
    try {
        const activityId = await createRepositionActivity({
            kioskOriginId: 'matriz',
            kioskOriginName: 'Centro de distribuição - Matriz',
            kioskDestinationId: destinationKiosk.id,
            kioskDestinationName: destinationKiosk.name,
            items: stagedItems,
        });

        if (!activityId) throw new Error("A criação da atividade falhou e não retornou um ID.");
        
        toast({
            title: "Atividade de reposição criada.",
            description: "Agora você será redirecionado para o gerenciamento da reposição.",
        });

        setStagedItems([]);
        router.push('/dashboard/stock/reposition');
    } catch (error: any) {
         toast({
            variant: 'destructive',
            title: 'Erro ao criar atividade',
            description: error.message || "Não foi possível criar a atividade de reposição.",
        });
    } finally {
        setIsSummaryModalOpen(false);
    }
  };
  
    const handleExportCsv = () => {
    const dataToExport = analysisResults
      .filter(item => item.status === 'repor')
      .map(item => ({
        'Produto Base': item.baseProduct.name,
        'Unidade': item.baseProduct.unit,
        'Estoque Mínimo': item.minimumStock,
        'Estoque Atual': item.currentStock.toFixed(2),
        'Necessidade de Reposição': item.restockNeeded.toFixed(2),
      }));

    if (dataToExport.length === 0) {
      toast({
        title: "Nenhum item para exportar",
        description: "Não há itens com necessidade de reposição no momento.",
      });
      return;
    }

    const csv = Papa.unparse(dataToExport);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `reposicao_matriz_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
  
  const analysisResults = useMemo((): AnalysisResult[] => {
    if (!kioskId || loading) return [];
    
    const productMap = new Map(products.map(p => [p.id, p]));
    const lotsInKiosk = lots.filter(lot => lot.kioskId === kioskId);
    const lotsInMatriz = lots.filter(lot => lot.kioskId === 'matriz');

    return baseProducts.map(baseProduct => {
      const minimumStock = baseProduct.stockLevels?.[kioskId]?.min;
      
      let currentStock = 0;
      let hasConversionError = false;

      const lotsForBaseProduct = lotsInKiosk.filter(lot => {
        const product = productMap.get(lot.productId);
        return product?.baseProductId === baseProduct.id;
      });

      for (const lot of lotsForBaseProduct) {
        const product = productMap.get(lot.productId);
        if (!product) {
          hasConversionError = true;
          continue;
        }

        try {
            let valueInBaseUnit = 0;
            const availableQuantity = (lot.quantity || 0) - (lot.reservedQuantity || 0);
            if (availableQuantity <= 0) continue;
            const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
            valueInBaseUnit = availableQuantity * valueOfOnePackageInBase;
            currentStock += valueInBaseUnit;
        } catch (error) {
            console.error("Conversion failed for product:", product, error);
            hasConversionError = true;
        }
      }

      let status: AnalysisResult['status'] = 'ok';
      let restockNeeded = 0;
      let stockPercentage: number | null = null;
      let suggestion: SuggestedLot[] | undefined = undefined;

      if (minimumStock === undefined || minimumStock === null) {
        status = 'sem_meta';
      } else if (hasConversionError) {
        // Cannot determine status if there's a conversion error
      } else {
        restockNeeded = Math.max(0, (minimumStock || 0) - currentStock);
        if (currentStock < minimumStock) {
          status = 'repor';
        }
        if (minimumStock && minimumStock > 0) {
            stockPercentage = (currentStock / minimumStock) * 100;
        } else if (currentStock > 0) {
            stockPercentage = 100;
        }

        if (status === 'repor' && restockNeeded > 0 && !isMatriz) {
            const availableMatrizLots = lotsInMatriz
                .filter(lot => {
                    const p = productMap.get(lot.productId);
                    const availableQty = lot.quantity - (lot.reservedQuantity || 0);
                    return p?.baseProductId === baseProduct.id && availableQty > 0;
                })
                .sort((a,b) => (a.expiryDate && b.expiryDate) ? new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime() : 0);
            
            let needed = restockNeeded;
            const suggestionList: SuggestedLot[] = [];

            for (const lot of availableMatrizLots) {
                if (needed <= 0) break;
                const product = productMap.get(lot.productId)!;
                let unitsPerPackage = 0;
                const availableQtyInPackages = lot.quantity - (lot.reservedQuantity || 0);

                try {
                       unitsPerPackage = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                } catch {
                    continue;
                }
                
                if (unitsPerPackage > 0) {
                    const packagesToMeetNeed = Math.ceil(needed / unitsPerPackage);
                    const packagesToMove = Math.min(availableQtyInPackages, packagesToMeetNeed);
                    
                    if (packagesToMove > 0) {
                        suggestionList.push({
                            lot,
                            quantityToMove: packagesToMove
                        });
                        needed -= packagesToMove * unitsPerPackage;
                    }
                }
            }
            if(suggestionList.length > 0) {
                suggestion = suggestionList;
            }
        }

      }

      return {
        baseProduct,
        currentStock,
        minimumStock: minimumStock ?? 0,
        restockNeeded,
        status,
        stockPercentage,
        hasConversionError,
        suggestion,
      };
    }).sort((a, b) => {
        const getRank = (item: AnalysisResult) => {
            if (item.hasConversionError) return 0;
            if (item.status === 'repor') {
                return (item.stockPercentage !== null && item.stockPercentage <= 25) ? 1 : 2;
            }
            if (item.status === 'sem_meta') return 3;
            if (item.status === 'excesso') return 4;
            return 5;
        };

        const aRank = getRank(a);
        const bRank = getRank(b);

        if (aRank !== bRank) {
            return aRank - bRank;
        }
        
        if (aRank === 1 || aRank === 2) {
            const aPct = a.stockPercentage ?? 0;
            const bPct = b.stockPercentage ?? 0;
            if (aPct !== bPct) return aPct - bPct;
        }

        return a.baseProduct.name.localeCompare(b.baseProduct.name);
    });
  }, [kioskId, baseProducts, products, lots, loading, isMatriz]);
  
  const kiosk = kiosks.find(k => k.id === kioskId);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const getCardStatus = (result: AnalysisResult) => {
    if (result.hasConversionError) {
      return {
        card: 'border-destructive/20 bg-destructive/5',
        progress: 'bg-destructive',
        badge: <Badge variant="destructive">Erro Conversão</Badge>,
        rowDot: 'bg-destructive'
      };
    }
    
    const percentage = result.stockPercentage ?? 0;
    
    if (result.status === 'sem_meta') {
         return {
            card: 'bg-muted/30 border-transparent',
            progress: 'bg-muted-foreground',
            badge: <Badge variant="outline">Sem Meta</Badge>,
            rowDot: 'bg-muted-foreground'
        };
    } else if (result.currentStock >= result.minimumStock) {
        return {
            card: 'border-green-600/20 bg-green-500/5',
            progress: 'bg-green-600',
            badge: <Badge variant="secondary" className="bg-green-600 text-white"><CheckCircle className="mr-1 h-3 w-3" /> OK</Badge>,
            rowDot: 'bg-green-600'
        };
    } else if (percentage <= 25) {
        return {
            card: 'border-destructive border-2 bg-destructive/10 shadow-sm',
            progress: 'bg-destructive',
            badge: <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" /> Urgente</Badge>,
            rowDot: 'bg-destructive'
        };
    } else { // percentage between 25 and 100
        return {
            card: 'border-orange-500/40 bg-orange-500/5',
            progress: 'bg-orange-500',
            badge: <Badge variant="destructive" className="bg-orange-500 text-white"><AlertTriangle className="mr-1 h-3 w-3" /> Repor</Badge>,
            rowDot: 'bg-orange-500'
        };
    }
  };

  const renderGridView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {analysisResults.map(result => {
           const statusStyle = getCardStatus(result);
          return (
            <Card key={result.baseProduct.id} className={cn("flex flex-col transition-all duration-300", statusStyle.card)}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start gap-2">
                  <CardTitle className="text-base font-semibold leading-tight line-clamp-2">{result.baseProduct.name}</CardTitle>
                  <div className="shrink-0">{statusStyle.badge}</div>
                </div>
                <CardDescription>{result.baseProduct.unit}</CardDescription>
              </CardHeader>
              <CardContent className="flex-grow space-y-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-end mb-1">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">Atual</span>
                        <span className="text-sm font-semibold">{formatNumberDisplay(result.currentStock, result.baseProduct.unit)}</span>
                    </div>
                    <div className="text-right flex flex-col items-end">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">Ideal</span>
                        <span className="text-sm font-semibold text-muted-foreground">{formatNumberDisplay(result.minimumStock, result.baseProduct.unit)}</span>
                    </div>
                  </div>
                  
                  <div className="relative pt-1">
                     {result.stockPercentage !== null && (
                         <div className="flex justify-between items-center text-[10px] font-bold mb-1">
                            <span className={cn(
                                "px-1.5 py-0.5 rounded-sm shadow-sm",
                                result.stockPercentage <= 25 ? "bg-destructive text-white" : 
                                result.stockPercentage < 100 ? "bg-orange-500 text-white" : 
                                "bg-green-600 text-white"
                            )}>
                                {result.stockPercentage.toFixed(0)}% do ideal
                            </span>
                         </div>
                     )}
                     <Progress value={Math.min(100, result.stockPercentage ?? 0)} indicatorClassName={statusStyle.progress} />
                  </div>
                   {result.restockNeeded > 0 && (
                      <p className="text-sm font-bold text-destructive pt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Repor: {formatNumberDisplay(result.restockNeeded, result.baseProduct.unit)}
                      </p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="pt-2">
                {!isMatriz && (result.status === 'repor' || result.status === 'ok') && (
                  <Button 
                    variant={result.status === 'repor' ? 'default' : 'ghost'} 
                    size="sm" 
                    className={cn(
                        "w-full h-auto text-sm",
                        result.status === 'ok' && "text-xs text-muted-foreground hover:bg-green-500/10"
                    )} 
                    onClick={() => setSuggestionToView(result)}
                  >
                    {result.status === 'repor' ? (
                        <><PlusCircle className="mr-2 h-4 w-4" /> Adicionar insumo</>
                    ) : (
                        "O estoque está ótimo, mas quero enviar mesmo assim"
                    )}
                  </Button>
                )}
              </CardFooter>
            </Card>
          )
        })}
    </div>
  );

  const renderListView = () => (
    <div className="rounded-md border bg-card">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead className="w-4"></TableHead>
                    <TableHead>Produto Base</TableHead>
                    <TableHead className="text-right">Atual</TableHead>
                    <TableHead className="text-right">Ideal</TableHead>
                    <TableHead className="text-right">Repor</TableHead>
                    <TableHead className="text-center">Status (%)</TableHead>
                    {!isMatriz && <TableHead className="text-right w-10"></TableHead>}
                </TableRow>
            </TableHeader>
            <TableBody>
                {analysisResults.map(result => {
                    const statusStyle = getCardStatus(result);
                    const percentage = result.stockPercentage ?? 0;
                    
                    return (
                        <TableRow key={result.baseProduct.id} className="group h-12">
                            <TableCell className="pr-0">
                                <div className={cn("w-2 h-2 rounded-full", statusStyle.rowDot)} />
                            </TableCell>
                            <TableCell className="py-2">
                                <p className="font-semibold text-sm leading-tight">{result.baseProduct.name}</p>
                                <p className="text-[10px] text-muted-foreground uppercase">{result.baseProduct.unit}</p>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                                {formatNumberDisplay(result.currentStock, '')}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                                {formatNumberDisplay(result.minimumStock, '')}
                            </TableCell>
                            <TableCell className={cn("text-right font-bold", result.restockNeeded > 0 ? "text-destructive" : "text-muted-foreground/30")}>
                                {result.restockNeeded > 0 ? formatNumberDisplay(result.restockNeeded, '') : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                                {result.stockPercentage !== null ? (
                                    <Badge variant="outline" className={cn(
                                        "text-[10px] font-bold",
                                        percentage <= 25 ? "border-destructive text-destructive bg-destructive/5" :
                                        percentage < 100 ? "border-orange-500 text-orange-600 bg-orange-500/5" :
                                        "border-green-600 text-green-600 bg-green-500/5"
                                    )}>
                                        {percentage.toFixed(0)}%
                                    </Badge>
                                ) : '-'}
                            </TableCell>
                            {!isMatriz && (
                                <TableCell className="text-right">
                                    {(result.status === 'repor' || result.status === 'ok') && (
                                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setSuggestionToView(result)}>
                                            <PlusCircle className="h-4 w-4" />
                                        </Button>
                                    )}
                                </TableCell>
                            )}
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    </div>
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
              <ToggleGroup type="single" value={viewMode} onValueChange={handleViewModeChange as any} className="border p-1 rounded-lg bg-background">
                  <ToggleGroupItem value="grid" aria-label="Visualização em Grade" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                      <LayoutGrid className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="list" aria-label="Visualização em Lista" className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                      <List className="h-4 w-4" />
                  </ToggleGroupItem>
              </ToggleGroup>
              <span className="text-xs text-muted-foreground hidden sm:inline">Modo de exibição</span>
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={analysisResults.length === 0}>
                  <Download className="mr-2 h-4 w-4" />
                  Exportar CSV
              </Button>
              <PDFDownloadLink
                  document={<RestockAnalysisDocument data={analysisResults} kioskName={kiosk?.name || 'Unidade'} />}
                  fileName={`analise_reposicao_${kiosk?.name.replace(/\s+/g, '_') || 'unidade'}.pdf`}
              >
                  {((props: any) => (
                      <Button variant="outline" size="sm" disabled={props.loading || analysisResults.length === 0}>
                          <Download className="mr-2 h-4 w-4" />
                          {props.loading ? 'Gerando...' : 'Exportar PDF'}
                      </Button>
                  )) as any}
              </PDFDownloadLink>
          </div>
      </div>

      {analysisResults.length === 0 && !loading ? (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg bg-card">
              <Inbox className="mx-auto h-12 w-12 mb-4" />
              <p className="font-semibold">Nenhum produto base encontrado para este quiosque.</p>
          </div>
      ) : (
          viewMode === 'grid' ? renderGridView() : renderListView()
      )}

       {stagedItems.length > 0 && !isMatriz && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/90 backdrop-blur-sm border-t z-40 shadow-[0_-4px_16px_rgba(0,0,0,0.05)] animate-in slide-in-from-bottom duration-300">
                <div className="max-w-7xl mx-auto flex justify-between items-center px-4">
                    <div>
                        <h3 className="font-semibold">{stagedItems.length} {stagedItems.length === 1 ? 'item' : 'itens'} para reposição</h3>
                        <p className="text-sm text-muted-foreground">Revise e crie a atividade de transferência.</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setStagedItems([])}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Limpar
                        </Button>
                        <Button onClick={() => setIsSummaryModalOpen(true)}>
                            Revisar Envio
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        )}

      {suggestionToView && (
          <RestockSuggestionModal
              suggestionResult={suggestionToView}
              targetKiosk={kiosks.find(k => k.id === kioskId)!}
              onOpenChange={() => setSuggestionToView(null)}
              onStage={handleStageItem}
          />
      )}
  
      <RestockSummaryModal
          open={isSummaryModalOpen}
          onOpenChange={setIsSummaryModalOpen}
          stagedItems={stagedItems}
          analysisResults={analysisResults}
          onConfirm={handleCreateRepositionActivity}
          onCancel={() => setIsSummaryModalOpen(false)}
          kioskName={kiosks.find(k => k.id === kioskId)?.name || ''}
          isLoading={repositionLoading}
      />
    </>
  );
}