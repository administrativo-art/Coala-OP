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
import { AlertTriangle, CheckCircle, Package, Wand2, Truck, Trash2, Download, Info, Loader2, Inbox, ArrowRight, PlusCircle, LayoutGrid, List, ImageIcon } from 'lucide-react';
import { type BaseProduct, type LotEntry, type Kiosk, type RepositionItem, type Product, type RepositionRequest } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { RestockSuggestionModal } from './restock-suggestion-modal';
import { useReposition } from '@/hooks/use-reposition';
import { useRepositionRequests } from '@/hooks/use-reposition-requests';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { RestockAnalysisDocument } from './pdf/RestockAnalysisDocument';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Checkbox } from './ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false, loading: () => <Button variant="outline" size="sm" className="relative" disabled>Carregando...</Button> }
);

interface SuggestedLot {
    lot: LotEntry;
    quantityToMove: number;
}

const PARTIAL_FULFILLMENT_REASONS = [
  "Falta de mercadoria",
  "Substituição por item equivalente",
  "Quantidade ajustada por embalagem",
  "Solicitação acima da necessidade",
  "Erro na solicitação",
  "Item descontinuado",
  "Item incluído pelo CD",
  "Outro",
] as const;

type PartialFulfillmentReason = typeof PARTIAL_FULFILLMENT_REASONS[number];

type RequestDivergenceReview = {
  request: RepositionRequest;
  items: RepositionItem[];
  divergences: Array<{
    baseProductId: string;
    productName: string;
    requestedQuantity: number;
    fulfilledQuantity: number;
    unit: string;
  }>;
};

type CdReviewLine = {
  id: string;
  baseProductId: string;
  productName: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  requestedQuantity: number;
  toSendQuantity: number | "";
  reason: PartialFulfillmentReason | "";
  notes: string;
  source: "request" | "cd";
};

type CdReviewState = {
  request: RepositionRequest;
  lines: CdReviewLine[];
};

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

function RestockSummaryModal({ open, onOpenChange, stagedItems, analysisResults, onConfirm, onCancel, onRemoveItem, kioskName, isLoading, title = "Revisão da Solicitação de Reposição", description = "Confirme os itens e quantidades para enviar ao CD.", confirmLabel = "Enviar solicitação" }: { open: boolean; onOpenChange: (open: boolean) => void; stagedItems: RepositionItem[]; analysisResults: AnalysisResult[]; onConfirm: () => void; onCancel: () => void; onRemoveItem: (id: string) => void; kioskName: string; isLoading: boolean; title?: string; description?: string; confirmLabel?: string; }) {
    const { products, getProductFullName } = useProducts();
    const { baseProducts } = useBaseProducts();
    const { lots } = useExpiryProducts();

    const getUnitsPerPackage = (product: Product, baseProduct: BaseProduct): number => {
        return getUnitsPerPackageForProduct(product, baseProduct);
    };
    
    const itemsWithDetails = useMemo(() => {
        return stagedItems.map(item => {
            const baseProduct = baseProducts.find(bp => bp.id === item.baseProductId);
            if (!baseProduct) return null;
            
            const detailedLots = item.suggestedLots.map(lot => {
                const product = products.find(p => p.id === lot.productId);
                if (!product) return null;
                const lotEntry = lots.find(entry => entry.id === lot.lotId);
                
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
                    imageUrl: lotEntry?.imageUrl || product.imageUrl || "",
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
    }, [stagedItems, baseProducts, products, lots, getProductFullName]);

    const totalBaseQuantity = itemsWithDetails.reduce((sum, item) => sum + item.totalBaseUnitQty, 0);
    const baseUnitLabel = itemsWithDetails[0]?.baseUnit || 'und. base';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl overflow-hidden rounded-2xl p-0">
                <DialogHeader className="border-b px-5 py-4">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>
                        {stagedItems.length} item{stagedItems.length === 1 ? '' : 's'} para {kioskName.replace(/^Quiosque\s+/i, '')}.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[52vh] overflow-auto px-5 py-4">
                    <div className="space-y-3">
                        {itemsWithDetails.map(item => (
                            <div key={item.baseProductId} className="rounded-xl border bg-background p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0">
                                        <div className="min-w-0">
                                            <h3 className="truncate font-semibold">{item.productName}</h3>
                                            <p className="text-xs text-muted-foreground">
                                                {item.detailedLots.length} lote{item.detailedLots.length === 1 ? '' : 's'} · necessidade {formatNumberDisplay(item.quantityNeeded, item.baseUnit)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="font-bold text-primary">{formatNumberDisplay(item.totalBaseUnitQty, item.baseUnit)}</span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                            onClick={() => onRemoveItem(item.baseProductId)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="mt-3 border-t pt-2">
                                    {item.detailedLots.map(lot => (
                                        <div key={lot.lotId} className="flex items-center justify-between gap-3 py-1 text-sm">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                                                    {lot.imageUrl ? (
                                                        <img src={lot.imageUrl} alt={lot.productName} className="h-full w-full object-cover" />
                                                    ) : (
                                                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="truncate text-xs font-semibold text-muted-foreground">Lote {lot.lotNumber || '-'}</p>
                                                    <p className="truncate text-xs text-muted-foreground">{lot.productName}</p>
                                                </div>
                                            </div>
                                            <div className="shrink-0 text-right">
                                                <p className="font-medium">{lot.quantityToMove} {lot.packageType}</p>
                                                <p className="text-xs text-muted-foreground">= {formatNumberDisplay(lot.baseUnitQty, item.baseUnit)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <DialogFooter className="border-t bg-muted/20 px-5 py-4">
                    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm">
                            <span className="text-muted-foreground">Total: </span>
                            <span className="font-bold">{formatNumberDisplay(totalBaseQuantity, baseUnitLabel)}</span>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={onCancel}>Voltar</Button>
                            <Button onClick={onConfirm} disabled={isLoading || stagedItems.length === 0}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {confirmLabel}
                            </Button>
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

const formatNumberDisplay = (value: number, unit: string) => {
    return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

const getUnitsPerPackageForProduct = (product: Product, baseProduct: BaseProduct): number => {
  try {
    const packageSize = Number(product.packageSize);
    if (packageSize > 0) {
      return convertValue(packageSize, product.unit, baseProduct.unit, product.category);
    }

    if (product.unit?.toLowerCase() === baseProduct.unit?.toLowerCase()) {
      return 1;
    }

    if (["Unidade", "Embalagem", "Vestimenta"].includes(product.category)) {
      return 1;
    }

    return 0;
  } catch {
    return 0;
  }
};

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
  const [requestReview, setRequestReview] = useState<RequestDivergenceReview | null>(null);
  const [divergenceReasons, setDivergenceReasons] = useState<Record<string, { reason: PartialFulfillmentReason | ""; notes: string }>>({});
  const [cdReview, setCdReview] = useState<CdReviewState | null>(null);

  const { kiosks, loading: kiosksLoading } = useKiosks();
  const { lots, loading: lotsLoading } = useExpiryProducts();
  const { baseProducts, loading: baseProductsLoading } = useBaseProducts();
  const { products, getProductFullName, loading: productsLoading } = useProducts();
  const { createRepositionActivity, loading: repositionLoading } = useReposition();
  const {
    requests: repositionRequests,
    createRepositionRequest,
    updateRepositionRequest,
    refreshRepositionRequests,
  } = useRepositionRequests();

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

  const getRequestedQuantityFromStagedItem = (item: RepositionItem, baseProduct: BaseProduct | undefined) => {
    if (!baseProduct) return item.quantityNeeded;

    const selectedQuantity = item.suggestedLots.reduce((total, suggestedLot) => {
      const product = products.find(entry => entry.id === suggestedLot.productId);
      if (!product) return total;

      const unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);
      return total + suggestedLot.quantityToMove * unitsPerPackage;
    }, 0);

    return selectedQuantity > 0 ? selectedQuantity : item.quantityNeeded;
  };
  
  const handleCreateRepositionActivity = async () => {
    if (stagedItems.length === 0 || !kioskId || isMatriz) return;

    const destinationKiosk = kiosks.find(k => k.id === kioskId);
    if (!destinationKiosk) return;
    
    try {
        const requestItems = stagedItems.map(item => {
          const analysisResult = analysisResults.find(result => result.baseProduct.id === item.baseProductId);
          const baseProduct = baseProducts.find(entry => entry.id === item.baseProductId);
          const requestedQuantity = getRequestedQuantityFromStagedItem(item, baseProduct);
          return {
            baseProductId: item.baseProductId,
            productName: item.productName,
            unit: baseProduct?.unit ?? "",
            currentStock: analysisResult?.currentStock ?? 0,
            minimumStock: analysisResult?.minimumStock ?? 0,
            requestedQuantity,
          };
        });

        const zeroQuantityItem = requestItems.find(item => item.requestedQuantity <= 0);
        if (zeroQuantityItem) {
          throw new Error(`A quantidade solicitada para ${zeroQuantityItem.productName} está zerada. Revise o item antes de enviar.`);
        }

        const requestId = await createRepositionRequest({
            kioskId: destinationKiosk.id,
            kioskName: destinationKiosk.name,
            items: requestItems,
        });

        if (!requestId) throw new Error("A criação da solicitação falhou e não retornou um ID.");
        
        toast({
            title: "Solicitação de reposição enviada.",
            description: "O CD vai revisar os itens e criar a atividade de reposição.",
        });

        setStagedItems([]);
        await refreshRepositionRequests();
        router.push("/dashboard/stock/analysis");
    } catch (error: any) {
         toast({
            variant: 'destructive',
            title: 'Erro ao enviar solicitação',
            description: error.message || "Não foi possível criar a solicitação de reposição.",
        });
    } finally {
        setIsSummaryModalOpen(false);
    }
  };

  const pendingRequests = useMemo(
    () => repositionRequests.filter((request) => request.status === "Pendente"),
    [repositionRequests]
  );

  const openCdReview = (request: RepositionRequest) => {
    setViewMode('grid');
    localStorage.setItem('restock-view-mode', 'grid');
    setCdReview({
      request,
      lines: request.items.map((item) => ({
        id: item.baseProductId,
        baseProductId: item.baseProductId,
        productName: item.productName,
        unit: item.unit,
        currentStock: item.currentStock,
        minimumStock: item.minimumStock,
        requestedQuantity: item.requestedQuantity,
        toSendQuantity: item.requestedQuantity,
        reason: "",
        notes: "",
        source: "request",
      })),
    });
  };

  const updateCdReviewLine = (lineId: string, updates: Partial<CdReviewLine>) => {
    setCdReview((current) => {
      if (!current) return current;
      return {
        ...current,
        lines: current.lines.map((line) =>
          line.id === lineId ? { ...line, ...updates } : line
        ),
      };
    });
  };

  const addBaseProductToCdReview = (baseProduct: BaseProduct, defaults?: Partial<CdReviewLine>) => {
    setCdReview((current) => {
      if (!current || !baseProduct || current.lines.some((line) => line.baseProductId === baseProduct.id)) {
        return current;
      }

      return {
        ...current,
        lines: [
          ...current.lines,
          {
            id: `cd-${baseProduct.id}`,
            baseProductId: baseProduct.id,
            productName: baseProduct.name,
            unit: baseProduct.unit,
            currentStock: defaults?.currentStock ?? 0,
            minimumStock: defaults?.minimumStock ?? 0,
            requestedQuantity: 0,
            toSendQuantity: defaults?.toSendQuantity ?? "",
            reason: defaults?.reason ?? "Item incluído pelo CD",
            notes: "",
            source: "cd",
          },
        ],
      };
    });
  };

  const getAvailableMatrixQuantityForBaseProduct = (baseProductId: string) => {
    const baseProduct = baseProducts.find((entry) => entry.id === baseProductId);
    if (!baseProduct) return 0;

    return lots.reduce((total, lot) => {
      if (lot.kioskId !== "matriz") return total;
      const product = products.find((entry) => entry.id === lot.productId);
      if (!product || product.baseProductId !== baseProductId) return total;

      const unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);
      if (unitsPerPackage <= 0) return total;

      return total + Math.max(0, lot.quantity - (lot.reservedQuantity || 0)) * unitsPerPackage;
    }, 0);
  };

  const cdReviewLineRequiresReason = (line: CdReviewLine) => {
    return (
      line.source === "cd" ||
      Number(line.toSendQuantity || 0) !== line.requestedQuantity ||
      getAvailableMatrixQuantityForBaseProduct(line.baseProductId) < Number(line.toSendQuantity || 0)
    );
  };

  const buildItemsFromCdReview = (review: CdReviewState): RepositionItem[] => {
    const productMap = new Map(products.filter(product => !product.isArchived).map(product => [product.id, product]));
    const matrixLots = lots
      .filter(lot => lot.kioskId === "matriz" && lot.quantity - (lot.reservedQuantity || 0) > 0)
      .sort((left, right) => {
        if (!left.expiryDate && !right.expiryDate) return 0;
        if (!left.expiryDate) return 1;
        if (!right.expiryDate) return -1;
        return new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime();
      });

    return review.lines
      .filter((line) => Number(line.toSendQuantity || 0) > 0 || line.requestedQuantity > 0)
      .map((line) => {
        const baseProduct = baseProducts.find(entry => entry.id === line.baseProductId);
        if (!baseProduct) {
          throw new Error(`Produto base ${line.productName} não encontrado.`);
        }

        const toSendQuantity = Number(line.toSendQuantity || 0);
        let needed = Math.max(0, toSendQuantity);
        let fulfilledQuantity = 0;
        const suggestedLots = [];

        for (const lot of matrixLots) {
          if (needed <= 0) break;
          const product = productMap.get(lot.productId);
          if (product?.baseProductId !== line.baseProductId) continue;

          const unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);
          if (unitsPerPackage <= 0) continue;

          const availablePackages = lot.quantity - (lot.reservedQuantity || 0);
          const packagesToMove = Math.min(availablePackages, Math.ceil(needed / unitsPerPackage));
          if (packagesToMove <= 0) continue;

          suggestedLots.push({
            lotId: lot.id,
            productId: lot.productId,
            productName: getProductFullName(product),
            lotNumber: lot.lotNumber,
            quantityToMove: packagesToMove,
          });
          fulfilledQuantity += packagesToMove * unitsPerPackage;
          needed -= packagesToMove * unitsPerPackage;
        }

        if (toSendQuantity > 0 && suggestedLots.length === 0) {
          throw new Error(`Sem saldo disponível na Matriz para ${line.productName}.`);
        }

        const hasDivergence = line.source === "cd" || fulfilledQuantity !== line.requestedQuantity;

        return {
          baseProductId: line.baseProductId,
          productName: line.productName,
          quantityNeeded: toSendQuantity,
          suggestedLots,
          fulfillmentDivergence: hasDivergence ? {
            requestedQuantity: line.requestedQuantity,
            fulfilledQuantity,
            unit: line.unit,
            reason: line.reason as PartialFulfillmentReason,
            notes: line.notes.trim() || undefined,
          } : undefined,
        };
      });
  };

  const handleConfirmCdReview = async () => {
    if (!cdReview) return;

    const invalidLine = cdReview.lines.find((line) => {
      if (Number(line.toSendQuantity || 0) < 0) return true;
      const hasDivergence = cdReviewLineRequiresReason(line);
      return hasDivergence && (!line.reason || (line.reason === "Outro" && !line.notes.trim()));
    });

    if (invalidLine) {
      toast({
        variant: "destructive",
        title: "Revise o envio",
        description: `Informe uma quantidade válida e o motivo para ${invalidLine.productName}.`,
      });
      return;
    }

    try {
      const items = buildItemsFromCdReview(cdReview);
      if (!items.some((item) => item.suggestedLots.length > 0)) {
        throw new Error("Informe pelo menos um item com saldo disponível para criar a atividade.");
      }
      await createActivityFromReviewedItems(cdReview.request, items);
      setCdReview(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao criar atividade",
        description: error.message || "Não foi possível criar a atividade a partir da revisão.",
      });
    }
  };

  const buildItemsFromRequest = (request: RepositionRequest) => {
    const productMap = new Map(products.filter(product => !product.isArchived).map(product => [product.id, product]));
    const matrixLots = lots
      .filter(lot => lot.kioskId === "matriz" && lot.quantity - (lot.reservedQuantity || 0) > 0)
      .sort((left, right) => {
        if (!left.expiryDate && !right.expiryDate) return 0;
        if (!left.expiryDate) return 1;
        if (!right.expiryDate) return -1;
        return new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime();
      });

    const requestedItems = request.items.filter((requestItem) => requestItem.requestedQuantity > 0);
    if (requestedItems.length === 0) {
      throw new Error("Esta solicitação não tem quantidade a repor. Cancele a solicitação ou revise o estoque mínimo da unidade.");
    }

    const divergences: RequestDivergenceReview["divergences"] = [];
    const items = requestedItems.map((requestItem) => {
      const baseProduct = baseProducts.find(entry => entry.id === requestItem.baseProductId);
      if (!baseProduct) {
        throw new Error(`Produto base ${requestItem.productName} não encontrado.`);
      }

      let needed = requestItem.requestedQuantity;
      const suggestedLots = [];
      let fulfilledQuantity = 0;

      for (const lot of matrixLots) {
        if (needed <= 0) break;
        const product = productMap.get(lot.productId);
        if (product?.baseProductId !== requestItem.baseProductId) continue;

        const unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);

        if (unitsPerPackage <= 0) continue;

        const availablePackages = lot.quantity - (lot.reservedQuantity || 0);
        const packagesToMove = Math.min(availablePackages, Math.ceil(needed / unitsPerPackage));
        if (packagesToMove <= 0) continue;
        const fulfilledByLot = packagesToMove * unitsPerPackage;

        suggestedLots.push({
          lotId: lot.id,
          productId: lot.productId,
          productName: getProductFullName(product),
          lotNumber: lot.lotNumber,
          quantityToMove: packagesToMove,
        });
        fulfilledQuantity += fulfilledByLot;
        needed -= fulfilledByLot;
      }

      if (fulfilledQuantity < requestItem.requestedQuantity) {
        divergences.push({
          baseProductId: requestItem.baseProductId,
          productName: requestItem.productName,
          requestedQuantity: requestItem.requestedQuantity,
          fulfilledQuantity,
          unit: requestItem.unit,
        });
      }

      return {
        baseProductId: requestItem.baseProductId,
        productName: requestItem.productName,
        quantityNeeded: requestItem.requestedQuantity,
        suggestedLots,
      };
    });

    const hasAnyFulfilledItem = items.some(item => item.suggestedLots.length > 0);
    if (!hasAnyFulfilledItem) {
      throw new Error("Nenhum item da solicitação tem saldo disponível na Matriz para criar uma atividade.");
    }

    return { items, divergences };
  };

  const createActivityFromReviewedItems = async (request: RepositionRequest, items: RepositionItem[]) => {
    const destinationKiosk = kiosks.find(kiosk => kiosk.id === request.kioskId);
    if (!destinationKiosk) throw new Error("Unidade solicitante não encontrada.");

    const activityId = await createRepositionActivity({
      requestId: request.id,
      kioskOriginId: "matriz",
      kioskOriginName: "Centro de distribuição - Matriz",
      kioskDestinationId: destinationKiosk.id,
      kioskDestinationName: destinationKiosk.name,
      items,
    });

    if (!activityId) throw new Error("A criação da atividade falhou e não retornou um ID.");

    await refreshRepositionRequests();
    toast({
      title: "Atividade criada",
      description: `A solicitação de ${request.kioskName} entrou em separação.`,
    });
    router.push("/dashboard/stock/analysis");
  };

  const handleCreateActivityFromRequest = async (request: RepositionRequest) => {
    try {
      const { items, divergences } = buildItemsFromRequest(request);

      if (divergences.length > 0) {
        setRequestReview({ request, items, divergences });
        setDivergenceReasons(Object.fromEntries(
          divergences.map(divergence => [
            divergence.baseProductId,
            { reason: "", notes: "" },
          ])
        ));
        return;
      }

      await createActivityFromReviewedItems(request, items);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao criar atividade",
        description: error.message || "Não foi possível criar a atividade a partir da solicitação.",
      });
    }
  };

  const handleConfirmRequestReview = async () => {
    if (!requestReview) return;

    const missingReason = requestReview.divergences.find((divergence) => {
      const entry = divergenceReasons[divergence.baseProductId];
      return !entry?.reason || (entry.reason === "Outro" && !entry.notes.trim());
    });

    if (missingReason) {
      toast({
        variant: "destructive",
        title: "Justificativa obrigatória",
        description: `Informe o motivo da divergência para ${missingReason.productName}.`,
      });
      return;
    }

    const reviewedItems = requestReview.items.map((item) => {
      const divergence = requestReview.divergences.find(entry => entry.baseProductId === item.baseProductId);
      if (!divergence) return item;
      const selected = divergenceReasons[item.baseProductId];
      return {
        ...item,
        fulfillmentDivergence: {
          requestedQuantity: divergence.requestedQuantity,
          fulfilledQuantity: divergence.fulfilledQuantity,
          unit: divergence.unit,
          reason: selected.reason as PartialFulfillmentReason,
          notes: selected.notes.trim() || undefined,
        },
      };
    });

    try {
      await createActivityFromReviewedItems(requestReview.request, reviewedItems);
      setRequestReview(null);
      setDivergenceReasons({});
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao criar atividade",
        description: error.message || "Não foi possível criar a atividade a partir da solicitação.",
      });
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
    
    const productMap = new Map(products.filter(p => !p.isArchived).map(p => [p.id, p]));
    const lotsInKiosk = lots.filter(lot => lot.kioskId === kioskId);
    const lotsInMatriz = lots.filter(lot => lot.kioskId === 'matriz');

    return baseProducts.filter(bp => !bp.isArchived).map(baseProduct => {
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
            const valueOfOnePackageInBase = getUnitsPerPackageForProduct(product, baseProduct);
            if (valueOfOnePackageInBase <= 0) {
              hasConversionError = true;
              continue;
            }
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

                unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);
                
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

  const renderGridView = () => {
    const reviewLineMap = new Map(cdReview?.lines.map((line, index) => [line.baseProductId, { line, index }]) ?? []);
    const orderedResults = cdReview
      ? [...analysisResults].sort((left, right) => {
          const leftReview = reviewLineMap.get(left.baseProduct.id);
          const rightReview = reviewLineMap.get(right.baseProduct.id);
          if (leftReview && rightReview) return leftReview.index - rightReview.index;
          if (leftReview) return -1;
          if (rightReview) return 1;
          return 0;
        })
      : analysisResults;

    return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,300px))] justify-center gap-4">
        {orderedResults.map(result => {
           const statusStyle = getCardStatus(result);
           const reviewEntry = reviewLineMap.get(result.baseProduct.id);
           const reviewLine = reviewEntry?.line;
           const hasReviewDivergence = reviewLine ? cdReviewLineRequiresReason(reviewLine) : false;

          return (
            <Card key={result.baseProduct.id} className={cn(
              "flex flex-col transition-all duration-300",
              reviewLine ? "border-primary bg-primary/5 shadow-sm" : statusStyle.card
            )}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start gap-2">
                  <CardTitle className="text-base font-semibold leading-tight line-clamp-2">{result.baseProduct.name}</CardTitle>
                  <div className="shrink-0">
                    {reviewLine ? <Badge>Em revisão</Badge> : statusStyle.badge}
                  </div>
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
                {isMatriz && cdReview && (
                  reviewLine ? (
                    <div className="w-full space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">A enviar</label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            value={reviewLine.toSendQuantity}
                            onChange={(event) => updateCdReviewLine(reviewLine.id, {
                              toSendQuantity: event.target.value === "" ? "" : Number(event.target.value),
                            })}
                            className="h-9"
                          />
                          <span className="text-xs text-muted-foreground">{reviewLine.unit}</span>
                        </div>
                      </div>

                      {hasReviewDivergence && (
                        <>
                          <Select
                            value={reviewLine.reason}
                            onValueChange={(reason) => updateCdReviewLine(reviewLine.id, {
                              reason: reason as PartialFulfillmentReason,
                            })}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Motivo" />
                            </SelectTrigger>
                            <SelectContent>
                              {PARTIAL_FULFILLMENT_REASONS.map((reason) => (
                                <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={reviewLine.notes}
                            onChange={(event) => updateCdReviewLine(reviewLine.id, { notes: event.target.value })}
                            placeholder={reviewLine.reason === "Outro" ? "Observação obrigatória" : "Observação opcional"}
                            className="h-9"
                          />
                        </>
                      )}

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => updateCdReviewLine(reviewLine.id, { toSendQuantity: 0 })}
                        >
                          Zerar
                        </Button>
                        {reviewLine.source === "cd" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={() => setCdReview((current) => current ? ({
                              ...current,
                              lines: current.lines.filter((entry) => entry.id !== reviewLine.id),
                            }) : current)}
                          >
                            Remover
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => addBaseProductToCdReview(result.baseProduct, {
                        currentStock: result.currentStock,
                        minimumStock: result.minimumStock,
                      })}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Incluir na revisão
                    </Button>
                  )
                )}

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
  };

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

  const renderCdReviewPanel = (request: RepositionRequest) => {
    if (!cdReview || cdReview.request.id !== request.id) return null;

    const finalLines = cdReview.lines.filter((line) => Number(line.toSendQuantity || 0) > 0);

    return (
      <div className="mt-4 space-y-4 rounded-lg border bg-muted/20 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="font-semibold">Revisão do CD</h4>
            <p className="text-xs text-muted-foreground">
              Ajuste os itens nos cards abaixo. A lista final resume o que irá para separação.
            </p>
          </div>
          <Badge variant="secondary">{cdReview.lines.length} item{cdReview.lines.length === 1 ? "" : "s"} em revisão</Badge>
        </div>

        <div className="rounded-lg border bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold">Lista final para separação</h4>
              <p className="text-xs text-muted-foreground">Confira o que será enviado antes de criar a atividade.</p>
            </div>
            <Badge variant="outline">{finalLines.length} item{finalLines.length === 1 ? "" : "s"}</Badge>
          </div>

          {finalLines.length === 0 ? (
            <div className="rounded-md border border-dashed py-5 text-center text-sm text-muted-foreground">
              Nenhum item com quantidade a enviar.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Insumo</TableHead>
                    <TableHead className="text-right">Solicitado</TableHead>
                    <TableHead className="text-right">A enviar</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finalLines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.productName}</TableCell>
                      <TableCell className="text-right">{formatNumberDisplay(line.requestedQuantity, line.unit)}</TableCell>
                      <TableCell className="text-right font-semibold text-primary">{formatNumberDisplay(Number(line.toSendQuantity || 0), line.unit)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {cdReviewLineRequiresReason(line) ? (line.reason || "Pendente") : "Sem divergência"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setCdReview(null)}>Fechar revisão</Button>
          <Button onClick={handleConfirmCdReview} disabled={repositionLoading}>
            {repositionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Finalizar revisão e criar separação
          </Button>
        </div>
      </div>
    );
  };

  const renderPendingRequests = () => {
    if (!isMatriz) return null;

    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5" />
            Solicitações de reposição
          </CardTitle>
          <CardDescription>
            Pedidos enviados pelas unidades para revisão do CD antes da separação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingRequests.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              Nenhuma solicitação pendente.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((request) => {
                const hasRequestedQuantity = request.items.some(item => item.requestedQuantity > 0);

                return (
                <div key={request.id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{request.kioskName}</h3>
                        <Badge variant="outline">{request.status}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Solicitado por {request.requestedBy.username} em {format(parseISO(request.createdAt), "dd/MM/yyyy HH:mm")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateRepositionRequest(request.id, { status: "Cancelada" })}
                      >
                        Cancelar
                      </Button>
                      <Button size="sm" onClick={() => openCdReview(request)} disabled={!hasRequestedQuantity}>
                        {hasRequestedQuantity ? "Revisar envio" : "Sem itens"}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Insumo base</TableHead>
                          <TableHead className="text-right">Atual</TableHead>
                          <TableHead className="text-right">Mínimo</TableHead>
                          <TableHead className="text-right">Solicitado</TableHead>
                          <TableHead className="text-right">A enviar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {request.items.map((item) => {
                          const reviewLine = cdReview?.request.id === request.id
                            ? cdReview.lines.find((line) => line.baseProductId === item.baseProductId)
                            : undefined;

                          return (
                            <TableRow key={item.baseProductId}>
                              <TableCell className="font-medium">{item.productName}</TableCell>
                              <TableCell className="text-right">{formatNumberDisplay(item.currentStock, item.unit)}</TableCell>
                              <TableCell className="text-right">{formatNumberDisplay(item.minimumStock, item.unit)}</TableCell>
                              <TableCell className="text-right font-bold text-primary">{formatNumberDisplay(item.requestedQuantity, item.unit)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {reviewLine ? (
                                  reviewLine.toSendQuantity === ""
                                    ? "Pendente"
                                    : formatNumberDisplay(Number(reviewLine.toSendQuantity), reviewLine.unit)
                                ) : "Revisar"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {renderCdReviewPanel(request)}
                </div>
              )})}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <>
      {renderPendingRequests()}

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
            <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 animate-in slide-in-from-bottom duration-300">
                <div className="flex w-full max-w-3xl items-center justify-between gap-4 rounded-2xl bg-[#1d1d20] p-3 text-white shadow-2xl">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
                            <Package className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold">
                                {stagedItems.length} item{stagedItems.length === 1 ? '' : 's'} na solicitação
                            </h3>
                            <p className="truncate text-xs text-white/55">
                                {stagedItems[0]?.productName}
                                {stagedItems.length > 1 ? ` +${stagedItems.length - 1}` : ''} · revise antes de enviar
                            </p>
                        </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                        <Button variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setStagedItems([])}>
                            Limpar
                        </Button>
                        <Button className="bg-[#5147e8] hover:bg-[#4338ca]" onClick={() => setIsSummaryModalOpen(true)}>
                            Revisar e enviar
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

      <Dialog open={!!requestReview} onOpenChange={(open) => {
        if (!open) {
          setRequestReview(null);
          setDivergenceReasons({});
        }
      }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Justificar atendimento parcial</DialogTitle>
            <DialogDescription>
              Alguns itens serão enviados em quantidade menor que a solicitada. Informe o motivo antes de criar a atividade.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {requestReview?.divergences.map((divergence) => {
              const selected = divergenceReasons[divergence.baseProductId] ?? { reason: "", notes: "" };

              return (
                <div key={divergence.baseProductId} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="font-semibold">{divergence.productName}</h3>
                      <p className="text-sm text-muted-foreground">
                        Solicitado: {formatNumberDisplay(divergence.requestedQuantity, divergence.unit)} · Envio: {formatNumberDisplay(divergence.fulfilledQuantity, divergence.unit)}
                      </p>
                    </div>
                    <Badge variant="secondary">Divergência</Badge>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <Select
                      value={selected.reason}
                      onValueChange={(reason) => setDivergenceReasons((current) => ({
                        ...current,
                        [divergence.baseProductId]: {
                          ...selected,
                          reason: reason as PartialFulfillmentReason,
                        },
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o motivo" />
                      </SelectTrigger>
                      <SelectContent>
                        {PARTIAL_FULFILLMENT_REASONS.map((reason) => (
                          <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selected.reason === "Outro" && (
                      <Textarea
                        value={selected.notes}
                        onChange={(event) => setDivergenceReasons((current) => ({
                          ...current,
                          [divergence.baseProductId]: {
                            ...selected,
                            notes: event.target.value,
                          },
                        }))}
                        placeholder="Descreva a justificativa"
                        rows={3}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setRequestReview(null);
              setDivergenceReasons({});
            }}>
              Voltar
            </Button>
            <Button onClick={handleConfirmRequestReview} disabled={repositionLoading}>
              {repositionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar atividade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  
      <RestockSummaryModal
          open={isSummaryModalOpen}
          onOpenChange={setIsSummaryModalOpen}
          stagedItems={stagedItems}
          analysisResults={analysisResults}
          onConfirm={handleCreateRepositionActivity}
          onCancel={() => setIsSummaryModalOpen(false)}
          onRemoveItem={handleRemoveStagedItem}
          kioskName={kiosks.find(k => k.id === kioskId)?.name || ''}
          isLoading={repositionLoading}
      />
    </>
  );
}
