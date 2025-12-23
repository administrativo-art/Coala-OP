
"use client";

import { useState, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useKiosks } from '@/hooks/use-kiosks';
import { useExpiryProducts } from '@/hooks/use-expiry-products';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { convertValue, units } from '@/lib/conversion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from './ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, CheckCircle, Package, Wand2, Truck, ShoppingCart, Trash2, Download, Info, History, Undo2, PlusCircle, Inbox } from 'lucide-react';
import { type BaseProduct, type LotEntry, type Kiosk, type RepositionItem, type UnitCategory, type RepositionActivity } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { RestockSuggestionModal } from './restock-suggestion-modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { RepositionManagement } from './reposition-management';
import { useReposition } from '@/hooks/use-reposition';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { useAuth } from '@/hooks/use-auth';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

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

function AnalysisTab() {
  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { products, loading: productsLoading } = useProducts();
  const { createRepositionActivity, loading: repositionLoading } = useReposition();
  const { toast } = useToast();

  const [selectedKioskId, setSelectedKioskId] = useState<string>('');
  const [suggestionToView, setSuggestionToView] = useState<AnalysisResult | null>(null);
  const [stagedItems, setStagedItems] = useState<RepositionItem[]>([]);

  const loading = kiosksLoading || lotsLoading || baseProductsLoading || productsLoading;
  const isMatrizSelected = selectedKioskId === 'matriz';
  
  const sortedKiosks = useMemo(() => {
    return [...kiosks].sort((a,b) => {
        if (a.id === 'matriz') return -1;
        if (b.id === 'matriz') return 1;
        return a.name.localeCompare(b.name);
    });
  }, [kiosks]);
  
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
    toast({
        title: "Item adicionado à reposição",
        description: `${item.productName} está pronto para ser enviado.`
    });
  };

  const handleRemoveStagedItem = (baseProductId: string) => {
    setStagedItems(prev => prev.filter(i => i.baseProductId !== baseProductId));
  };
  
  const handleCreateRepositionActivity = async () => {
    if (stagedItems.length === 0 || !selectedKioskId || selectedKioskId === 'matriz') return;

    const destinationKiosk = kiosks.find(k => k.id === selectedKioskId);
    if (!destinationKiosk) return;
    
    await createRepositionActivity({
        kioskOriginId: 'matriz',
        kioskOriginName: 'Centro de distribuição - Matriz',
        kioskDestinationId: destinationKiosk.id,
        kioskDestinationName: destinationKiosk.name,
        items: stagedItems,
    });
    
    toast({ title: 'Atividade de reposição criada', description: 'O pedido foi enviado para a tela de gerenciamento de reposição.' });
    setStagedItems([]);
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
            const quantityInPackages = lot.quantity;

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
                valueInBaseUnit = quantityInPackages * valueOfOnePackageInBase;
            } else if (baseProduct.category === 'Unidade') {
                valueInBaseUnit = quantityInPackages * product.packageSize;
            } else if (product.category === baseProduct.category) {
                 const valueOfOnePackageInBase = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                 valueInBaseUnit = quantityInPackages * valueOfOnePackageInBase;
            } else {
                throw new Error(`Cannot convert from category ${product.category} to ${baseProduct.category} without a secondary unit.`);
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
                    } else if (baseProduct.category === 'Unidade') {
                       unitsPerPackage = product.packageSize;
                    } else if (product.category === baseProduct.category) {
                       unitsPerPackage = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                    } else {
                        continue;
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

  const handleExportPdf = () => {
    const doc = new jsPDF();
    const kioskName = kiosks.find(k => k.id === selectedKioskId)?.name || 'Quiosque Desconhecido';

    doc.setFontSize(18);
    doc.text(`Lista de Compras - ${kioskName}`, 14, 22);

    const body = analysisResults
        .filter(item => item.restockNeeded > 0)
        .map(item => [
            item.baseProduct.name,
            `${item.restockNeeded.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${item.baseProduct.unit}`
        ]);
        
    autoTable(doc, {
      startY: 30,
      head: [['Produto Base', 'Quantidade Necessária']],
      body,
      theme: 'striped',
    });

    doc.save(`lista_compras_${kioskName.replace(/\s/g, '_')}.pdf`);
  };

  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Análise de reposição</CardTitle>
        <CardDescription>
          Selecione um quiosque para ver a necessidade de reposição com base nas metas de estoque mínimo.
        </CardDescription>
        <div className="pt-2 flex justify-between items-center">
             <div className="flex items-center gap-2">
                <Select value={selectedKioskId} onValueChange={setSelectedKioskId} disabled={loading}>
                  <SelectTrigger className="w-full max-w-sm">
                    <SelectValue placeholder="Selecione um quiosque para analisar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedKiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                 {selectedKioskId && (
                     <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon"><Info className="h-5 w-5 text-muted-foreground"/></Button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                {isMatrizSelected ? (
                                    <p>O estoque mínimo da Matriz é calculado para cobrir <strong>1 mês</strong> do consumo médio de toda a rede. Nenhuma margem de segurança extra é adicionada.</p>
                                ) : (
                                    <p>O estoque mínimo para quiosques é calculado para cobrir <strong>12 dias</strong> de consumo médio do próprio quiosque, com base nos relatórios de venda importados.</p>
                                )}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}
            </div>
            {isMatrizSelected && (
                <Button variant="outline" onClick={handleExportPdf} disabled={analysisResults.filter(item => item.restockNeeded > 0).length === 0}>
                    <Download className="mr-2 h-4 w-4" /> Exportar Lista de Compras
                </Button>
            )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : !selectedKioskId ? (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
            <Package className="mx-auto h-12 w-12" />
            <p className="mt-4 font-semibold">Selecione um quiosque para iniciar a análise.</p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">Produto base</TableHead>
                  <TableHead className="text-center">Estoque mínimo</TableHead>
                  <TableHead className="text-center">Estoque atual</TableHead>
                  <TableHead className="w-[20%] text-center">Nível</TableHead>
                  <TableHead className="text-center">Ação</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysisResults.length > 0 ? analysisResults.map(result => {
                    const isStaged = stagedItemMap.has(result.baseProduct.id);
                    return (
                        <TableRow key={result.baseProduct.id} className={cn(!isMatrizSelected && isStaged && "bg-primary/5")}>
                            <TableCell className="font-medium">{result.baseProduct.name}</TableCell>
                            <TableCell className="text-center">{result.minimumStock > 0 ? `${result.minimumStock} ${result.baseProduct.unit}` : '-'}</TableCell>
                            <TableCell className="text-center font-semibold">{result.hasConversionError ? 'N/A' : `${result.currentStock.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${result.baseProduct.unit}`}</TableCell>
                            <TableCell className="text-center">
                                {result.stockPercentage !== null ? (
                                    <Progress value={result.stockPercentage} className={cn(result.stockPercentage < 100 ? '[&>*]:bg-orange-500' : '[&>*]:bg-green-500')} />
                                ) : '-'}
                            </TableCell>
                            <TableCell className="text-center font-bold text-primary">
                            {isMatrizSelected ? (
                                result.restockNeeded > 0 ? `Comprar ${result.restockNeeded.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${result.baseProduct.unit}` : '-'
                            ) : isStaged ? (
                                <div className="flex items-center justify-center gap-2">
                                <Badge variant="secondary">Na reposição</Badge>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleRemoveStagedItem(result.baseProduct.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                </div>
                            ) : (
                                <Button
                                    variant={result.suggestion ? "outline" : "secondary"}
                                    size="sm"
                                    onClick={() => setSuggestionToView(result)}
                                >
                                    {result.suggestion ? (
                                        <><Wand2 className="mr-2 h-4 w-4" /> Ver sugestão</>
                                    ) : (
                                        <><PlusCircle className="mr-2 h-4 w-4" /> Adicionar</>
                                    )}
                                </Button>
                            )}
                            </TableCell>
                            <TableCell className="text-center">{getStatusBadge(result)}</TableCell>
                        </TableRow>
                    )
                }) : (
                    <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                            Nenhum produto base encontrado para análise.
                        </TableCell>
                    </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
    
    {!isMatrizSelected && stagedItems.length > 0 && (
        <Card className="mt-6 animate-in fade-in">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><ShoppingCart /> Itens para reposição</CardTitle>
                <CardDescription>Revise os itens antes de criar a atividade de reposição para o quiosque {kiosks.find(k => k.id === selectedKioskId)?.name}.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                    {stagedItems.map(item => (
                        <div key={item.baseProductId} className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                            <div>
                                <p className="font-semibold">{item.productName}</p>
                                <p className="text-sm text-muted-foreground">{item.suggestedLots.length} lote(s) sugerido(s)</p>
                            </div>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleRemoveStagedItem(item.baseProductId)}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            </CardContent>
            <CardFooter className="justify-end border-t pt-4">
                <Button onClick={handleCreateRepositionActivity} disabled={repositionLoading}>
                    <Truck className="mr-2 h-4 w-4" />
                    {repositionLoading ? 'Criando atividade...' : `Criar atividade de reposição (${stagedItems.length})`}
                </Button>
            </CardFooter>
        </Card>
    )}

    {suggestionToView && (
        <RestockSuggestionModal
            suggestionResult={suggestionToView}
            targetKiosk={kiosks.find(k => k.id === selectedKioskId)!}
            onOpenChange={() => setSuggestionToView(null)}
            onStage={handleStageItem}
        />
    )}
    </>
  );
}

function RepositionHistory() {
    const { activities, loading } = useReposition();
    const { permissions } = useAuth();
    const [isReverting, setIsReverting] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'Concluído' | 'Cancelada'>('all');

    const historicalActivities = useMemo(() => {
        return activities.filter(activity => {
            if (statusFilter === 'all') {
                return activity.status === 'Concluído' || activity.status === 'Cancelada';
            }
            return activity.status === statusFilter;
        });
    }, [activities, statusFilter]);

    if (loading) return <Skeleton className="h-64 w-full" />;
    
    const hasAnyHistory = activities.some(a => a.status === 'Concluído' || a.status === 'Cancelada');

    if (!hasAnyHistory) {
         return (
            <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                <History className="mx-auto h-12 w-12" />
                <p className="mt-4 font-semibold">Nenhum histórico encontrado.</p>
            </div>
        );
    }
    
    return (
    <>
        <Card>
            <CardHeader>
                <CardTitle>Histórico de Reposições</CardTitle>
                <CardDescription>Consulte todas as atividades de reposição que já foram concluídas ou canceladas.</CardDescription>
                <div className="pt-2">
                    <Tabs defaultValue="all" value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)} className="w-full sm:w-auto">
                        <TabsList>
                            <TabsTrigger value="all">Todos</TabsTrigger>
                            <TabsTrigger value="Concluído">Concluídos</TabsTrigger>
                            <TabsTrigger value="Cancelada">Cancelados</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
            </CardHeader>
            <CardContent>
                {historicalActivities.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground">
                        <Inbox className="mx-auto h-12 w-12" />
                        <p className="mt-4 font-semibold">Nenhum registro para este filtro.</p>
                    </div>
                ) : (
                    <Accordion type="multiple" className="w-full space-y-3">
                        {historicalActivities.map(activity => {
                            const hasDivergence = activity.status === 'Recebido com divergência';
                            
                            return (
                            <AccordionItem key={activity.id} value={activity.id} className="border rounded-lg">
                                <AccordionTrigger className="p-4 hover:no-underline text-left">
                                    <div className="flex justify-between items-center w-full">
                                        <div>
                                            <p className="font-semibold text-base">{activity.kioskOriginName} → {activity.kioskDestinationName}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {activity.status === 'Concluído' ? 'Concluída em' : 'Cancelada em'} {activity.updatedAt ? format(parseISO(activity.updatedAt), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : ''}
                                            </p>
                                        </div>
                                        <Badge variant={activity.status === 'Cancelada' ? 'destructive' : 'default'}>{activity.status}</Badge>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="p-4 pt-0">
                                <div className="space-y-4">
                                    {activity.receiptNotes && (
                                        <blockquote className="mt-2 border-l-2 pl-4 italic text-sm text-muted-foreground">
                                            <strong>Notas do Recebimento:</strong> "{activity.receiptNotes}"
                                        </blockquote>
                                    )}
                                    <div className="rounded-md border">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Insumo</TableHead>
                                                <TableHead>Lote</TableHead>
                                                <TableHead className="text-center">Qtd. Enviada</TableHead>
                                                <TableHead className="text-center">Qtd. Recebida</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {activity.items.flatMap(item => 
                                                item.suggestedLots.map(lot => {
                                                    const receivedLot = activity.items.flatMap(i => i.receivedLots || []).find(rl => rl.lotId === lot.lotId);
                                                    const receivedQty = receivedLot?.receivedQuantity;
                                                    const sentQty = lot.quantityToMove;
                                                    const isDivergent = receivedQty !== undefined && sentQty !== receivedQty;

                                                    return (
                                                        <TableRow key={lot.lotId} className={cn(isDivergent && "bg-destructive/10")}>
                                                            <TableCell className="font-medium">{lot.productName}</TableCell>
                                                            <TableCell>{lot.lotNumber}</TableCell>
                                                            <TableCell className="text-center">{sentQty}</TableCell>
                                                            <TableCell className={cn("text-center font-bold", isDivergent && "text-destructive")}>
                                                                {receivedQty ?? '-'}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                })
                                            )}
                                        </TableBody>
                                    </Table>
                                    </div>
                                </div>
                                </AccordionContent>
                            </AccordionItem>
                        )})}
                    </Accordion>
                )}
            </CardContent>
        </Card>
    </>
    );
}

export function RestockAnalysis() {
  return (
    <Tabs defaultValue="analysis" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="analysis"><Wand2 className="mr-2 h-4 w-4" /> Análise</TabsTrigger>
        <TabsTrigger value="management"><Truck className="mr-2 h-4 w-4" /> Gerenciar reposição</TabsTrigger>
        <TabsTrigger value="history"><History className="mr-2 h-4 w-4" /> Histórico</TabsTrigger>
      </TabsList>
      <TabsContent value="analysis" className="mt-4">
        <AnalysisTab />
      </TabsContent>
      <TabsContent value="management" className="mt-4">
        <RepositionManagement />
      </TabsContent>
      <TabsContent value="history" className="mt-4">
        <RepositionHistory />
      </TabsContent>
    </Tabs>
  );
}
