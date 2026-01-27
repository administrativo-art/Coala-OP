
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { BlobProviderParams } from '@react-pdf/renderer';
import { format, parseISO } from 'date-fns';
import Papa from 'papaparse';

import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { convertValue, units, type UnitCategory } from '@/lib/conversion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from './ui/skeleton';
import { Badge } from './ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Package, Wand2, Truck, ShoppingCart, Trash2, Download, Info, ArrowRight, Loader2, Inbox, PlusCircle } from 'lucide-react';
import { type BaseProduct, type LotEntry, type Kiosk, type RepositionItem } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { RestockSuggestionModal } from './restock-suggestion-modal';
import { useReposition } from '@/hooks/use-reposition';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from "@/components/ui/toast"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { RestockAnalysisDocument } from './pdf/RestockAnalysisDocument';
import { GlassCard } from './ui/glass-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false }
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

function RestockSummaryModal({
    open,
    onOpenChange,
    stagedItems,
    analysisResults,
    onConfirm,
    onCancel,
    kioskName,
    isLoading
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    stagedItems: RepositionItem[];
    analysisResults: AnalysisResult[];
    onConfirm: () => void;
    onCancel: () => void;
    kioskName: string;
    isLoading: boolean;
}) {
    const { products } = useProducts();
    const { baseProducts } = useBaseProducts();

    const itemsWithDetails = useMemo(() => {
        return stagedItems.map(item => {
            const analysisInfo = analysisResults.find(ar => ar.baseProduct.id === item.baseProductId);
            const totalPackages = item.suggestedLots.reduce((sum, lot) => sum + lot.quantityToMove, 0);
            
            let totalInBaseUnit = 0;
            const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);

            if(baseProduct) {
                item.suggestedLots.forEach(lot => {
                    const product = products.find(p => p.id === lot.productId);
                    if (!product) return;
                    
                    try {
                        let valueOfOnePackageInBase = 0;
                        if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                            let secondaryUnitCategory: UnitCategory | undefined;
                            for (const category in units) {
                                if (Object.keys(units[category as UnitCategory]).includes(product.secondaryUnit)) {
                                    secondaryUnitCategory = category as UnitCategory;
                                    break;
                                }
                            }
                            if (!secondaryUnitCategory) return;
                            valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                        } else {
                           valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                        }
                        totalInBaseUnit += lot.quantityToMove * valueOfOnePackageInBase;
                    } catch (e) {
                        console.error('Conversion error in summary modal', e);
                    }
                });
            }

            return {
                ...item,
                minimumStock: analysisInfo?.minimumStock || 0,
                currentStock: analysisInfo?.currentStock || 0,
                totalPackages,
                totalInBaseUnit,
                baseUnit: baseProduct?.unit || ''
            };
        });
    }, [stagedItems, analysisResults, products, baseProducts]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Resumo da Reposição</DialogTitle>
                    <DialogDescription>
                        Confirme os itens a serem transferidos para <strong>{kioskName}</strong>.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <ScrollArea className="h-60 rounded-md border">
                         <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Produto Base</TableHead>
                                    <TableHead className="text-right">Estoque Mínimo</TableHead>
                                    <TableHead className="text-right">Estoque Atual</TableHead>
                                    <TableHead className="text-right">A Repor</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {itemsWithDetails.map(item => (
                                    <TableRow key={item.baseProductId}>
                                        <TableCell className="font-medium">{item.productName}</TableCell>
                                        <TableCell className="text-right">{item.minimumStock} {item.baseUnit}</TableCell>
                                        <TableCell className="text-right">{item.currentStock.toFixed(1)} {item.baseUnit}</TableCell>
                                        <TableCell className="text-right font-semibold">
                                            <div>{item.totalPackages} pct</div>
                                            <div className="text-xs text-muted-foreground">({item.totalInBaseUnit.toFixed(1)} {item.baseUnit})</div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </div>
                <DialogFooter>
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


export function RestockAnalysis() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { products, loading: productsLoading } = useProducts();
  const { createRepositionActivity, loading: repositionLoading } = useReposition();
  const { toast } = useToast();

  const [selectedKioskId, setSelectedKioskId] = useState<string>('');
  const [suggestionToView, setSuggestionToView] = useState<AnalysisResult | null>(null);
  const [stagedItems, setStagedItems] = useState<RepositionItem[]>([]);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);

  useEffect(() => {
    const kioskIdFromUrl = searchParams.get('kioskId');
    if (kioskIdFromUrl) {
      setSelectedKioskId(kioskIdFromUrl);
    }
  }, [searchParams]);

  const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading;
  
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
    if (stagedItems.length === 0 || !selectedKioskId || selectedKioskId === 'matriz') return;

    const destinationKiosk = kiosks.find(k => k.id === selectedKioskId);
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
            title: "Atividade de Reposição Criada",
            description: `Acesse a tela de gerenciamento para despachar os itens.`,
            action: <ToastAction altText="Ver" onClick={() => router.push('/dashboard/stock/reposition')}>Ver Atividades</ToastAction>,
        });

        setStagedItems([]);
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

  const analysisResults = useMemo((): AnalysisResult[] => {
    if (!selectedKioskId || loading) return [];
    
    const productMap = new Map(products.map(p => [p.id, p]));
    const lotsInKiosk = lots.filter(lot => lot.kioskId === selectedKioskId);
    const lotsInMatriz = lots.filter(lot => lot.kioskId === 'matriz');

    return baseProducts.map(baseProduct => {
      const minimumStock = baseProduct.stockLevels?.[selectedKioskId]?.min;
      
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

            if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                 let secondaryUnitCategory: UnitCategory | undefined;
                 for (const category in units) {
                    if (Object.keys(units[category as UnitCategory]).includes(product.secondaryUnit)) {
                        secondaryUnitCategory = category as UnitCategory;
                        break;
                    }
                 }
                if (!secondaryUnitCategory) {
                    throw new Error(`Unidade secundária inválida ou não categorizada: ${product.secondaryUnit}`);
                }
                const valueOfOnePackageInBase = convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                valueInBaseUnit = availableQuantity * valueOfOnePackageInBase;
            } else {
                 const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                 valueInBaseUnit = availableQuantity * valueOfOnePackageInBase;
            }

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
        restockNeeded = Math.max(0, minimumStock - currentStock);
        if (currentStock < minimumStock) {
          status = 'repor';
        }
        if (minimumStock > 0) {
            stockPercentage = Math.min(100, (currentStock / minimumStock) * 100);
        }

        if (status === 'repor' && restockNeeded > 0 && selectedKioskId !== 'matriz') {
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
                     if (product.secondaryUnit && typeof product.secondaryUnitValue === 'number' && product.secondaryUnitValue > 0) {
                        let secondaryUnitCategory: UnitCategory | undefined;
                        for (const category in units) {
                           if (Object.keys(units[category as UnitCategory]).includes(product.secondaryUnit)) {
                               secondaryUnitCategory = category as UnitCategory;
                               break;
                           }
                        }
                       if (!secondaryUnitCategory) continue;
                       unitsPerPackage = convertValue(product.secondaryUnitValue, product.secondaryUnit, baseProduct.unit, secondaryUnitCategory);
                    } else {
                       unitsPerPackage = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                    }
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
    }).sort((a, b) => a.baseProduct.name.localeCompare(b.baseProduct.name));
  }, [selectedKioskId, baseProducts, products, lots, loading]);
  
  const getStatusBadge = (result: AnalysisResult) => {
    if (result.hasConversionError) {
      return <Badge variant="destructive">Erro de Conversão</Badge>;
    }
    switch (result.status) {
      case 'repor':
        return <Badge variant="destructive" className="bg-orange-500 text-white"><AlertTriangle className="mr-1 h-3 w-3" /> Repor</Badge>;
      case 'ok':
        return <Badge variant="secondary" className="bg-green-600 text-white"><CheckCircle className="mr-1 h-3 w-3" /> OK</Badge>;
      case 'sem_meta':
        return <Badge variant="outline">Sem Meta</Badge>;
      default:
        return <Badge variant="secondary">{result.status}</Badge>;
    }
  };

  const stagedItemMap = useMemo(() => {
    return new Map(stagedItems.map(item => [item.baseProductId, item]));
  }, [stagedItems]);
  
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Análise de reposição</CardTitle>
          <CardDescription>
            {kiosks.find(k => k.id === selectedKioskId)?.name || 'Carregando...'}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : !selectedKioskId ? (
            <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
              <p>Carregando quiosque...</p>
            </div>
          ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {analysisResults.length > 0 ? analysisResults.map(result => {
                      const isStaged = stagedItemMap.has(result.baseProduct.id);
                      return (
                          <GlassCard key={result.baseProduct.id} variant={result.status === 'repor' ? 'red' : 'default'} className="flex flex-col">
                              <CardHeader className="flex-row items-start justify-between gap-4">
                                  <div>
                                      <CardTitle>{result.baseProduct.name}</CardTitle>
                                      <CardDescription>{result.baseProduct.unit}</CardDescription>
                                  </div>
                                  {getStatusBadge(result)}
                              </CardHeader>
                              <CardContent className="flex-grow space-y-4">
                                  <div className="flex justify-between items-baseline">
                                      <span className="text-sm text-muted-foreground">Estoque Atual</span>
                                      <span className="text-2xl font-bold">{result.hasConversionError ? 'N/A' : result.currentStock.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                                  </div>
                                  <div className="flex justify-between items-baseline">
                                      <span className="text-sm text-muted-foreground">Meta Mínima</span>
                                      <span className="text-lg">{result.minimumStock > 0 ? result.minimumStock : '-'}</span>
                                  </div>
                                  {result.stockPercentage !== null && (
                                      <div>
                                          <Progress value={result.stockPercentage} className={cn(result.stockPercentage < 50 ? '[&>*]:bg-orange-500' : '[&>*]:bg-green-500')} />
                                          <p className="text-xs text-right text-muted-foreground mt-1">{result.stockPercentage.toFixed(0)}% da meta</p>
                                      </div>
                                  )}
                              </CardContent>
                              <CardFooter>
                                  {selectedKioskId !== 'matriz' && (
                                    isStaged ? (
                                      <div className="flex items-center justify-center gap-2 w-full">
                                          <Badge variant="secondary">Na reposição</Badge>
                                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleRemoveStagedItem(result.baseProduct.id)}>
                                              <Trash2 className="h-4 w-4" />
                                          </Button>
                                      </div>
                                    ) : (
                                        <Button
                                            variant={result.suggestion ? "default" : "secondary"}
                                            size="sm"
                                            className="w-full"
                                            onClick={() => setSuggestionToView(result)}
                                            disabled={result.status === 'ok' || result.status === 'sem_meta'}
                                        >
                                            {result.suggestion ? (
                                                <><Wand2 className="mr-2 h-4 w-4" /> Ver sugestão</>
                                            ) : (
                                                <><PlusCircle className="mr-2 h-4 w-4" /> Adicionar</>
                                            )}
                                        </Button>
                                    )
                                  )}
                              </CardFooter>
                          </GlassCard>
                      )
                  }) : (
                      <div className="col-span-full text-center py-16 text-muted-foreground">
                          <Inbox className="mx-auto h-12 w-12" />
                          <p className="mt-4 font-semibold">Nenhum produto base encontrado para análise.</p>
                      </div>
                  )}
              </div>
          )}
        </CardContent>
      </Card>
      
      {selectedKioskId && selectedKioskId !== 'matriz' && stagedItems.length > 0 && (
          <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg p-4 z-40">
              <div className="bg-background/80 backdrop-blur-lg rounded-xl p-3 border shadow-2xl flex justify-center items-center gap-4">
                  <Button variant="destructive" onClick={() => setStagedItems([])}>Cancelar Reposição</Button>
                  <Button onClick={() => setIsSummaryModalOpen(true)}>
                      Próximo <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
              </div>
          </div>
      )}
  
      {suggestionToView && (
          <RestockSuggestionModal
              suggestionResult={suggestionToView}
              targetKiosk={kiosks.find(k => k.id === selectedKioskId)!}
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
          kioskName={kiosks.find(k => k.id === selectedKioskId)?.name || ''}
          isLoading={repositionLoading}
      />
      </>
    );
}
