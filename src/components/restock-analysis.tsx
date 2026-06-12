"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { AlertTriangle, CheckCircle, Package, Wand2, Truck, Trash2, Download, Info, Loader2, Inbox, ArrowRight, PlusCircle, LayoutGrid, List, ImageIcon, Zap, ChevronDown, X, Search } from 'lucide-react';
import { type BaseProduct, type LotEntry, type Kiosk, type RepositionItem, type Product, type RepositionRequest, type RepositionSuggestedLot, type RepositionRequestedProduct } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { RestockSuggestionModal } from './restock-suggestion-modal';
import { useReposition } from '@/hooks/use-reposition';
import { useRepositionRequests } from '@/hooks/use-reposition-requests';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ScrollArea } from './ui/scroll-area';
import { RestockAnalysisDocument } from './pdf/RestockAnalysisDocument';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Checkbox } from './ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
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
  selectedLots: RepositionSuggestedLot[];
  requestedProducts: RepositionRequestedProduct[];
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

export function RestockAnalysis({ onReviewingChange }: { onReviewingChange?: (request: RepositionRequest | null) => void } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const kioskId = searchParams.get('kioskId');
  const isMatriz = kioskId === 'matriz';
  
  const [cartItems, setCartItems] = useState<Array<{ productId: string; packages: number }>>([]);
  const [cardModalBaseId, setCardModalBaseId] = useState<string | null>(null);
  const [requestSelectedBaseId, setRequestSelectedBaseId] = useState<string | null>(null);
  const [requestOpenedBases, setRequestOpenedBases] = useState<string[]>([]);
  const [requestSearch, setRequestSearch] = useState("");
  const [requestCategory, setRequestCategory] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [cdReview, setCdReview] = useState<CdReviewState | null>(null);
  const [cdLotPickerLine, setCdLotPickerLine] = useState<CdReviewLine | null>(null);
  const [cdExpandedLineId, setCdExpandedLineId] = useState<string | null>(null);
  const [cdOutroLotesId, setCdOutroLotesId] = useState<string | null>(null);
  const [requestLotesId, setRequestLotesId] = useState<string | null>(null);

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
  
  const addCartItem = (productId: string) => {
    setCartItems(prev => prev.some(i => i.productId === productId) ? prev : [...prev, { productId, packages: 1 }]);
  };

  const updateCartPackages = (productId: string, packages: number) => {
    setCartItems(prev => prev.map(i => i.productId === productId ? { ...i, packages } : i));
  };

  const removeCartItem = (productId: string) => {
    setCartItems(prev => prev.filter(i => i.productId !== productId));
  };

  // Define a quantidade (em embalagens) de um derivado no carrinho (insere/atualiza/remove se 0).
  const setCartProductPackages = (productId: string, packages: number) => {
    const qty = Math.max(0, packages);
    setCartItems((prev) => {
      if (qty <= 0) return prev.filter((i) => i.productId !== productId);
      if (prev.some((i) => i.productId === productId)) return prev.map((i) => (i.productId === productId ? { ...i, packages: qty } : i));
      return [...prev, { productId, packages: qty }];
    });
  };

  // Abre um insumo base no painel da solicitação (mantém no painel mesmo sem derivado) e expande.
  const openRequestBase = (baseProductId: string) => {
    setRequestOpenedBases((prev) => (prev.includes(baseProductId) ? prev : [...prev, baseProductId]));
    setRequestSelectedBaseId(baseProductId);
  };

  // Remove do carrinho todos os derivados de um insumo base e tira do painel.
  const removeRequestBase = (baseProductId: string) => {
    setCartItems((prev) => prev.filter((i) => {
      const p = products.find((pr) => pr.id === i.productId);
      return p?.baseProductId !== baseProductId;
    }));
    setRequestOpenedBases((prev) => prev.filter((id) => id !== baseProductId));
    setRequestSelectedBaseId((id) => (id === baseProductId ? null : id));
  };

  // Insumos derivados (não arquivados) de um insumo base, ainda não adicionados à solicitação.
  const getDerivadosForBase = (baseProductId: string) => {
    return products
      .filter(product =>
        product.baseProductId === baseProductId &&
        !product.isArchived &&
        !cartItems.some(ci => ci.productId === product.id)
      )
      .sort((a, b) => getProductFullName(a).localeCompare(getProductFullName(b)));
  };

  const countCartItemsForBase = (baseProductId: string) =>
    cartItems.filter(ci => {
      const product = products.find(p => p.id === ci.productId);
      return product?.baseProductId === baseProductId;
    }).length;

  // Imagem do insumo base via um derivado dele (proxy — o base não tem imagem própria).
  const getBaseImage = (baseProductId: string) =>
    products.find((p) => p.baseProductId === baseProductId && !p.isArchived && p.imageUrl)?.imageUrl ?? null;

  // Todos os derivados (não arquivados) de um insumo base.
  const getDerivadosAllForBase = (baseProductId: string) =>
    products
      .filter((p) => p.baseProductId === baseProductId && !p.isArchived)
      .sort((a, b) => getProductFullName(a).localeCompare(getProductFullName(b)));

  const handleSendRequest = async () => {
    if (!kioskId || isMatriz) return;
    const destinationKiosk = kiosks.find(k => k.id === kioskId);
    if (!destinationKiosk) return;

    // Agrupa os insumos derivados escolhidos por insumo base (uma RepositionRequestItem por base).
    const byBase = new Map<string, RepositionRequestedProduct[]>();
    for (const cartItem of cartItems) {
      if (cartItem.packages <= 0) continue;
      const product = products.find(p => p.id === cartItem.productId);
      if (!product || !product.baseProductId) continue;
      const baseProduct = baseProducts.find(b => b.id === product.baseProductId);
      if (!baseProduct) continue;
      const unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);
      const entry: RepositionRequestedProduct = {
        productId: product.id,
        productName: getProductFullName(product),
        packages: cartItem.packages,
        quantityBase: cartItem.packages * unitsPerPackage,
      };
      const list = byBase.get(product.baseProductId) ?? [];
      list.push(entry);
      byBase.set(product.baseProductId, list);
    }

    if (byBase.size === 0) {
      toast({ variant: 'destructive', title: 'Solicitação vazia', description: 'Adicione ao menos um insumo com quantidade maior que zero.' });
      return;
    }

    const requestItems = Array.from(byBase.entries()).map(([baseProductId, requestedProducts]) => {
      const baseProduct = baseProducts.find(b => b.id === baseProductId);
      const analysisResult = analysisResults.find(result => result.baseProduct.id === baseProductId);
      const requestedQuantity = requestedProducts.reduce((total, entry) => total + entry.quantityBase, 0);
      return {
        baseProductId,
        productName: baseProduct?.name ?? "",
        unit: baseProduct?.unit ?? "",
        currentStock: analysisResult?.currentStock ?? 0,
        minimumStock: analysisResult?.minimumStock ?? 0,
        requestedQuantity,
        requestedProducts,
      };
    });

    setIsSending(true);
    try {
      const requestId = await createRepositionRequest({
        kioskId: destinationKiosk.id,
        kioskName: destinationKiosk.name,
        items: requestItems,
      });
      if (!requestId) throw new Error("A criação da solicitação falhou e não retornou um ID.");
      toast({ title: "Solicitação de reposição enviada.", description: "O CD vai revisar os itens e atrelar os lotes." });
      setCartItems([]);
      await refreshRepositionRequests();
      router.push("/dashboard/stock/analysis");
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Erro ao enviar solicitação', description: error.message || "Não foi possível criar a solicitação de reposição." });
    } finally {
      setIsSending(false);
    }
  };

  const pendingRequests = useMemo(
    () => repositionRequests.filter((request) => request.status === "Pendente"),
    [repositionRequests]
  );

  // Guarda os ajustes da revisão para que "Fechar revisão" não descarte ao reabrir.
  const cdReviewCacheRef = useRef<Record<string, CdReviewState>>({});

  const openCdReview = (request: RepositionRequest) => {
    setViewMode('grid');
    localStorage.setItem('restock-view-mode', 'grid');

    const cached = cdReviewCacheRef.current[request.id];
    if (cached) {
      setCdReview(cached);
      return;
    }

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
        source: "request" as const,
        requestedProducts: item.requestedProducts ?? [],
        // Pré-preenche os lotes dos derivados solicitados; se não houver detalhe, usa FIFO por insumo base.
        selectedLots: (item.requestedProducts && item.requestedProducts.length > 0)
          ? suggestLotsForRequestedProducts(item.requestedProducts)
          : suggestLotsForBaseProduct(item.baseProductId, item.requestedQuantity).lots,
      })),
    });
  };

  // Abre a revisão direto: a solicitação pendente já entra em modo de ajuste, sem clicar "Revisar envio".
  // O ref evita reabrir uma solicitação que o estoquista já fechou manualmente.
  const autoOpenedReviewRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isMatriz || cdReview) return;
    const next = pendingRequests.find(
      (request) => request.items.some((item) => item.requestedQuantity > 0) && !autoOpenedReviewRef.current.has(request.id)
    );
    if (next) {
      autoOpenedReviewRef.current.add(next.id);
      openCdReview(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMatriz, cdReview, pendingRequests]);

  // Informa o pai qual solicitação está em revisão, para o título refletir a unidade solicitante.
  useEffect(() => {
    onReviewingChange?.(cdReview?.request ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cdReview]);

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
            source: "cd" as const,
            selectedLots: [],
            requestedProducts: [],
          },
        ],
      };
    });
  };

  // Sugere lotes da Matriz (FIFO por validade) para um insumo base, restrito ao mesmo insumo base
  // — permite anexar derivados de tamanhos diferentes. quantityToMove fica em unidades de pacote.
  const suggestLotsForBaseProduct = (
    baseProductId: string,
    neededBaseQty: number
  ): { lots: RepositionSuggestedLot[]; fulfilledQuantity: number } => {
    const baseProduct = baseProducts.find((entry) => entry.id === baseProductId);
    if (!baseProduct) return { lots: [], fulfilledQuantity: 0 };

    const productMap = new Map(products.filter(product => !product.isArchived).map(product => [product.id, product]));
    const matrixLots = lots
      .filter(lot => lot.kioskId === "matriz" && lot.quantity - (lot.reservedQuantity || 0) > 0)
      .sort((left, right) => {
        if (!left.expiryDate && !right.expiryDate) return 0;
        if (!left.expiryDate) return 1;
        if (!right.expiryDate) return -1;
        return new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime();
      });

    let needed = Math.max(0, neededBaseQty);
    let fulfilledQuantity = 0;
    const resultLots: RepositionSuggestedLot[] = [];

    for (const lot of matrixLots) {
      if (needed <= 0) break;
      const product = productMap.get(lot.productId);
      if (product?.baseProductId !== baseProductId) continue;

      const unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);
      if (unitsPerPackage <= 0) continue;

      const availablePackages = lot.quantity - (lot.reservedQuantity || 0);
      const packagesToMove = Math.min(availablePackages, Math.ceil(needed / unitsPerPackage));
      if (packagesToMove <= 0) continue;

      resultLots.push({
        lotId: lot.id,
        productId: lot.productId,
        productName: getProductFullName(product),
        lotNumber: lot.lotNumber,
        quantityToMove: packagesToMove,
      });
      fulfilledQuantity += packagesToMove * unitsPerPackage;
      needed -= packagesToMove * unitsPerPackage;
    }

    return { lots: resultLots, fulfilledQuantity };
  };

  // Pré-seleciona lotes da Matriz dos insumos derivados exatamente solicitados (FIFO por validade),
  // respeitando a quantidade pedida em embalagens. Derivados sem saldo ficam de fora (estoquista substitui).
  const suggestLotsForRequestedProducts = (requestedProducts: RepositionRequestedProduct[]): RepositionSuggestedLot[] => {
    const productMap = new Map(products.filter(product => !product.isArchived).map(product => [product.id, product]));
    const usedByLot: Record<string, number> = {};
    const result: RepositionSuggestedLot[] = [];

    for (const requested of requestedProducts) {
      let neededPackages = requested.packages;
      const lotsForProduct = lots
        .filter(lot => lot.kioskId === "matriz" && lot.productId === requested.productId)
        .sort((left, right) => {
          if (!left.expiryDate && !right.expiryDate) return 0;
          if (!left.expiryDate) return 1;
          if (!right.expiryDate) return -1;
          return new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime();
        });

      for (const lot of lotsForProduct) {
        if (neededPackages <= 0) break;
        const product = productMap.get(lot.productId);
        if (!product) continue;
        const available = lot.quantity - (lot.reservedQuantity || 0) - (usedByLot[lot.id] || 0);
        const take = Math.min(available, neededPackages);
        if (take <= 0) continue;

        result.push({
          lotId: lot.id,
          productId: lot.productId,
          productName: getProductFullName(product),
          lotNumber: lot.lotNumber,
          quantityToMove: take,
        });
        usedByLot[lot.id] = (usedByLot[lot.id] || 0) + take;
        neededPackages -= take;
      }
    }

    return result;
  };

  // Converte os lotes anexados (em pacotes) para a quantidade na unidade base do insumo.
  const getFulfilledFromLots = (selectedLots: RepositionSuggestedLot[], baseProductId: string): number => {
    const baseProduct = baseProducts.find((entry) => entry.id === baseProductId);
    if (!baseProduct) return 0;
    return selectedLots.reduce((total, selectedLot) => {
      const product = products.find((entry) => entry.id === selectedLot.productId);
      if (!product) return total;
      const unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);
      return total + selectedLot.quantityToMove * unitsPerPackage;
    }, 0);
  };

  const cdReviewLineRequiresReason = (line: CdReviewLine) => {
    const toSend = Number(line.toSendQuantity || 0);
    const fulfilled = getFulfilledFromLots(line.selectedLots ?? [], line.baseProductId);
    return (
      line.source === "cd" ||
      toSend !== line.requestedQuantity ||
      fulfilled < toSend
    );
  };

  // ─── Workspace de revisão do CD ────────────────────────────────────────────
  // Lotes da Matriz disponíveis para um insumo base (FIFO por validade), com info de pacote.
  const getAvailableMatrixLotsForBase = (baseProductId: string) => {
    const baseProduct = baseProducts.find((b) => b.id === baseProductId);
    if (!baseProduct) return [];
    return lots
      .filter((lot) => {
        if (lot.kioskId !== "matriz") return false;
        const product = products.find((p) => p.id === lot.productId);
        if (!product || product.baseProductId !== baseProductId) return false;
        return lot.quantity - (lot.reservedQuantity || 0) > 0;
      })
      .map((lot) => {
        const product = products.find((p) => p.id === lot.productId)!;
        return {
          lot,
          product,
          productName: getProductFullName(product),
          lotNumber: lot.lotNumber,
          expiryDate: lot.expiryDate ?? null,
          availablePackages: lot.quantity - (lot.reservedQuantity || 0),
          unitsPerPackage: getUnitsPerPackageForProduct(product, baseProduct),
          packageType: product.packageType || "un",
        };
      })
      .sort((a, b) => {
        if (!a.expiryDate && !b.expiryDate) return 0;
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      });
  };

  // Lotes de um insumo base em uma unidade qualquer (com quantidade), FIFO por validade.
  const getKioskLotsForBase = (baseProductId: string, kId: string | null) => {
    if (!kId) return [];
    const baseProduct = baseProducts.find((b) => b.id === baseProductId);
    if (!baseProduct) return [];
    return lots
      .filter((lot) => {
        if (lot.kioskId !== kId) return false;
        const product = products.find((p) => p.id === lot.productId);
        return product?.baseProductId === baseProductId && lot.quantity > 0;
      })
      .map((lot) => {
        const product = products.find((p) => p.id === lot.productId)!;
        return {
          lot,
          productName: getProductFullName(product),
          lotNumber: lot.lotNumber,
          expiryDate: lot.expiryDate ?? null,
          quantity: lot.quantity,
          unitsPerPackage: getUnitsPerPackageForProduct(product, baseProduct),
          packageType: product.packageType || "un",
        };
      })
      .sort((a, b) => {
        if (!a.expiryDate && !b.expiryDate) return 0;
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      });
  };

  // Define a quantidade (em pacotes) de um lote dentro de uma linha de revisão.
  const setLineLotPackages = (
    lineId: string,
    info: { lot: LotEntry; product: Product; productName: string },
    packages: number,
  ) => {
    const qty = Math.max(0, packages);
    setCdReview((current) => {
      if (!current) return current;
      return {
        ...current,
        lines: current.lines.map((line) => {
          if (line.id !== lineId) return line;
          const others = (line.selectedLots ?? []).filter((sl) => sl.lotId !== info.lot.id);
          const next = qty > 0
            ? [
                ...others,
                {
                  lotId: info.lot.id,
                  productId: info.product.id,
                  productName: info.productName,
                  lotNumber: info.lot.lotNumber,
                  quantityToMove: qty,
                },
              ]
            : others;
          return { ...line, selectedLots: next };
        }),
      };
    });
  };

  const getLineStatus = (line: CdReviewLine): "sem_estoque" | "parcial" | "completo" => {
    const toSend = Number(line.toSendQuantity || 0);
    const fulfilled = getFulfilledFromLots(line.selectedLots ?? [], line.baseProductId);
    if (toSend <= 0) return "completo"; // CD optou por não enviar — resolvido
    if (fulfilled >= toSend) return "completo";
    if (fulfilled <= 0 && getAvailableMatrixLotsForBase(line.baseProductId).length === 0) return "sem_estoque";
    return "parcial";
  };

  const handleAcceptAllAsRequested = () => {
    setCdReview((current) => {
      if (!current) return current;
      return {
        ...current,
        lines: current.lines.map((line) => {
          const nextLots = (line.requestedProducts && line.requestedProducts.length > 0)
            ? suggestLotsForRequestedProducts(line.requestedProducts)
            : suggestLotsForBaseProduct(line.baseProductId, line.requestedQuantity).lots;
          return { ...line, selectedLots: nextLots, toSendQuantity: line.requestedQuantity };
        }),
      };
    });
    toast({
      title: "Aceito tudo com estoque disponível",
      description: "Itens preenchidos com os lotes da Matriz onde há saldo.",
    });
  };

  // Remove uma linha da revisão (item solicitado ou incluído pelo CD). Volta a aparecer em "Outros produtos".
  const removeReviewLine = (lineId: string) => {
    setCdReview((current) => current ? ({ ...current, lines: current.lines.filter((l) => l.id !== lineId) }) : current);
    setCdExpandedLineId((id) => (id === lineId ? null : id));
  };

  const buildItemsFromCdReview = (review: CdReviewState): RepositionItem[] => {
    return review.lines
      // Inclui itens com "a enviar", solicitados, OU com lotes anexados (ex.: itens incluídos pelo CD, sem toSend).
      .filter((line) => Number(line.toSendQuantity || 0) > 0 || line.requestedQuantity > 0 || (line.selectedLots?.length ?? 0) > 0)
      .map((line) => {
        const baseProduct = baseProducts.find(entry => entry.id === line.baseProductId);
        if (!baseProduct) {
          throw new Error(`Produto base ${line.productName} não encontrado.`);
        }

        const toSendQuantity = Number(line.toSendQuantity || 0);
        const suggestedLots = line.selectedLots ?? [];
        const fulfilledQuantity = getFulfilledFromLots(suggestedLots, line.baseProductId);

        const hasDivergence = line.source === "cd" || fulfilledQuantity !== line.requestedQuantity;

        return {
          baseProductId: line.baseProductId,
          productName: line.productName,
          // Sem "a enviar" definido (itens do CD), usa o que foi de fato anexado.
          quantityNeeded: toSendQuantity > 0 ? toSendQuantity : fulfilledQuantity,
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

  // Finaliza a revisão pelo workspace: auto-preenche motivo das divergências (o workspace não tem campo de motivo).
  const handleFinalizeWorkspace = async () => {
    if (!cdReview) return;
    const linesWithReasons = cdReview.lines.map((line) => {
      if (!cdReviewLineRequiresReason(line) || line.reason) return line;
      const fulfilled = getFulfilledFromLots(line.selectedLots ?? [], line.baseProductId);
      const toSend = Number(line.toSendQuantity || 0);
      const reason: PartialFulfillmentReason = line.source === "cd"
        ? "Item incluído pelo CD"
        : fulfilled < toSend
          ? "Falta de mercadoria"
          : "Quantidade ajustada por embalagem";
      return { ...line, reason };
    });
    try {
      const items = buildItemsFromCdReview({ request: cdReview.request, lines: linesWithReasons });
      if (!items.some((item) => item.suggestedLots.length > 0)) {
        throw new Error("Anexe ao menos um lote para criar a separação.");
      }
      await createActivityFromReviewedItems(cdReview.request, items);
      delete cdReviewCacheRef.current[cdReview.request.id];
      setCdExpandedLineId(null);
      setCdReview(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao criar atividade",
        description: error.message || "Não foi possível criar a atividade a partir da revisão.",
      });
    }
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
           const reviewRequiresReason = reviewLine ? cdReviewLineRequiresReason(reviewLine) : false;
           const reviewLotCount = reviewLine?.selectedLots?.length ?? 0;
           const reviewRequestedHasStock = reviewLine
             ? reviewLine.requestedProducts.some((rp) => lots.some((lot) => lot.kioskId === "matriz" && lot.productId === rp.productId && (lot.quantity - (lot.reservedQuantity || 0)) > 0))
             : false;
           const reviewShowNoStock = !!reviewLine && reviewLine.requestedProducts.length > 0 && !reviewRequestedHasStock && reviewLotCount === 0;
           // Em revisão, o card mostra o ideal/atual/repor da UNIDADE SOLICITANTE (não os da Matriz).
           const displayCurrentStock = reviewLine ? reviewLine.currentStock : result.currentStock;
           const displayMinimumStock = reviewLine ? reviewLine.minimumStock : result.minimumStock;
           const displayRestockNeeded = reviewLine ? reviewLine.requestedQuantity : result.restockNeeded;
           const displayPercentage = reviewLine
             ? (reviewLine.minimumStock > 0 ? (reviewLine.currentStock / reviewLine.minimumStock) * 100 : null)
             : result.stockPercentage;

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
                <CardDescription>
                  {reviewLine && cdReview
                    ? `${result.baseProduct.unit} · Solicitante: ${cdReview.request.kioskName}`
                    : result.baseProduct.unit}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-grow space-y-3">
                {reviewLine ? (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                    <span className="text-muted-foreground">Estoque na unidade</span>
                    <span className="flex items-center gap-2 font-semibold">
                      {formatNumberDisplay(displayCurrentStock, result.baseProduct.unit)} / {formatNumberDisplay(displayMinimumStock, result.baseProduct.unit)} ideal
                      {displayPercentage !== null && (
                        <span className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold text-white",
                          displayPercentage <= 25 ? "bg-destructive" : displayPercentage < 100 ? "bg-orange-500" : "bg-green-600"
                        )}>
                          {displayPercentage.toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </div>
                ) : (
                <div className="space-y-1.5">
                  <div className="flex justify-between items-end mb-1">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">Atual</span>
                        <span className="text-sm font-semibold">{formatNumberDisplay(displayCurrentStock, result.baseProduct.unit)}</span>
                    </div>
                    <div className="text-right flex flex-col items-end">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-tight">Ideal</span>
                        <span className="text-sm font-semibold text-muted-foreground">{formatNumberDisplay(displayMinimumStock, result.baseProduct.unit)}</span>
                    </div>
                  </div>

                  <div className="relative pt-1">
                     {displayPercentage !== null && (
                         <div className="flex justify-between items-center text-[10px] font-bold mb-1">
                            <span className={cn(
                                "px-1.5 py-0.5 rounded-sm shadow-sm",
                                displayPercentage <= 25 ? "bg-destructive text-white" :
                                displayPercentage < 100 ? "bg-orange-500 text-white" :
                                "bg-green-600 text-white"
                            )}>
                                {displayPercentage.toFixed(0)}% do ideal
                            </span>
                         </div>
                     )}
                     <Progress value={Math.min(100, displayPercentage ?? 0)} indicatorClassName={statusStyle.progress} />
                  </div>
                   {displayRestockNeeded > 0 && (
                      <p className="text-sm font-bold text-destructive pt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Repor: {formatNumberDisplay(displayRestockNeeded, result.baseProduct.unit)}
                      </p>
                  )}
                </div>
                )}
              </CardContent>
              <CardFooter className="pt-2">
                {isMatriz && cdReview && (
                  reviewLine ? (
                    <div className="w-full space-y-2 text-left">
                      {/* Solicitado pela unidade */}
                      <div className="rounded-md border bg-muted/30 p-2">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Solicitado</p>
                        {reviewLine.requestedProducts.length > 0 ? (
                          <ul className="space-y-0.5 text-xs">
                            {reviewLine.requestedProducts.map((rp) => (
                              <li key={rp.productId} className="flex justify-between gap-2">
                                <span className="truncate">{rp.productName}</span>
                                <span className="shrink-0 text-muted-foreground">{rp.packages.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} emb</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-muted-foreground">{formatNumberDisplay(reviewLine.requestedQuantity, reviewLine.unit)}</p>
                        )}
                      </div>

                      {/* Para envio (estoquista) */}
                      <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Para envio (CD)</p>

                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">A enviar</label>
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

                        <div className="space-y-1">
                          {reviewLotCount > 0 ? (
                            reviewLine.selectedLots.map((sl, index) => (
                              <div key={`${sl.lotId}-${index}`} className="flex items-center justify-between gap-2 rounded bg-background px-2 py-1 text-xs">
                                <span className="truncate">{sl.productName}{sl.lotNumber ? ` · Lote ${sl.lotNumber}` : ''}</span>
                                <span className="shrink-0 text-muted-foreground">{sl.quantityToMove.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} emb</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">Nenhum lote anexado.</p>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full justify-start font-normal"
                            onClick={() => setCdLotPickerLine(reviewLine)}
                          >
                            <Package className="mr-2 h-4 w-4 shrink-0" />
                            {reviewLotCount > 0 ? "Trocar / ajustar lote" : "Anexar lote"}
                          </Button>
                        </div>

                        {reviewShowNoStock && (
                          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>Sem estoque no CD do insumo solicitado. Remova (Zerar) ou substitua por outro derivado do mesmo insumo base (Anexar lote).</span>
                          </div>
                        )}

                        {reviewRequiresReason && (
                          <>
                            <Select
                              value={reviewLine.reason}
                              onValueChange={(reason) => updateCdReviewLine(reviewLine.id, { reason: reason as PartialFulfillmentReason })}
                            >
                              <SelectTrigger className="h-9"><SelectValue placeholder="Motivo" /></SelectTrigger>
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
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => updateCdReviewLine(reviewLine.id, { toSendQuantity: 0 })}>Zerar</Button>
                          {reviewLine.source === "cd" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1"
                              onClick={() => setCdReview((current) => current ? ({ ...current, lines: current.lines.filter((entry) => entry.id !== reviewLine.id) }) : current)}
                            >
                              Remover
                            </Button>
                          )}
                        </div>
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

                {!isMatriz && (() => {
                  const itemCount = countCartItemsForBase(result.baseProduct.id);
                  return (
                    <Button
                      variant={itemCount > 0 ? 'secondary' : (result.status === 'repor' ? 'default' : 'outline')}
                      size="sm"
                      className="w-full"
                      onClick={() => setCardModalBaseId(result.baseProduct.id)}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      {itemCount > 0 ? `${itemCount} insumo${itemCount === 1 ? '' : 's'} na solicitação` : 'Adicionar insumo'}
                    </Button>
                  );
                })()}
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
                            {!isMatriz && (() => {
                                const itemCount = countCartItemsForBase(result.baseProduct.id);
                                return (
                                    <TableCell className="text-right">
                                        <Button
                                            variant={itemCount > 0 ? 'secondary' : 'ghost'}
                                            size="sm"
                                            className="h-8 gap-1.5"
                                            onClick={() => setCardModalBaseId(result.baseProduct.id)}
                                        >
                                            <PlusCircle className="h-4 w-4" />
                                            {itemCount > 0 ? itemCount : null}
                                        </Button>
                                    </TableCell>
                                );
                            })()}
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    </div>
  );

  const renderCdReviewPanel = (request: RepositionRequest) => {
    if (!cdReview || cdReview.request.id !== request.id) return null;

    return (
      <div className="mt-4 space-y-4 rounded-lg border bg-muted/20 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="font-semibold">Revisão do CD</h4>
            <p className="text-xs text-muted-foreground">
              Ajuste cada insumo nos cards abaixo (Solicitado × Para envio) e finalize aqui.
            </p>
          </div>
          <Badge variant="secondary">{cdReview.lines.length} item{cdReview.lines.length === 1 ? "" : "s"}</Badge>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Fechar revisão</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Fechar a revisão?</AlertDialogTitle>
                <AlertDialogDescription>
                  Seus ajustes ficam salvos. Você pode reabrir esta solicitação depois e continuar de onde parou.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (cdReview) cdReviewCacheRef.current[cdReview.request.id] = cdReview;
                    setCdReview(null);
                  }}
                >
                  Fechar revisão
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">Cancelar</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancelar a solicitação?</AlertDialogTitle>
                            <AlertDialogDescription>
                              A solicitação de {request.kioskName} será cancelada e não poderá mais ser revisada. Esta ação não pode ser desfeita.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Voltar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => updateRepositionRequest(request.id, { status: "Cancelada" })}>
                              Cancelar solicitação
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      {cdReview?.request.id === request.id ? (
                        <Badge className="self-center">Em revisão</Badge>
                      ) : (
                        <Button size="sm" onClick={() => openCdReview(request)} disabled={!hasRequestedQuantity}>
                          {hasRequestedQuantity ? "Revisar envio" : "Sem itens"}
                        </Button>
                      )}
                    </div>
                  </div>
                  {cdReview?.request.id !== request.id && (
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
                  )}
                  {renderCdReviewPanel(request)}
                </div>
              )})}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Modal aberto pelo card: escolhe os insumos derivados daquele insumo base e define a quantidade.
  const renderCardRequestModal = () => {
    if (!cardModalBaseId) return null;
    const baseProduct = baseProducts.find(b => b.id === cardModalBaseId);
    if (!baseProduct) return null;

    const analysisResult = analysisResults.find(r => r.baseProduct.id === cardModalBaseId);
    const restockNeeded = analysisResult?.restockNeeded ?? 0;
    const available = getDerivadosForBase(cardModalBaseId);

    const selectedRows = cartItems
      .map((cartItem) => {
        const product = products.find(p => p.id === cartItem.productId);
        if (!product || product.baseProductId !== cardModalBaseId) return null;
        const unitsPerPackage = getUnitsPerPackageForProduct(product, baseProduct);
        return {
          productId: cartItem.productId,
          product,
          packages: cartItem.packages,
          baseQty: cartItem.packages * unitsPerPackage,
          packageType: product.packageType || 'un',
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const totalSelected = selectedRows.reduce((sum, row) => sum + row.baseQty, 0);
    const remaining = Math.max(0, restockNeeded - totalSelected);
    const hasInvalid = selectedRows.some(row => !(row.packages > 0));

    const closeModal = () => {
      // Ao fechar, descarta insumos adicionados sem quantidade.
      setCartItems(prev => prev.filter(i => i.packages > 0));
      setCardModalBaseId(null);
    };

    return (
      <Dialog open onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent className="flex max-h-[88vh] max-w-lg flex-col overflow-hidden rounded-2xl p-0">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Solicitar — {baseProduct.name}</DialogTitle>
            <DialogDescription>Escolha os insumos derivados e informe a quantidade.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2 px-5 py-3 text-center text-sm">
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-xs uppercase text-muted-foreground">Necessário</p>
              <p className="font-bold">{formatNumberDisplay(restockNeeded, baseProduct.unit)}</p>
            </div>
            <div className="rounded-xl border bg-muted/30 p-3">
              <p className="text-xs uppercase text-muted-foreground">Selecionado</p>
              <p className="font-bold text-primary">{formatNumberDisplay(totalSelected, baseProduct.unit)}</p>
            </div>
            <div className={cn("rounded-xl border p-3", remaining > 0 ? "border-destructive/20 bg-destructive/5" : "border-green-500/20 bg-green-500/10")}>
              <p className={cn("text-xs uppercase", remaining > 0 ? "text-destructive" : "text-green-700")}>Falta</p>
              <p className={cn("font-bold", remaining > 0 ? "text-destructive" : "text-green-700")}>{formatNumberDisplay(remaining, baseProduct.unit)}</p>
            </div>
          </div>

          <div className="px-5">
            <Select value="" onValueChange={(productId) => addCartItem(productId)}>
              <SelectTrigger>
                <SelectValue placeholder="Adicionar insumo" />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">Todos os derivados já foram adicionados.</div>
                ) : available.map((product) => (
                  <SelectItem key={product.id} value={product.id}>{getProductFullName(product)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
            {selectedRows.length === 0 ? (
              <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                Nenhum insumo adicionado ainda. Use o campo acima.
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {selectedRows.map((row) => (
                  <div key={row.productId} className="flex items-center gap-3 p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {row.product.imageUrl ? (
                        <img src={row.product.imageUrl} alt={getProductFullName(row.product)} className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{getProductFullName(row.product)}</p>
                      <p className="truncate text-xs text-muted-foreground">= {formatNumberDisplay(row.baseQty, baseProduct.unit)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={row.packages || ''}
                        onChange={(event) => updateCartPackages(row.productId, parseFloat(event.target.value) || 0)}
                        onWheel={(event) => (event.target as HTMLElement).blur()}
                        onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); } }}
                        onFocus={(event) => event.target.select()}
                        className={cn("h-9 w-20 text-right font-semibold", row.packages <= 0 && "border-destructive focus-visible:ring-destructive")}
                      />
                      <span className="w-10 text-xs text-muted-foreground">{row.packageType}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeCartItem(row.productId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="flex-col items-stretch gap-2 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            {hasInvalid ? (
              <p className="text-xs font-medium text-destructive">Preencha ou remova o insumo.</p>
            ) : <span className="hidden sm:block" />}
            <Button onClick={closeModal} disabled={hasInvalid}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  // Barra fixa para revisar e enviar toda a solicitação (todos os insumos base).
  const renderRequestFooterBar = () => {
    if (isMatriz || cartItems.length === 0) return null;
    return (
      <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 animate-in slide-in-from-bottom duration-300">
        <div className="flex w-full max-w-3xl items-center justify-between gap-4 rounded-2xl bg-[#1d1d20] p-3 text-white shadow-2xl">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{cartItems.length} insumo{cartItems.length === 1 ? '' : 's'} na solicitação</h3>
              <p className="truncate text-xs text-white/55">Ajuste as quantidades nos cards e envie ao CD.</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setCartItems([])}>Limpar</Button>
            <Button className="bg-[#5147e8] hover:bg-[#4338ca]" onClick={handleSendRequest} disabled={isSending}>
              {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar solicitação
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderCdReviewWorkspace = () => {
    if (!cdReview) return null;
    const request = cdReview.request;
    const lines = cdReview.lines;

    const reviewedBaseIds = new Set(lines.map((l) => l.baseProductId));
    const outros = analysisResults.filter((r) => !reviewedBaseIds.has(r.baseProduct.id));
    const emRevisaoLines = lines.filter((l) => l.source !== "cd");
    const adicionadosLines = lines.filter((l) => l.source === "cd");

    type LineMeta = { line: CdReviewLine; status: "sem_estoque" | "parcial" | "completo"; fulfilled: number; toSend: number };
    const lineMeta: LineMeta[] = lines.map((line) => ({
      line,
      status: getLineStatus(line),
      fulfilled: getFulfilledFromLots(line.selectedLots ?? [], line.baseProductId),
      toSend: Number(line.toSendQuantity || 0),
    }));
    const attention = lineMeta.filter((m) => m.status !== "completo");
    const confirmed = lineMeta.filter((m) => m.status === "completo");
    const progressPct = lineMeta.length > 0 ? Math.round((confirmed.length / lineMeta.length) * 100) : 0;
    const totalToSendBase = lineMeta.reduce((s, m) => s + m.fulfilled, 0);
    const baseUnit = lines[0]?.unit ?? "";
    const hasPending = attention.length > 0;

    const lineDerived = (line: CdReviewLine) => {
      const rp = (line.requestedProducts ?? [])[0];
      return rp ? products.find((p) => p.id === rp.productId) : undefined;
    };

    const renderEmRevisaoCard = (line: CdReviewLine) => {
      const meta = lineMeta.find((m) => m.line.id === line.id)!;
      const derived = lineDerived(line);
      const pct = line.minimumStock > 0 ? Math.round((line.currentStock / line.minimumStock) * 100) : 0;
      const barColor = pct <= 25 ? "bg-destructive" : pct < 100 ? "bg-orange-500" : "bg-green-600";
      const isSelected = cdExpandedLineId === line.id;
      const cdAvailable = getAvailableMatrixLotsForBase(line.baseProductId).reduce((s, al) => s + al.availablePackages * al.unitsPerPackage, 0);
      const cdColor = cdAvailable <= 0 ? "text-destructive" : cdAvailable < line.requestedQuantity ? "text-amber-600" : "text-green-600";
      const rps = line.requestedProducts ?? [];
      const requestedLabel = rps.length > 0
        ? `${rps[0].productName}${rps.length > 1 ? ` +${rps.length - 1}` : ""} · ${formatNumberDisplay(rps.reduce((s, r) => s + r.packages, 0), "emb")}`
        : formatNumberDisplay(line.requestedQuantity, line.unit);
      const sendingNames = Array.from(new Set((line.selectedLots ?? []).map((s) => s.productName)));
      const sendingLabel = meta.status === "sem_estoque"
        ? "Sem estoque"
        : (line.selectedLots?.length ?? 0) > 0
          ? `${sendingNames[0]}${sendingNames.length > 1 ? ` +${sendingNames.length - 1}` : ""} · ${formatNumberDisplay(meta.fulfilled, line.unit)}`
          : Number(line.toSendQuantity || 0) <= 0 ? "Não enviar" : "—";
      const sendingColor = meta.status === "sem_estoque" ? "text-destructive" : meta.status === "completo" ? "text-green-600" : "text-amber-600";
      return (
        <div
          key={line.id}
          role="button"
          tabIndex={0}
          onClick={() => setCdExpandedLineId(line.id)}
          className={cn(
            "flex w-[280px] shrink-0 cursor-pointer flex-col rounded-2xl border bg-card p-3 transition-all",
            isSelected ? "border-primary ring-2 ring-primary/30" : meta.status === "sem_estoque" ? "border-amber-300 bg-amber-50/40" : "border-border hover:border-primary/40",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
              {(() => { const img = derived?.imageUrl ?? getBaseImage(line.baseProductId); return img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-muted-foreground" />; })()}
            </div>
            <div className="flex items-center gap-1">
              {line.source === "cd" ? (
                <Badge className="shrink-0 bg-blue-100 text-blue-700">Adicionado</Badge>
              ) : (
                <Badge className="shrink-0 bg-[#FBEAF0] text-[#993556]">Em revisão</Badge>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeReviewLine(line.id); }}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remover da revisão"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-2 min-w-0">
            <p className="line-clamp-2 text-sm font-semibold leading-tight">{line.productName}</p>
            <p className="truncate text-xs text-muted-foreground">{derived?.brand ?? line.unit}</p>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", barColor)} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{pct}% do ideal na unidade</p>
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1 text-[11px]">
            <span className="text-muted-foreground">Estoque no CD</span>
            <span className={cn("font-semibold", cdColor)}>{formatNumberDisplay(cdAvailable, line.unit)} disp.</span>
          </div>
          <div className="mt-2 space-y-1 text-[11px]">
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">Solicitado</span>
              <span className="truncate text-right font-medium" title={requestedLabel}>{requestedLabel}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-muted-foreground">Enviando</span>
              <span className={cn("truncate text-right font-semibold", sendingColor)} title={sendingLabel}>{sendingLabel}</span>
            </div>
          </div>
        </div>
      );
    };

    const renderOutroCard = (result: AnalysisResult) => {
      const style = getCardStatus(result);
      const pct = result.stockPercentage ?? 0;
      const barColor = pct <= 25 ? "bg-destructive" : pct < 100 ? "bg-orange-500" : "bg-green-600";
      const cdLots = getAvailableMatrixLotsForBase(result.baseProduct.id);
      const cdAvailable = cdLots.reduce((s, al) => s + al.availablePackages * al.unitsPerPackage, 0);
      const lotesOpen = cdOutroLotesId === result.baseProduct.id;
      return (
        <div key={result.baseProduct.id} className="flex w-[280px] shrink-0 flex-col rounded-2xl border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
              {(() => { const img = getBaseImage(result.baseProduct.id); return img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-muted-foreground" />; })()}
            </div>
            <div className="shrink-0">{style.badge}</div>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-tight">{result.baseProduct.name}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", barColor)} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{pct.toFixed(0)}% do ideal na unidade</p>
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1 text-[11px]">
            <span className="text-muted-foreground">Estoque no CD</span>
            <span className={cn("font-semibold", cdAvailable <= 0 ? "text-destructive" : "text-foreground")}>{formatNumberDisplay(cdAvailable, result.baseProduct.unit)} disp.</span>
          </div>

          {cdLots.length > 0 && (
            <div className="mt-2 rounded-md border">
              <button
                type="button"
                onClick={() => setCdOutroLotesId(lotesOpen ? null : result.baseProduct.id)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/40"
              >
                <span>Estoque por lote ({cdLots.length})</span>
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", lotesOpen && "rotate-180")} />
              </button>
              {lotesOpen && (
                <div className="space-y-1 border-t p-2">
                  {cdLots.map((al) => (
                    <div key={al.lot.id} className="rounded bg-muted/40 px-2 py-1 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{al.lotNumber || "—"}</span>
                        <span className="shrink-0 text-muted-foreground">{formatNumberDisplay(al.availablePackages, al.packageType)} disp.</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-muted-foreground">
                        <span>{al.expiryDate ? `vence ${format(parseISO(al.expiryDate), "dd/MM/yy")}` : "sem validade"}</span>
                        <span>1 {al.packageType} = {formatNumberDisplay(al.unitsPerPackage, result.baseProduct.unit)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => addBaseProductToCdReview(result.baseProduct, { currentStock: result.currentStock, minimumStock: result.minimumStock })}
          >
            <PlusCircle className="mr-1.5 h-4 w-4" /> Incluir na revisão
          </Button>
        </div>
      );
    };

    const renderPanelItem = (meta: LineMeta) => {
      const { line, status, fulfilled, toSend } = meta;
      const expanded = cdExpandedLineId === line.id;
      const derived = lineDerived(line);
      const availableLots = getAvailableMatrixLotsForBase(line.baseProductId);
      const requestedNoStock = (line.requestedProducts ?? []).filter((rp) => !availableLots.some((al) => al.product.id === rp.productId));
      const isSubstituting = availableLots.length > 0 && requestedNoStock.length > 0;
      const remaining = Math.max(0, toSend - fulfilled);
      return (
        <div key={line.id} className={cn("rounded-xl border", expanded ? "border-primary/40 bg-primary/5" : "border-border bg-card")}>
          <div role="button" tabIndex={0} onClick={() => setCdExpandedLineId(expanded ? null : line.id)} className="flex w-full cursor-pointer items-start justify-between gap-2 p-3 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {(() => { const img = derived?.imageUrl ?? getBaseImage(line.baseProductId); return img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-muted-foreground" />; })()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{line.productName}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  Solicitado: {formatNumberDisplay(line.requestedQuantity, line.unit)} · Enviando: {formatNumberDisplay(fulfilled, line.unit)}
                  {(line.selectedLots?.length ?? 0) > 0 ? ` · ${line.selectedLots.length} lote(s)` : ""}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {status === "sem_estoque" ? (
                <Badge variant="outline" className="border-destructive/40 text-destructive">! Sem estoque</Badge>
              ) : status === "completo" ? (
                <Badge variant="outline" className="border-green-600/40 text-green-700">✓ Completo</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-400 text-amber-700">~ Parcial</Badge>
              )}
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeReviewLine(line.id); }}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remover da revisão"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {expanded && (
            <div className="space-y-2 border-t p-3">
              {requestedNoStock.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-700">
                  <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Sem estoque do solicitado: {requestedNoStock.map((rp) => rp.productName).join(", ")}</p>
                  <p className="mt-0.5">{isSubstituting ? "Escolha abaixo um substituto do mesmo insumo base para enviar no lugar." : "Não há substituto do mesmo insumo base. Zere o item ou ajuste a quantidade."}</p>
                </div>
              )}
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{isSubstituting ? "Substitutos disponíveis · ajuste os pacotes" : `${availableLots.length} lote(s) · ajuste os pacotes`}</span>
                <button type="button" className="text-destructive hover:underline" onClick={() => updateCdReviewLine(line.id, { selectedLots: [] })}>Zerar tudo</button>
              </div>
              {availableLots.length === 0 ? (
                requestedNoStock.length > 0 ? null : (
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">Sem estoque no CD para este insumo. Zere o item ou ajuste a quantidade a enviar.</p>
                )
              ) : (
                availableLots.map((al) => {
                  const current = (line.selectedLots ?? []).find((sl) => sl.lotId === al.lot.id)?.quantityToMove ?? 0;
                  return (
                    <div key={al.lot.id} className={cn("rounded-lg border p-2", current > 0 ? "border-primary/30 bg-primary/5" : "border-border bg-background")}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold leading-tight">{al.lotNumber || "—"}</p>
                          <p className="text-[11px] leading-tight text-muted-foreground break-words">{al.productName}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {al.expiryDate ? `vence ${format(parseISO(al.expiryDate), "dd/MM/yy")}` : "sem validade"} · {formatNumberDisplay(al.availablePackages, al.packageType)} disp.
                          </p>
                          <p className="text-[11px] font-medium text-muted-foreground/90">
                            1 {al.packageType} = {formatNumberDisplay(al.unitsPerPackage, line.unit)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setLineLotPackages(line.id, al, current - 1)}>–</Button>
                          <Input
                            type="number"
                            min={0}
                            value={current || ""}
                            onChange={(e) => setLineLotPackages(line.id, al, parseFloat(e.target.value) || 0)}
                            onFocus={(e) => e.target.select()}
                            className="h-7 w-14 text-center"
                          />
                          <Button type="button" variant="outline" size="icon" className="h-7 w-7" disabled={current >= al.availablePackages} onClick={() => setLineLotPackages(line.id, al, current + 1)}>+</Button>
                          <span className="w-12 text-[11px] text-muted-foreground">{al.packageType}</span>
                        </div>
                      </div>
                      {current > 0 && (
                        <p className="mt-1 text-right text-[11px] text-muted-foreground">
                          {formatNumberDisplay(current, al.packageType)} = {formatNumberDisplay(current * al.unitsPerPackage, line.unit)}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
              <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                <span className="font-semibold">Total: {formatNumberDisplay(fulfilled, line.unit)}</span>
                {remaining > 0 ? <span className="font-semibold text-amber-700">faltam {formatNumberDisplay(remaining, line.unit)}</span> : <span className="font-semibold text-green-700">completo</span>}
              </div>
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="flex h-[calc(100vh-13rem)] gap-4">
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="mb-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Em revisão <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-primary">{emRevisaoLines.length}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">clique para editar no painel</p>
          </div>
          <div className="flex flex-wrap gap-3">{emRevisaoLines.map(renderEmRevisaoCard)}</div>

          {adicionadosLines.length > 0 && (
            <>
              <div className="mb-3 mt-6">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Adicionados <span className="ml-1 rounded-full bg-blue-100 px-1.5 text-blue-700">{adicionadosLines.length}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">itens incluídos pelo CD</p>
              </div>
              <div className="flex flex-wrap gap-3">{adicionadosLines.map(renderEmRevisaoCard)}</div>
            </>
          )}

          {outros.length > 0 && (
            <>
              <div className="mb-3 mt-6">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Outros produtos <span className="ml-1 rounded-full bg-muted px-1.5">{outros.length}</span>
                </p>
                <p className="text-[11px] text-muted-foreground">adicionar à revisão se necessário</p>
              </div>
              <div className="flex flex-wrap gap-3">{outros.map(renderOutroCard)}</div>
            </>
          )}
        </div>

        <div className="flex w-[380px] shrink-0 flex-col rounded-2xl border bg-card">
          <div className="border-b p-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-green-500" />
              <h3 className="truncate font-semibold">{request.kioskName}</h3>
              <Badge variant="outline" className="ml-auto shrink-0">SOL-{request.id.slice(-4).toUpperCase()}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{request.requestedBy.username} · {format(parseISO(request.createdAt), "dd/MM, HH:mm")}</p>
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className={cn("font-semibold", hasPending ? "text-amber-700" : "text-green-700")}>
                {attention.length === 0 ? "Tudo pronto" : `${attention.length} ${attention.length === 1 ? "item precisa" : "itens precisam"} de atenção`}
              </span>
              <span className="font-semibold">{progressPct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${progressPct}%` }} />
            </div>
            <Button className="mt-3 w-full bg-zinc-900 text-white hover:bg-zinc-800" onClick={handleAcceptAllAsRequested}>
              <Zap className="mr-2 h-4 w-4" /> Aceitar tudo conforme solicitado
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {attention.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-600">● Precisa de atenção ({attention.length})</p>
                {attention.map(renderPanelItem)}
              </div>
            )}
            {confirmed.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-green-600">● Confirmados ({confirmed.length})</p>
                {confirmed.map(renderPanelItem)}
              </div>
            )}
          </div>

          <div className="space-y-2 border-t p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total a enviar</span>
              <span className="font-bold">{formatNumberDisplay(totalToSendBase, baseUnit)} base</span>
            </div>
            {hasPending && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700">⚠ Resolva os itens pendentes antes de finalizar.</p>}
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="outline">Fechar</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Fechar a revisão?</AlertDialogTitle>
                    <AlertDialogDescription>Seus ajustes ficam salvos. Você pode reabrir esta solicitação depois e continuar de onde parou.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { cdReviewCacheRef.current[request.id] = cdReview; setCdExpandedLineId(null); setCdReview(null); }}>Fechar revisão</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button className="flex-1" disabled={hasPending || repositionLoading} onClick={handleFinalizeWorkspace}>
                {repositionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Finalizar revisão e criar separação
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderRequestWorkspace = () => {
    const unitName = (kiosks.find((k) => k.id === kioskId)?.name ?? "Unidade").replace(/^Quiosque\s+/i, "");

    const cartBaseIds = new Set<string>();
    for (const ci of cartItems) {
      const p = products.find((pr) => pr.id === ci.productId);
      if (p?.baseProductId) cartBaseIds.add(p.baseProductId);
    }
    const naSolicitacao = analysisResults.filter((r) => cartBaseIds.has(r.baseProduct.id));
    const catalogo = analysisResults.filter((r) => !cartBaseIds.has(r.baseProduct.id));
    const panelBaseIds = Array.from(new Set([...requestOpenedBases, ...cartBaseIds]));

    const baseEquivForCart = (baseProductId: string) => {
      const bp = baseProducts.find((b) => b.id === baseProductId);
      if (!bp) return 0;
      return cartItems.reduce((sum, ci) => {
        const p = products.find((pr) => pr.id === ci.productId);
        if (p?.baseProductId !== baseProductId) return sum;
        return sum + ci.packages * getUnitsPerPackageForProduct(p, bp);
      }, 0);
    };
    const cartProductCount = (baseProductId: string) =>
      cartItems.filter((ci) => products.find((p) => p.id === ci.productId)?.baseProductId === baseProductId && ci.packages > 0).length;
    const totalBase = Array.from(cartBaseIds).reduce((s, id) => s + baseEquivForCart(id), 0);
    const baseUnitLabel = baseProducts.find((b) => b.id === Array.from(cartBaseIds)[0])?.unit ?? "und. base";

    // Categoria do insumo base (a partir da categoria operacional de um derivado) + busca/filtro do catálogo.
    const getBaseCategory = (baseProductId: string) =>
      products.find((p) => p.baseProductId === baseProductId && !p.isArchived && p.operationalCategoryName)?.operationalCategoryName ?? null;
    const allCategories = Array.from(new Set(analysisResults.map((r) => getBaseCategory(r.baseProduct.id)).filter(Boolean) as string[])).sort();
    const query = requestSearch.trim().toLowerCase();
    const catalogoFiltered = catalogo.filter((r) => {
      const matchesCat = !requestCategory || getBaseCategory(r.baseProduct.id) === requestCategory;
      if (!matchesCat) return false;
      if (!query) return true;
      if (r.baseProduct.name.toLowerCase().includes(query)) return true;
      return products.some((p) => p.baseProductId === r.baseProduct.id && !p.isArchived && getProductFullName(p).toLowerCase().includes(query));
    });

    // Acordeon do estoque da unidade por lote (entre o % e o resumo/botão do card).
    const renderUnitLotesAccordion = (baseProductId: string) => {
      const lotes = getKioskLotsForBase(baseProductId, kioskId);
      if (lotes.length === 0) return null;
      const open = requestLotesId === baseProductId;
      return (
        <div className="mt-2 rounded-md border" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setRequestLotesId(open ? null : baseProductId)}
            className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/40"
          >
            <span>Estoque por lote ({lotes.length})</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="space-y-1 border-t p-2">
              {lotes.map((al) => (
                <div key={al.lot.id} className="rounded bg-muted/40 px-2 py-1 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{al.lotNumber || "—"}</span>
                    <span className="shrink-0 text-muted-foreground">{formatNumberDisplay(al.quantity, al.packageType)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="truncate">{al.productName}</span>
                    <span className="shrink-0">{al.expiryDate ? `vence ${format(parseISO(al.expiryDate), "dd/MM/yy")}` : "sem validade"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    const renderSolicitacaoCard = (result: AnalysisResult) => {
      const baseId = result.baseProduct.id;
      const isSelected = requestSelectedBaseId === baseId;
      const pct = result.stockPercentage ?? 0;
      const barColor = pct <= 25 ? "bg-destructive" : pct < 100 ? "bg-orange-500" : "bg-green-600";
      const img = getBaseImage(baseId);
      return (
        <div
          key={baseId}
          role="button"
          tabIndex={0}
          onClick={() => openRequestBase(baseId)}
          className={cn("flex w-[280px] shrink-0 cursor-pointer flex-col rounded-2xl border bg-card p-3 transition-all", isSelected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40")}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">{img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-muted-foreground" />}</div>
            <div className="flex items-center gap-1">
              <Badge className="shrink-0 bg-[#FBEAF0] text-[#993556]">Na solicitação</Badge>
              <button type="button" onClick={(e) => { e.stopPropagation(); removeRequestBase(baseId); }} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" aria-label="Remover da solicitação"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-tight">{result.baseProduct.name}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", barColor)} style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <p className="mt-1 text-[11px] text-muted-foreground">{pct.toFixed(0)}% do ideal na unidade</p>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Atual: <strong className="text-foreground">{formatNumberDisplay(result.currentStock, result.baseProduct.unit)}</strong></span>
            <span>Ideal: <strong className="text-foreground">{formatNumberDisplay(result.minimumStock, result.baseProduct.unit)}</strong></span>
          </div>
          {renderUnitLotesAccordion(baseId)}
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-primary/5 px-2 py-1 text-[11px]">
            <span className="text-muted-foreground">Solicitando</span>
            <span className="font-semibold text-primary">{cartProductCount(baseId)} deriv. · {formatNumberDisplay(baseEquivForCart(baseId), result.baseProduct.unit)}</span>
          </div>
        </div>
      );
    };

    const renderCatalogoCard = (result: AnalysisResult) => {
      const style = getCardStatus(result);
      const pct = result.stockPercentage ?? 0;
      const barColor = pct <= 25 ? "bg-destructive" : pct < 100 ? "bg-orange-500" : "bg-green-600";
      const img = getBaseImage(result.baseProduct.id);
      const isSelected = requestSelectedBaseId === result.baseProduct.id;
      return (
        <div key={result.baseProduct.id} className={cn("flex w-[280px] shrink-0 flex-col rounded-2xl border bg-card p-3", isSelected ? "border-primary ring-2 ring-primary/30" : "border-border")}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">{img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-muted-foreground" />}</div>
            <div className="shrink-0">{style.badge}</div>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-tight">{result.baseProduct.name}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", barColor)} style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <p className="mt-1 text-[11px] text-muted-foreground">{pct.toFixed(0)}% do ideal na unidade</p>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Atual: <strong className="text-foreground">{formatNumberDisplay(result.currentStock, result.baseProduct.unit)}</strong></span>
            <span>Ideal: <strong className="text-foreground">{formatNumberDisplay(result.minimumStock, result.baseProduct.unit)}</strong></span>
          </div>
          {renderUnitLotesAccordion(result.baseProduct.id)}
          <Button variant={isSelected ? "secondary" : "outline"} size="sm" className="mt-2 w-full" onClick={() => openRequestBase(result.baseProduct.id)}>
            <PlusCircle className="mr-1.5 h-4 w-4" /> Adicionar insumo
          </Button>
        </div>
      );
    };

    const renderRequestPanelItem = (baseProductId: string) => {
      const baseProduct = baseProducts.find((b) => b.id === baseProductId);
      if (!baseProduct) return null;
      const result = analysisResults.find((r) => r.baseProduct.id === baseProductId);
      const restockNeeded = result?.restockNeeded ?? 0;
      const derivados = getDerivadosAllForBase(baseProductId);
      const equiv = baseEquivForCart(baseProductId);
      const remaining = Math.max(0, restockNeeded - equiv);
      const expanded = requestSelectedBaseId === baseProductId;
      const img = getBaseImage(baseProductId);
      return (
        <div key={baseProductId} className={cn("rounded-xl border", expanded ? "border-primary/40 bg-primary/5" : "border-border bg-card")}>
          <div role="button" tabIndex={0} onClick={() => setRequestSelectedBaseId(expanded ? null : baseProductId)} className="flex w-full cursor-pointer items-start justify-between gap-2 p-3 text-left">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">{img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <Package className="h-4 w-4 text-muted-foreground" />}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{baseProduct.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{cartProductCount(baseProductId)} derivado(s) · {formatNumberDisplay(equiv, baseProduct.unit)}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
              <button type="button" onClick={(e) => { e.stopPropagation(); removeRequestBase(baseProductId); }} className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" aria-label="Remover da solicitação"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          {expanded && (
            <div className="space-y-2 border-t p-3">
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-md bg-muted/40 p-1.5"><p className="uppercase text-muted-foreground">Necessário</p><p className="font-semibold">{formatNumberDisplay(restockNeeded, baseProduct.unit)}</p></div>
                <div className="rounded-md bg-muted/40 p-1.5"><p className="uppercase text-muted-foreground">Selecionado</p><p className="font-semibold text-primary">{formatNumberDisplay(equiv, baseProduct.unit)}</p></div>
                <div className={cn("rounded-md p-1.5", remaining > 0 ? "bg-destructive/5" : "bg-green-500/10")}><p className={cn("uppercase", remaining > 0 ? "text-destructive" : "text-green-700")}>Falta</p><p className={cn("font-semibold", remaining > 0 ? "text-destructive" : "text-green-700")}>{formatNumberDisplay(remaining, baseProduct.unit)}</p></div>
              </div>
              {derivados.length === 0 ? (
                <p className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">Nenhum insumo derivado cadastrado para este insumo base.</p>
              ) : (
                derivados.map((product) => {
                  const current = cartItems.find((ci) => ci.productId === product.id)?.packages ?? 0;
                  const upp = getUnitsPerPackageForProduct(product, baseProduct);
                  const packageType = product.packageType || "un";
                  return (
                    <div key={product.id} className={cn("rounded-lg border p-2", current > 0 ? "border-primary/30 bg-primary/5" : "border-border bg-background")}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-muted-foreground" />}</div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold leading-tight break-words">{getProductFullName(product)}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">1 {packageType} = {formatNumberDisplay(upp, baseProduct.unit)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setCartProductPackages(product.id, current - 1)}>–</Button>
                          <Input type="number" min={0} value={current || ""} onChange={(e) => setCartProductPackages(product.id, parseFloat(e.target.value) || 0)} onFocus={(e) => e.target.select()} className="h-7 w-14 text-center" />
                          <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setCartProductPackages(product.id, current + 1)}>+</Button>
                          <span className="w-12 text-[11px] text-muted-foreground">{packageType}</span>
                        </div>
                      </div>
                      {current > 0 && <p className="mt-1 text-right text-[11px] text-muted-foreground">{formatNumberDisplay(current, packageType)} = {formatNumberDisplay(current * upp, baseProduct.unit)}</p>}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="flex h-[calc(100vh-13rem)] gap-4">
        <div className="flex-1 overflow-y-auto pr-1">
          {naSolicitacao.length > 0 && (
            <>
              <div className="mb-3">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Na solicitação <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-primary">{naSolicitacao.length}</span></p>
                <p className="text-[11px] text-muted-foreground">clique para ajustar os derivados</p>
              </div>
              <div className="flex flex-wrap gap-3">{naSolicitacao.map(renderSolicitacaoCard)}</div>
            </>
          )}
          <div className={cn("mb-3", naSolicitacao.length > 0 && "mt-6")}>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Catálogo <span className="ml-1 rounded-full bg-muted px-1.5">{catalogo.length}</span></p>
            <p className="text-[11px] text-muted-foreground">adicione os insumos que a unidade precisa</p>
          </div>

          <div className="mb-3 space-y-2">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar insumo (base ou derivado)..."
                value={requestSearch}
                onChange={(e) => setRequestSearch(e.target.value)}
                className="h-9 pl-9"
              />
            </div>
            {allCategories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setRequestCategory(null)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", !requestCategory ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted")}
                >
                  Todos
                </button>
                {allCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setRequestCategory(requestCategory === cat ? null : cat)}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", requestCategory === cat ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted")}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {catalogoFiltered.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">Nenhum insumo encontrado para o filtro.</div>
          ) : (
            <div className="flex flex-wrap gap-3">{catalogoFiltered.map(renderCatalogoCard)}</div>
          )}
        </div>

        <div className="flex w-[380px] shrink-0 flex-col rounded-2xl border bg-card">
          <div className="border-b p-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <h3 className="truncate font-semibold">Solicitação de reposição</h3>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{unitName} · {cartItems.length} insumo{cartItems.length === 1 ? "" : "s"} na solicitação</p>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {panelBaseIds.length === 0 ? (
              <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">Use “Adicionar insumo” nos cards do catálogo para montar a solicitação.</div>
            ) : (
              panelBaseIds.map(renderRequestPanelItem)
            )}
          </div>
          <div className="space-y-2 border-t p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold">{formatNumberDisplay(totalBase, baseUnitLabel)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setCartItems([]); setRequestOpenedBases([]); setRequestSelectedBaseId(null); }}>Limpar</Button>
              <Button className="flex-1" disabled={cartItems.length === 0 || isSending} onClick={handleSendRequest}>
                {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar solicitação
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (isMatriz && cdReview) {
    return <>{renderCdReviewWorkspace()}</>;
  }

  if (!isMatriz) {
    return <>{renderRequestWorkspace()}</>;
  }

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


      {cdLotPickerLine && (() => {
        const pickerBaseProduct = baseProducts.find((bp) => bp.id === cdLotPickerLine.baseProductId);
        if (!pickerBaseProduct) return null;
        const pickerSuggestion = (cdLotPickerLine.selectedLots ?? [])
          .map((sl) => {
            const lot = lots.find((l) => l.id === sl.lotId);
            return lot ? { lot, quantityToMove: sl.quantityToMove } : null;
          })
          .filter((s): s is { lot: LotEntry; quantityToMove: number } => s !== null);
        const requestKiosk = kiosks.find((k) => k.id === cdReview?.request.kioskId)
          ?? ({ id: cdReview?.request.kioskId ?? "", name: cdReview?.request.kioskName ?? "Unidade" } as Kiosk);
        return (
          <RestockSuggestionModal
            suggestionResult={{
              baseProduct: pickerBaseProduct,
              restockNeeded: Number(cdLotPickerLine.toSendQuantity || cdLotPickerLine.requestedQuantity || 0),
              suggestion: pickerSuggestion,
            }}
            targetKiosk={requestKiosk}
            requestedProducts={cdLotPickerLine.requestedProducts}
            onOpenChange={(open) => { if (!open) setCdLotPickerLine(null); }}
            onStage={(item) => {
              updateCdReviewLine(cdLotPickerLine.id, {
                selectedLots: item.suggestedLots,
              });
              setCdLotPickerLine(null);
            }}
          />
        );
      })()}

      {renderCardRequestModal()}
      {renderRequestFooterBar()}
    </>
  );
}
