"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
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
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { RestockAnalysisDocument } from './pdf/RestockAnalysisDocument';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Checkbox } from './ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false,
    loading: () => <p>Carregando...</p>
  }
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
  const { toast } = useToast();
  
  const kioskId = searchParams.get('kioskId');
  const isMatriz = kioskId === 'matriz';
  
  const [suggestionToView, setSuggestionToView] = useState<AnalysisResult | null>(null);
  const [stagedItems, setStagedItems] = useState<RepositionItem[]>([]);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);

  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { products, loading: productsLoading } = useProducts();
  const { createRepositionActivity, loading: repositionLoading } = useReposition();

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
  
  const handleStageItemToggle = (result: AnalysisResult, checked: boolean) => {
    if (checked) {
      if (result.suggestion) {
        const repositionItem: RepositionItem = {
          baseProductId: result.baseProduct.id,
          productName: result.baseProduct.name,
          quantityNeeded: result.restockNeeded,
          suggestedLots: result.suggestion.map(s => ({
            lotId: s.lot.id,
            productId: s.lot.productId,
            productName: products.find(p => p.id === s.lot.productId)?.baseName || '',
            lotNumber: s.lot.lotNumber,
            quantityToMove: s.quantityToMove,
          }))
        };
        handleStageItem(repositionItem);
      } else {
        setSuggestionToView(result);
      }
    } else {
      handleRemoveStagedItem(result.baseProduct.id);
    }
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
    }).sort((a, b) => {
        const aIsRepor = a.status === 'repor';
        const bIsRepor = b.status === 'repor';

        if (aIsRepor && !bIsRepor) {
            return -1;
        }
        if (!aIsRepor && bIsRepor) {
            return 1;
        }
        return a.baseProduct.name.localeCompare(b.baseProduct.name);
    });
  }, [kioskId, baseProducts, products, lots, loading, isMatriz]);
  
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

  const formatNumberDisplay = (value: number, unit: string) => {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
  }

  const stagedItemMap = useMemo(() => {
    return new Map(stagedItems.map(item => [item.baseProductId, item]));
  }, [stagedItems]);
  
  const kiosk = kiosks.find(k => k.id === kioskId);

  return (
    <>
      <Card>
          <CardHeader>
              <CardTitle>Análise de Reposição</CardTitle>
              <CardDescription>
                  {isMatriz
                    ? "Visualize a necessidade de compra de insumos para a Matriz com base no estoque mínimo definido."
                    : `Compare o estoque atual de ${kiosk?.name || '...'} com a meta e crie uma atividade de reposição.`}
              </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
                <Skeleton className="h-64 w-full" />
            ) : analysisResults.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                    <Inbox className="mx-auto h-12 w-12" />
                    <p className="mt-4 font-semibold">Nenhum produto base encontrado para este quiosque.</p>
                </div>
            ) : (
                <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {!isMatriz && <TableHead className="w-10">Sel.</TableHead>}
                            <TableHead>Produto Base</TableHead>
                            <TableHead className="text-right">Estoque Mínimo</TableHead>
                            <TableHead className="text-right">Estoque Atual</TableHead>
                            <TableHead className="text-right">Necessidade</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            {!isMatriz && <TableHead className="text-right">Ações</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {analysisResults.map(result => {
                           const isStaged = !isMatriz && stagedItemMap.has(result.baseProduct.id);
                           return (
                            <TableRow key={result.baseProduct.id} className={isStaged ? 'bg-primary/10' : ''}>
                                 {!isMatriz && (
                                     <TableCell>
                                        {result.suggestion && (
                                            <Checkbox
                                                checked={isStaged}
                                                onCheckedChange={(checked) => handleStageItemToggle(result, !!checked)}
                                            />
                                        )}
                                    </TableCell>
                                 )}
                                <TableCell className="font-medium">{result.baseProduct.name}</TableCell>
                                <TableCell className="text-right">{result.minimumStock > 0 ? formatNumberDisplay(result.minimumStock, result.baseProduct.unit) : '-'}</TableCell>
                                <TableCell className="text-right">{result.hasConversionError ? 'Erro' : formatNumberDisplay(result.currentStock, result.baseProduct.unit)}</TableCell>
                                <TableCell className="text-right font-bold text-destructive">
                                    {result.restockNeeded > 0 ? formatNumberDisplay(result.restockNeeded, result.baseProduct.unit) : '-'}
                                </TableCell>
                                <TableCell className="text-center">{getStatusBadge(result)}</TableCell>
                                {!isMatriz && (
                                <TableCell className="text-right">
                                    {result.suggestion ? (
                                        isStaged ? (
                                            <div className="flex items-center justify-end gap-1">
                                                <Badge variant="secondary">Na reposição</Badge>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleRemoveStagedItem(result.baseProduct.id)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setSuggestionToView(result)}
                                            >
                                                <Wand2 className="mr-2 h-4 w-4" />
                                                Sugerir
                                            </Button>
                                        )
                                    ) : null}
                                </TableCell>
                                )}
                            </TableRow>
                        )})}
                    </TableBody>
                </Table>
                </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-end gap-2 border-t pt-4">
              {isMatriz ? (
                  <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                          <Button disabled={analysisResults.filter(item => item.status === 'repor').length === 0}>
                              <Download className="mr-2 h-4 w-4" />
                              Exportar Lista
                          </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={handleExportCsv}>
                              Exportar como CSV
                          </DropdownMenuItem>
                          <PDFDownloadLink
                              document={<RestockAnalysisDocument data={analysisResults.filter(item => item.status === 'repor')} kioskName={kiosk?.name || 'N/A'} />}
                              fileName={`reposicao_${kiosk?.name.replace(/\s/g, '_') || 'desconhecido'}_${new Date().toISOString().slice(0, 10)}.pdf`}
                          >
                               {({ loading }) => (
                                    <DropdownMenuItem disabled={loading} onSelect={(e) => e.preventDefault()}>
                                        {loading ? 'Gerando PDF...' : 'Exportar como PDF'}
                                    </DropdownMenuItem>
                                )}
                          </PDFDownloadLink>
                      </DropdownMenuContent>
                  </DropdownMenu>
              ) : (
                  <>
                      <Button variant="outline" onClick={() => setStagedItems([])} disabled={stagedItems.length === 0}>
                          Limpar Seleção
                      </Button>
                      <Button
                          onClick={() => setIsSummaryModalOpen(true)}
                          disabled={stagedItems.length === 0 || repositionLoading}
                      >
                          {repositionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                          Finalizar e criar atividade ({stagedItems.length})
                      </Button>
                  </>
              )}
          </CardFooter>
      </Card>
      
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
