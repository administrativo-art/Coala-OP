"use client";

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, Info, ShoppingCart, ReceiptText, Scale, Truck, Building2, Check } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { useOperationalItemCategories } from '@/hooks/use-operational-item-categories';
import { useAuth } from '@/hooks/use-auth';
import { canReceivePurchase } from '@/lib/purchasing-permissions';
import { storage } from '@/lib/firebase';
import { calculateStockQuantityFromPurchase } from '@/lib/purchasing-units';
import {
  getPurchaseItemTreatmentLabel,
  getTreatmentEntryType,
  inferPurchaseItemTreatment,
  purchaseTreatmentCreatesAsset,
  purchaseTreatmentCreatesStock,
  purchaseTreatmentSkipsOperationalEntry,
} from '@/lib/purchasing-item-treatment';
import {
  type PurchaseAssetComponentAction,
  type PurchaseItemTreatment,
  type PurchaseReceipt,
  type PurchaseReceiptItem,
  type PurchaseStockEntryType,
  type Product,
} from '@/types';
import { cn } from '@/lib/utils';
import { buildProductSearchText, matchProductByName, normalizeSearchText } from '@/lib/product-search';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { usePurchaseFinancials } from '@/hooks/use-purchase-financials';

// Combobox pesquisável de insumo (com busca por alias) para o vínculo de estoque.
function StockProductCombobox({
  value,
  options,
  getFullName,
  onSelect,
  disabled,
  invalid,
}: {
  value: string;
  options: Product[];
  getFullName: (product: Product) => string;
  onSelect: (product: Product) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = options.find((p) => p.id === value);
  const tokens = normalizeSearchText(search).split(/\s+/).filter(Boolean);
  const filtered =
    tokens.length === 0
      ? options
      : options.filter((p) => {
          const text = buildProductSearchText(p, getFullName(p));
          return tokens.every((token) => text.includes(token));
        });
  const label = (p: Product) => `${p.baseName}${p.brand ? ` — ${p.brand}` : ''} (${p.packageSize}${p.unit})`;
  const selectedLabel = selected ? label(selected) : '';

  useEffect(() => {
    if (!open) setSearch(selectedLabel);
  }, [open, selectedLabel]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          placeholder="Buscar item..."
          value={search}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setSearch(event.target.value);
            setOpen(true);
          }}
          className={cn('w-full font-normal', invalid && !value && 'border-amber-400')}
        />
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[min(92vw,520px)] p-0" align="start">
        <div className="max-h-[300px] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Nenhum item encontrado.</div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-start rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onSelect(p);
                  setOpen(false);
                  setSearch(label(p));
                }}
              >
                <Check className={cn('mr-2 mt-0.5 h-4 w-4 shrink-0', value === p.id ? 'opacity-100' : 'opacity-0')} />
                <span className="min-w-0 whitespace-normal leading-snug">{label(p)}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface LotDraft {
  _key: string;
  lotCode: string;
  expiryDate?: string;
  indefiniteValidity?: boolean;
  quantity: number | '';
}

interface ItemDraft {
  receiptItemId: string;
  purchaseOrderItemId: string;
  baseItemId: string;
  productId: string;
  itemName?: string;
  operationalCategoryId?: string;
  operationalCategoryName?: string;
  unit: string;
  purchaseUnitType: PurchaseReceiptItem['purchaseUnitType'];
  purchaseUnitLabel: string;
  quantityOrdered: number;
  quantityPreviouslyReceived: number;
  quantityRemaining: number;
  quantityReceived: number;
  lockedFromPreviousReceipt: boolean;
  unitPriceConfirmed: number;
  divergenceReason: string;
  resolutionNotes: string;
  lots: LotDraft[];
  expiryDate?: string;
  entryType: PurchaseStockEntryType;
  itemTreatment: PurchaseItemTreatment;
  linkedAssetId?: string | null;
  linkedAssetCode?: string | null;
  linkedAssetName?: string | null;
  componentAction?: PurchaseAssetComponentAction | null;
  receiptDisposition: 'pending' | 'receive' | 'receive_less' | 'receive_more' | 'exchange_pending' | 'returned';
  selectedForReceipt: boolean;
}

function generateLotCode(baseItemName: string) {
  const prefix = baseItemName.slice(0, 3).toUpperCase().replace(/\s/g, '');
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `${prefix}-${y}${m}-${rand}`;
}

function lotKey() {
  return Math.random().toString(36).slice(2);
}

function fmtQty(value?: number | null) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

interface Props {
  receipt: PurchaseReceipt;
}

export function ReceiptWorkspace({ receipt }: Props) {
  const router = useRouter();
  const { permissions } = useAuth();
  const { fetchReceiptItems, startConference, saveConference, startStockEntry, confirmStockEntry } = usePurchaseReceipts();
  const { orders } = usePurchaseOrders();
  const { financials } = usePurchaseFinancials();
  const { baseProducts } = useBaseProducts();
  const { products, getProductFullName } = useProducts();
  const { activeCategories } = useOperationalItemCategories();
  const { kiosks } = useKiosks();

  const order = useMemo(() => orders.find((o) => o.id === receipt.purchaseOrderId), [orders, receipt.purchaseOrderId]);
  const financial = useMemo(() => financials.find((f) => f.purchaseOrderId === receipt.purchaseOrderId), [financials, receipt.purchaseOrderId]);

  const [receiptItems, setReceiptItems] = useState<PurchaseReceiptItem[]>([]);
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [destinationKioskId, setDestinationKioskId] = useState('');
  const [notes, setNotes] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofDescription, setProofDescription] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);

  const isImmediate = receipt.receiptMode === 'immediate_pickup';
  const isAwaitingDelivery = receipt.status === 'awaiting_delivery';
  const isPartiallyStocked = receipt.status === 'partially_stocked';
  const isInConference = receipt.status === 'in_conference' || isPartiallyStocked;
  const isAwaitingStock = receipt.status === 'awaiting_stock';
  const isInStockEntry =
    receipt.status === 'in_stock_entry' ||
    (isImmediate && receipt.status === 'awaiting_stock');
  const isDone = receipt.status === 'stocked' || receipt.status === 'stocked_with_divergence' || receipt.status === 'cancelled';
  const canReceive = canReceivePurchase(permissions);

  const fmt = (value?: number | null) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const FINANCIAL_STATUS_LABELS: Record<string, string> = {
    forecasted: 'Previsto',
    confirmed: 'Confirmado',
    divergent: 'Divergente',
    paid: 'Pago',
    cancelled: 'Cancelado',
  };

  const PAYMENT_LABELS: Record<string, string> = {
    pix: 'Pix',
    card_credit: 'Cartão de crédito',
    card_debit: 'Cartão de débito',
    cash: 'Dinheiro',
    boleto: 'Boleto',
    term: 'A prazo',
  };

  const goodsGrossSubtotal = useMemo(() => {
    // receipt.totalEstimated may be undefined for receipts created before this field was populated
    return receipt.totalEstimated || order?.totalEstimated || 0;
  }, [order?.totalEstimated, receipt.totalEstimated]);

  const effectiveOrderTotal = useMemo(() => {
    return (goodsGrossSubtotal || 0) + (order?.deliveryFee || 0);
  }, [goodsGrossSubtotal, order?.deliveryFee]);

  useEffect(() => {
    fetchReceiptItems(receipt.id).then((items) => {
      setReceiptItems(items);
      setNotes(receipt.notes ?? '');
      setProofDescription(receipt.receiptProofDescription ?? '');
      setDrafts(
        items
          .filter((item) => {
            if (receipt.status === 'partially_stocked') return item.status !== 'cancelled';
            if (isInStockEntry) return Number(item.quantityReceived ?? 0) > 0 && item.status !== 'pending';
            return true;
          })
          .map((item) => {
            const base = baseProducts.find((bp) => bp.id === item.baseItemId);
            const itemTreatment = inferPurchaseItemTreatment(item);
            const entryType = getTreatmentEntryType(itemTreatment);
            const quantityPreviouslyReceived = Number(item.quantityReceived ?? 0);
            const quantityPendingStockEntry = Number(item.quantityPendingStockEntry ?? 0);
            const quantityRemaining = Math.max(Number(item.quantityOrdered ?? 0) - quantityPreviouslyReceived, 0);
            const lockedFromPreviousReceipt = isPartiallyStocked && quantityRemaining <= 0 && quantityPreviouslyReceived > 0;
            const remainingQuantity =
              isInStockEntry
                ? (quantityPendingStockEntry > 0 ? quantityPendingStockEntry : quantityPreviouslyReceived)
                : isPartiallyStocked
                ? quantityRemaining
                : (quantityPreviouslyReceived > 0 ? quantityPreviouslyReceived : item.quantityOrdered);
            const shouldPreseedLot =
              isInStockEntry &&
              remainingQuantity > 0 &&
              purchaseTreatmentCreatesStock(itemTreatment);
            // Quando o item ainda não tem insumo vinculado, sugere pelo nome/alias.
            const needsStockProductLink =
              isInStockEntry && purchaseTreatmentCreatesStock(itemTreatment) && !item.productId;
            const stockCandidates = needsStockProductLink
              ? (item.baseItemId
                  ? products.filter((p) => p.baseProductId === item.baseItemId && !p.isArchived)
                  : products.filter((p) => !p.isArchived))
              : [];
            const suggestedProduct = needsStockProductLink
              ? matchProductByName(item.itemName, stockCandidates, getProductFullName)
              : undefined;
            return {
              receiptItemId: item.id,
              purchaseOrderItemId: item.purchaseOrderItemId,
              baseItemId: item.baseItemId || suggestedProduct?.baseProductId || '',
              productId: item.productId || suggestedProduct?.id || '',
              itemName: item.itemName ?? undefined,
              operationalCategoryId: item.operationalCategoryId,
              operationalCategoryName: item.operationalCategoryName,
              unit: item.unit || item.purchaseUnitLabel || base?.unit || '',
              purchaseUnitType: item.purchaseUnitType ?? 'content',
              purchaseUnitLabel: item.purchaseUnitLabel || item.unit || base?.unit || '',
              quantityOrdered: item.quantityOrdered,
              quantityPreviouslyReceived,
              quantityRemaining,
              quantityReceived: remainingQuantity,
              lockedFromPreviousReceipt,
              unitPriceConfirmed: item.unitPriceConfirmed || item.unitPriceOrdered,
              divergenceReason: '',
              resolutionNotes: item.resolutionNotes ?? '',
              expiryDate: '',
              entryType,
              itemTreatment,
              linkedAssetId: item.linkedAssetId ?? null,
              linkedAssetCode: item.linkedAssetCode ?? null,
              linkedAssetName: item.linkedAssetName ?? null,
              componentAction: item.componentAction ?? null,
              receiptDisposition: item.receiptDisposition ?? 'receive',
              selectedForReceipt: lockedFromPreviousReceipt ? false : item.receiptDisposition !== 'pending',
              lots: shouldPreseedLot
                ? [
                    {
                      _key: lotKey(),
                      lotCode: '',
                      expiryDate: '',
                      indefiniteValidity: false,
                      quantity: remainingQuantity,
                    },
                  ]
                : [],
            };
          }),
      );
      setLoadingItems(false);
    });
  }, [baseProducts, products, getProductFullName, fetchReceiptItems, isInStockEntry, isPartiallyStocked, receipt.id, receipt.notes, receipt.receiptProofDescription, receipt.status]);

  const updateDraft = (idx: number, patch: Partial<ItemDraft>) => {
    setDrafts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const addLot = (idx: number) => {
    setDrafts((prev) => {
      const next = [...prev];
      const base = baseProducts.find((bp) => bp.id === next[idx].baseItemId);
      next[idx] = {
        ...next[idx],
        lots: [
          ...next[idx].lots,
          { _key: lotKey(), lotCode: generateLotCode(base?.name ?? 'INS'), expiryDate: '', indefiniteValidity: false, quantity: '' },
        ],
      };
      return next;
    });
  };

  const removeLot = (itemIdx: number, lotKey: string) => {
    setDrafts((prev) => {
      const next = [...prev];
      next[itemIdx] = {
        ...next[itemIdx],
        lots: next[itemIdx].lots.filter((l) => l._key !== lotKey),
      };
      return next;
    });
  };

  const updateLot = (itemIdx: number, lotKey: string, patch: Partial<LotDraft>) => {
    setDrafts((prev) => {
      const next = [...prev];
      next[itemIdx] = {
        ...next[itemIdx],
        lots: next[itemIdx].lots.map((l) => (l._key === lotKey ? { ...l, ...patch } : l)),
      };
      return next;
    });
  };

  const lotsValid = useMemo(
    () =>
      drafts.every((d) => {
        if (!d.selectedForReceipt) return true;
        if (purchaseTreatmentCreatesAsset(d.itemTreatment) || purchaseTreatmentSkipsOperationalEntry(d.itemTreatment)) {
          return true;
        }
        const lotSum = d.lots.reduce((s, l) => s + (l.quantity || 0), 0);
        return Math.abs(lotSum - d.quantityReceived) < 0.001;
      }),
    [drafts],
  );

  const requiresStockDestination = useMemo(
    () =>
      drafts.some(
        (d) =>
          d.selectedForReceipt &&
          d.quantityReceived > 0 &&
          !purchaseTreatmentSkipsOperationalEntry(d.itemTreatment),
      ),
    [drafts],
  );

  const immediateValid = useMemo(
    () =>
      !isImmediate ||
      drafts.every(
        (d) =>
          !d.selectedForReceipt ||
          d.quantityReceived >= 0 &&
          d.unitPriceConfirmed > 0,
      ),
    [drafts, isImmediate],
  );

  const hasAnyReceived = useMemo(
    () => drafts.some((d) => !d.lockedFromPreviousReceipt && d.selectedForReceipt && d.receiptDisposition !== 'pending' && d.quantityReceived > 0),
    [drafts],
  );

  const selectedDraftsValid = useMemo(
    () =>
      drafts.every((d) => {
        if (d.lockedFromPreviousReceipt) return true;
        if (!d.selectedForReceipt) return true;
        if (d.unitPriceConfirmed <= 0 || d.quantityReceived < 0) return false;
        if (d.receiptDisposition === 'receive_less') {
          return d.quantityReceived < d.quantityRemaining && !!d.resolutionNotes.trim();
        }
        if (d.receiptDisposition === 'receive_more') return d.quantityReceived > d.quantityRemaining;
        return true;
      }),
    [drafts],
  );

  const canSaveConference =
    canReceive &&
    isInConference &&
    hasAnyReceived &&
    selectedDraftsValid;

  const canConfirmStock =
    canReceive &&
    isInStockEntry &&
    (!requiresStockDestination || !!destinationKioskId) &&
    hasAnyReceived &&
    lotsValid &&
    immediateValid &&
    drafts.every((d) => {
      if (d.quantityReceived <= 0) return true;
      if (!d.selectedForReceipt) return true;
      if (purchaseTreatmentCreatesAsset(d.itemTreatment) || purchaseTreatmentSkipsOperationalEntry(d.itemTreatment)) {
        return d.quantityReceived > 0;
      }
      if (!d.productId) return false;
      const base = baseProducts.find((bp) => bp.id === d.baseItemId);
      const product = products.find((p) => p.id === d.productId);
      if (!base || !product) return false;
      return calculateStockQuantityFromPurchase(
        d.quantityReceived,
        product,
        product,
        base,
        d.purchaseUnitType,
      ).ok;
    });
  const selectedDestinationKiosk = kiosks.find((k) => k.id === destinationKioskId);

  const handleStartConference = async () => {
    setStarting(true);
    try {
      await startConference(receipt.id);
    } finally {
      setStarting(false);
    }
  };

  const handleSaveConference = async () => {
    if (!canSaveConference) return;
    setConfirming(true);
    try {
      let receiptProofUrl: string | undefined;
      if (proofFile) {
        const extension = proofFile.name.split('.').pop() || 'bin';
        const storageRef = ref(
          storage,
          `purchase_receipts/${receipt.id}/${Date.now()}.${extension}`,
        );
        const snapshot = await uploadBytes(storageRef, proofFile);
        receiptProofUrl = await getDownloadURL(snapshot.ref);
      }
      await saveConference(receipt.id, {
        notes,
        receiptProofUrl,
        receiptProofDescription: proofDescription || undefined,
        items: drafts.filter((d) => !d.lockedFromPreviousReceipt).map((d) => ({
          receiptItemId: d.receiptItemId,
          purchaseOrderItemId: d.purchaseOrderItemId,
          baseItemId: d.baseItemId,
          itemName: d.itemName,
          unit: d.unit,
          purchaseUnitType: d.purchaseUnitType,
          purchaseUnitLabel: d.purchaseUnitLabel,
          quantityReceived: d.quantityReceived,
          unitPriceConfirmed: d.unitPriceConfirmed,
          divergenceReason: d.divergenceReason || undefined,
          resolutionNotes: d.resolutionNotes || undefined,
          receiptDisposition: d.selectedForReceipt ? d.receiptDisposition : 'pending',
          itemTreatment: d.itemTreatment,
          linkedAssetId: d.linkedAssetId ?? null,
          linkedAssetCode: d.linkedAssetCode ?? null,
          linkedAssetName: d.linkedAssetName ?? null,
          componentAction: d.componentAction ?? null,
        })),
      });
    } finally {
      setConfirming(false);
    }
  };

  const handleStartStockEntry = async () => {
    setStarting(true);
    try {
      await startStockEntry(receipt.id);
    } finally {
      setStarting(false);
    }
  };

  const handleConfirmStockEntry = async () => {
    if (!canConfirmStock) return;
    setConfirming(true);
    try {
      let receiptProofUrl: string | undefined;
      if (proofFile) {
        const extension = proofFile.name.split('.').pop() || 'bin';
        const storageRef = ref(
          storage,
          `purchase_receipts/${receipt.id}/${Date.now()}.${extension}`,
        );
        const snapshot = await uploadBytes(storageRef, proofFile);
        receiptProofUrl = await getDownloadURL(snapshot.ref);
      }
      await confirmStockEntry(receipt.id, {
        destinationKioskId,
        destinationKioskName: selectedDestinationKiosk?.name ?? destinationKioskId,
        notes,
        receiptProofUrl,
        receiptProofDescription: proofDescription || undefined,
        items: drafts
          .filter((d) => d.selectedForReceipt && d.quantityReceived > 0)
          .map((d) => ({
          ...(() => {
            const product = products.find((p) => p.id === d.productId);
            return { productName: product?.baseName ?? d.itemName ?? d.baseItemId };
          })(),
          receiptItemId: d.receiptItemId,
          purchaseOrderItemId: d.purchaseOrderItemId,
          baseItemId: d.baseItemId,
          itemName: d.itemName,
          operationalCategoryId: d.operationalCategoryId,
          operationalCategoryName: d.operationalCategoryName,
          itemDestination: d.entryType,
          productId: d.productId,
          entryType: d.entryType,
          itemTreatment: d.itemTreatment,
          linkedAssetId: d.linkedAssetId ?? null,
          linkedAssetCode: d.linkedAssetCode ?? null,
          linkedAssetName: d.linkedAssetName ?? null,
          componentAction: d.componentAction ?? null,
          quantityReceived: d.quantityReceived,
          purchaseUnitType: d.purchaseUnitType,
          purchaseUnitLabel: d.purchaseUnitLabel,
          lots: d.lots.map(({ _key, indefiniteValidity, expiryDate, quantity, ...rest }) => ({
            ...rest,
            quantity: quantity || 0,
            ...(indefiniteValidity ? {} : { expiryDate }),
          })),
        })),
      });
      router.push(`/dashboard/purchasing/orders/${receipt.purchaseOrderId}`);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="rounded-2xl border bg-card p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-3xl font-bold">
                {receipt.supplierName}
              </h1>
              <Badge variant={receipt.status === 'cancelled' ? 'destructive' : isDone ? 'default' : 'secondary'}>
                {isAwaitingDelivery
                  ? 'Aguardando recebimento'
                  : isInConference
                  ? 'Em conferência'
                  : isAwaitingStock
                  ? 'Aguardando estoque'
                  : isInStockEntry
                  ? 'Entrada no estoque'
                  : 'Concluído'}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {isImmediate ? 'Retirada imediata' : 'Entrega futura'}
              </Badge>
              {financial && (
                <Badge variant="outline" className="text-xs">
                  Financeiro: {FINANCIAL_STATUS_LABELS[financial.status] || financial.status}
                </Badge>
              )}
            </div>

            <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
              {receipt.createdAt && (
                <span>Criado em {format(parseISO(receipt.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
              )}
              {order?.paymentDueDate && (
                <span>
                  {order.paymentMethod === 'card_credit' || order.paymentMethod === 'card_debit' ? 'Data da compra' : 'Vencimento'}:{' '}
                  {format(parseISO(order.paymentDueDate), 'dd/MM/yyyy')}
                </span>
              )}
              {receipt.expectedDate && (
                <span>Previsão: {format(parseISO(receipt.expectedDate), 'dd/MM/yyyy')}</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Mercadorias</p>
            <p className="mt-1 text-2xl font-semibold">{fmt(goodsGrossSubtotal)}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Frete</p>
            <p className="mt-1 text-2xl font-semibold">{fmt(order?.deliveryFee || 0)}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total do pedido</p>
            <p className="mt-1 text-2xl font-semibold">{fmt(effectiveOrderTotal)}</p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Situação financeira</p>
            <p className="mt-1 text-lg font-semibold">
              {financial ? FINANCIAL_STATUS_LABELS[financial.status] || financial.status : 'Aguardando'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.4fr)_minmax(340px,1fr)] gap-6 items-start">
        <div className="space-y-6">
          {isInStockEntry && requiresStockDestination && (
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">Destino do estoque</h2>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-tight">Quiosque de destino</Label>
                  <Select value={destinationKioskId} onValueChange={setDestinationKioskId}>
                    <SelectTrigger className={!destinationKioskId ? 'border-amber-400' : ''}>
                      <SelectValue placeholder="Selecione o quiosque..." />
                    </SelectTrigger>
                    <SelectContent>
                      {kiosks.map((k) => (
                        <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Badge variant={destinationKioskId ? 'secondary' : 'outline'} className={!destinationKioskId ? 'border-amber-400 text-amber-600' : ''}>
                  {destinationKioskId ? 'Destino definido' : 'Obrigatório'}
                </Badge>
              </div>
              {!destinationKioskId && (
                <p className="text-xs text-amber-600">Selecione o destino antes de confirmar a entrada no estoque.</p>
              )}
            </div>
          )}

          {/* Main items section */}
          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-semibold">Itens do pedido</h2>
              </div>
              <span className="text-sm text-muted-foreground">{drafts.length} item(ns)</span>
            </div>

            {loadingItems ? (
              <div className="p-5 space-y-3">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <div className="divide-y">
                {drafts.map((draft, idx) => {
                  const base = baseProducts.find((bp) => bp.id === draft.baseItemId);
                  // Com Produto Base, restringe aos insumos daquele base; sem base
                  // (item de texto livre), permite buscar em todos os insumos.
                  const variantOptions = draft.baseItemId
                    ? products.filter((p) => p.baseProductId === draft.baseItemId && !p.isArchived)
                    : products.filter((p) => !p.isArchived);
                  const selectedStockProduct = products.find((p) => p.id === draft.productId);
                  const displayName =
                    (selectedStockProduct ? getProductFullName(selectedStockProduct) : '') ||
                    draft.itemName ||
                    base?.name ||
                    draft.baseItemId;
                  const isAssetEntry = purchaseTreatmentCreatesAsset(draft.itemTreatment);
                  const createsStockEntry = purchaseTreatmentCreatesStock(draft.itemTreatment);
                  const skipsOperationalEntry = purchaseTreatmentSkipsOperationalEntry(draft.itemTreatment);
                  const lotSum = draft.lots.reduce((s, l) => s + (l.quantity || 0), 0);
                  const lotValid = isAssetEntry || skipsOperationalEntry || Math.abs(lotSum - draft.quantityReceived) < 0.001;
                  const receivesQuantity =
                    draft.selectedForReceipt &&
                    (draft.receiptDisposition === 'receive' ||
                      draft.receiptDisposition === 'receive_less' ||
                      draft.receiptDisposition === 'receive_more');
                  const isNonStockDisposition = !receivesQuantity;
                  const hasDivergence =
                    draft.selectedForReceipt &&
                    (draft.receiptDisposition !== 'receive' ||
                      Math.abs((draft.quantityPreviouslyReceived + draft.quantityReceived) - draft.quantityOrdered) > 0.001 ||
                      !!draft.divergenceReason ||
                      !!draft.resolutionNotes);
                  const stockEntryIssues = [
                    isInStockEntry && createsStockEntry && !draft.productId ? 'Item não selecionado para entrada no estoque' : null,
                    isInStockEntry && createsStockEntry && !lotValid ? `Lotes somam ${fmtQty(lotSum)} de ${fmtQty(draft.quantityReceived)}` : null,
                  ].filter((reason): reason is string => !!reason);
                  const issueReasons = [
                    draft.receiptDisposition === 'receive_less' ? 'Recebimento a menos' : null,
                    draft.receiptDisposition === 'receive_more' ? 'Recebimento a mais' : null,
                    draft.receiptDisposition === 'exchange_pending' ? 'Troca pendente' : null,
                    draft.receiptDisposition === 'returned' ? 'Item devolvido' : null,
                    Math.abs((draft.quantityPreviouslyReceived + draft.quantityReceived) - draft.quantityOrdered) > 0.001
                      ? `Quantidade total ficará em ${fmtQty(draft.quantityPreviouslyReceived + draft.quantityReceived)} de ${fmtQty(draft.quantityOrdered)} ${draft.purchaseUnitLabel}`
                      : null,
                    draft.divergenceReason.trim() ? draft.divergenceReason.trim() : null,
                    draft.resolutionNotes.trim() ? draft.resolutionNotes.trim() : null,
                    ...stockEntryIssues,
                  ].filter((reason): reason is string => !!reason);
                  const hasItemIssue = hasDivergence || stockEntryIssues.length > 0;
                  
                  const isReadonly = isAwaitingDelivery || isDone;
                  const isDraftReadonly = isReadonly || draft.lockedFromPreviousReceipt;

                  return (
                    <div key={draft.receiptItemId} className={cn(
                      "px-5 py-5 space-y-4",
                      !draft.selectedForReceipt && 'bg-muted/20',
                      hasItemIssue && 'bg-amber-50/30 dark:bg-amber-950/10'
                    )}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          {isInConference && (
                            <Checkbox
                              checked={draft.selectedForReceipt}
                              disabled={isDraftReadonly}
                              onCheckedChange={(checked) => {
                                const selected = checked === true;
                                updateDraft(idx, {
                                  selectedForReceipt: selected,
                                  receiptDisposition: selected ? 'receive' : 'pending',
                                  quantityReceived: selected ? draft.quantityRemaining : 0,
                                  resolutionNotes: selected ? draft.resolutionNotes : '',
                                  divergenceReason: selected ? draft.divergenceReason : '',
                                  lots: draft.lots.map((lot) => ({
                                    ...lot,
                                    quantity: selected ? draft.quantityRemaining : 0,
                                  })),
                                });
                              }}
                              className="mt-3"
                            />
                          )}
                          {selectedStockProduct?.imageUrl && (
                            <Image
                              src={selectedStockProduct.imageUrl}
                              alt={displayName}
                              width={48}
                              height={48}
                              className="h-12 w-12 shrink-0 rounded-md border object-cover"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-lg">{displayName}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <span>Pedido: {draft.quantityOrdered} {draft.purchaseUnitLabel} × {fmt(draft.unitPriceConfirmed)}</span>
                              {draft.quantityPreviouslyReceived > 0 && (
                                <>
                                  <span>•</span>
                                  <span>Recebido: {fmtQty(draft.quantityPreviouslyReceived)} / {fmtQty(draft.quantityOrdered)} {draft.purchaseUnitLabel}</span>
                                </>
                              )}
                              {base && (
                                <>
                                  <span>•</span>
                                  <span className="text-[11px] bg-muted px-1.5 py-0.5 rounded">
                                    Insumo base: {base.name}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        {draft.lockedFromPreviousReceipt ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-300 shrink-0">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Já recebido
                          </Badge>
                        ) : !draft.selectedForReceipt && isInConference ? (
                          <Badge variant="outline" className="text-muted-foreground shrink-0">
                            Pendente
                          </Badge>
                        ) : hasItemIssue && (
                          <Badge variant="outline" className="text-amber-600 border-amber-400 shrink-0">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            {hasDivergence ? 'Divergência' : 'Pendência'}
                          </Badge>
                        )}
                      </div>
                      {hasItemIssue && issueReasons.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                          <div className="font-medium">{hasDivergence ? 'Motivo da divergência' : 'Pendência da entrada'}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {issueReasons.map((reason) => (
                              <span key={reason} className="rounded-full bg-background/80 px-2 py-0.5">
                                {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {isInStockEntry && !skipsOperationalEntry && (
                          <div className="space-y-1">
                            <Label className="text-xs">Categoria do item</Label>
                            <Select
                              value={draft.operationalCategoryId}
                              onValueChange={(value) => {
                                const category = activeCategories.find((entry) => entry.id === value);
                                const entryType = (category?.destination ?? 'stock') as PurchaseStockEntryType;
                                updateDraft(idx, {
                                  operationalCategoryId: category?.id,
                                  operationalCategoryName: category?.name,
                                  entryType,
                                  itemTreatment: entryType,
                                });
                              }}
                            >
                              <SelectTrigger disabled={isDraftReadonly}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {activeCategories.map((category) => (
                                  <SelectItem key={category.id} value={category.id}>
                                    {category.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {isInConference && (
                          <div className="space-y-1">
                            <Label className="text-xs">Tratativa</Label>
                            <Select
                              value={draft.receiptDisposition}
                              onValueChange={(value: ItemDraft['receiptDisposition']) => {
                                const nextQuantity =
                                  value === 'receive'
                                    ? draft.quantityRemaining
                                    : value === 'receive_less'
                                    ? Math.min(draft.quantityReceived, draft.quantityRemaining)
                                    : value === 'receive_more'
                                    ? Math.max(draft.quantityReceived, draft.quantityRemaining)
                                    : 0;
                                updateDraft(idx, {
                                  receiptDisposition: value,
                                  selectedForReceipt: value !== 'pending',
                                  quantityReceived: nextQuantity,
                                  lots: draft.lots.map((lot) => ({ ...lot, quantity: nextQuantity > 0 ? lot.quantity : 0 })),
                                });
                              }}
                            >
                              <SelectTrigger disabled={isDraftReadonly || !draft.selectedForReceipt}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="receive">Receber</SelectItem>
                                <SelectItem value="receive_less">Recebimento a menos</SelectItem>
                                <SelectItem value="receive_more">Recebimento a mais</SelectItem>
                                <SelectItem value="exchange_pending">Troca pendente</SelectItem>
                                <SelectItem value="returned">Devolvido</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="space-y-1">
                          <Label className="text-xs">Qtd. recebida</Label>
                          <Input
                            type="number"
                            step="0.001"
                            value={draft.quantityReceived}
                            disabled={isDraftReadonly || !draft.selectedForReceipt || isNonStockDisposition || isInStockEntry}
                            onChange={(e) => updateDraft(idx, { quantityReceived: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Preço unit. (R$)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={draft.unitPriceConfirmed}
                            disabled={isDraftReadonly || !draft.selectedForReceipt || isNonStockDisposition || isInStockEntry}
                            onChange={(e) => updateDraft(idx, { unitPriceConfirmed: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                        {isInStockEntry && createsStockEntry && (
                          <div className="col-span-2 space-y-1 sm:col-span-3">
                            <Label className="text-xs">Item</Label>
                            {isDraftReadonly ? (
                              <Input
                                value={selectedStockProduct ? `${selectedStockProduct.baseName} (${selectedStockProduct.packageSize}${selectedStockProduct.unit})` : '—'}
                                readOnly
                                disabled
                                className="bg-muted font-medium"
                              />
                            ) : (
                              <StockProductCombobox
                                value={draft.productId}
                                options={variantOptions}
                                getFullName={getProductFullName}
                                invalid={!draft.productId}
                                onSelect={(p) => updateDraft(idx, { productId: p.id, baseItemId: draft.baseItemId || p.baseProductId || '' })}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {isInConference && draft.receiptDisposition === 'receive_less' && draft.selectedForReceipt && (
                        <div className="space-y-1">
                          <Label className="text-xs">Acompanhamento / resolução</Label>
                          <Textarea
                            rows={3}
                            placeholder="Informe como a falta será resolvida..."
                            value={draft.resolutionNotes}
                            disabled={isReadonly}
                            onChange={(e) => updateDraft(idx, { resolutionNotes: e.target.value })}
                          />
                          {!draft.resolutionNotes.trim() && (
                            <p className="text-xs text-amber-600">Obrigatório para recebimento a menos.</p>
                          )}
                        </div>
                      )}

                      {hasDivergence && draft.receiptDisposition !== 'receive_less' && (
                        <div className="space-y-1">
                          <Label className="text-xs">Motivo da divergência</Label>
                          <Input
                            placeholder="Motivo..."
                            value={draft.divergenceReason}
                            disabled={isReadonly}
                            onChange={(e) => updateDraft(idx, { divergenceReason: e.target.value })}
                          />
                        </div>
                      )}

                      {isInStockEntry && isAssetEntry && (
                        <div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
                          A confirmação criará {draft.quantityReceived} patrimônio(s) unitário(s), com código interno e QR Code. Nenhum lote de estoque será criado para este item.
                        </div>
                      )}

                      {isInStockEntry && skipsOperationalEntry && (
                        <div className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground">
                          Tratamento: <span className="font-medium text-foreground">{getPurchaseItemTreatmentLabel(draft.itemTreatment)}</span>. Este item será finalizado como custo/registro de compra, sem criar lote de estoque e sem gerar patrimônio novo.
                          {draft.linkedAssetName ? ` Patrimônio vinculado: ${draft.linkedAssetCode ? `${draft.linkedAssetCode} - ` : ''}${draft.linkedAssetName}.` : ''}
                        </div>
                      )}

                      {isInStockEntry && createsStockEntry && (
                        <div className="space-y-3 pt-2">
                           <div className="flex items-center justify-between">
                            <Label className="text-xs font-medium">Lotes ({fmtQty(lotSum)} / {fmtQty(draft.quantityReceived)})</Label>
                            {!isReadonly && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => addLot(idx)} className="h-7 text-xs">
                                <Plus className="mr-1 h-3 w-3" /> Lote
                              </Button>
                            )}
                          </div>
                          <div className="space-y-2">
                            {draft.lots.map((lot) => (
                              <div key={lot._key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_150px_140px_auto] sm:items-end">
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Cód. Lote</Label>
                                  <Input value={lot.lotCode} placeholder="Informe" disabled={isReadonly} onChange={(e) => updateLot(idx, lot._key, { lotCode: e.target.value })} className="h-8 text-sm" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Qtd.</Label>
                                  <Input type="number" value={lot.quantity} placeholder="0" disabled={isReadonly} onChange={(e) => updateLot(idx, lot._key, { quantity: e.target.value === '' ? '' : (parseFloat(e.target.value) || 0) })} className="h-8 text-sm" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Validade</Label>
                                  <Input type="date" value={lot.expiryDate} disabled={isReadonly || lot.indefiniteValidity} onChange={(e) => updateLot(idx, lot._key, { expiryDate: e.target.value })} className="h-8 text-sm" />
                                </div>
                                <div className="flex h-8 items-center gap-2">
                                  <Switch
                                    checked={!!lot.indefiniteValidity}
                                    disabled={isReadonly}
                                    onCheckedChange={(checked) => updateLot(idx, lot._key, {
                                      indefiniteValidity: checked,
                                      expiryDate: checked ? '' : lot.expiryDate,
                                    })}
                                  />
                                  <Label className="text-xs text-muted-foreground">Sem validade</Label>
                                </div>
                                {!isReadonly && (
                                  <Button variant="ghost" size="icon" onClick={() => removeLot(idx, lot._key)} className="h-8 w-8 text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Action Cards */}
          {isAwaitingDelivery && canReceive && (
            <div className="rounded-2xl border-2 border-dashed p-10 text-center space-y-4">
              <p className="text-muted-foreground text-sm">
                Pedido confirmado. Aguarde a entrega, faça a conferência e depois registre a entrada no estoque.
              </p>
              <Button onClick={handleStartConference} disabled={starting} className="bg-[#E91E63] hover:bg-[#D81B60] text-white px-8 h-12 text-lg rounded-full font-medium">
                {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Abrir recebimento
              </Button>
            </div>
          )}

          {isAwaitingStock && !isImmediate && canReceive && (
            <div className="rounded-2xl border-2 border-dashed p-10 text-center space-y-4">
              <p className="text-muted-foreground text-sm">
                Conferência concluída. Inicie a entrada no estoque para finalizar o processo.
              </p>
              <Button onClick={handleStartStockEntry} disabled={starting} className="bg-primary px-8 h-12 text-lg rounded-full font-medium">
                {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Iniciar entrada no estoque
              </Button>
            </div>
          )}

          {(isInConference || isInStockEntry) && (
             <div className="flex justify-end gap-3 pt-4">
                {isInConference && (
                  <Button onClick={handleSaveConference} disabled={confirming} className="rounded-full px-8 h-12">
                    {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Concluir conferência
                  </Button>
                )}
                {isInStockEntry && (
                  <Button onClick={handleConfirmStockEntry} disabled={confirming} className="rounded-full px-8 h-12">
                    {confirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirmar entrada no estoque
                  </Button>
                )}
             </div>
          )}

          {isDone && (
            <div className="rounded-2xl border bg-muted/20 p-10 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 mx-auto text-green-500" />
              <h3 className="text-xl font-bold">Recebimento finalizado</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                A entrada no estoque foi realizada e a situação financeira foi atualizada com os dados do recebimento.
              </p>
              <Button variant="outline" onClick={() => router.push('/dashboard/purchasing/receipts')} className="rounded-full mt-4">
                Voltar para a lista
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4 xl:sticky xl:top-6">
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Resumo financeiro</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Condição</span>
                <span className="font-medium">{order?.paymentCondition === 'installments' ? 'Parcelado' : 'À vista'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Forma</span>
                <span className="font-medium">{order ? PAYMENT_LABELS[order.paymentMethod] : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor previsto</span>
                <span className="font-medium">{fmt(effectiveOrderTotal)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 mt-2">
                <span className="text-muted-foreground">Situação</span>
                <span className="font-bold text-primary">
                  {financial ? FINANCIAL_STATUS_LABELS[financial.status] : 'Pendente'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Classificação</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-tight">Plano de contas</p>
                <p className="font-medium">{order?.accountPlanName || 'Não definido'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-tight">Centro de resultado</p>
                <p className="font-medium">{order?.resultCenterName || 'Não definido'}</p>
              </div>
            </div>
          </div>

          {isInStockEntry && requiresStockDestination && (
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Destino do estoque</h3>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                <p className="text-xs uppercase tracking-tight text-muted-foreground">Quiosque de destino</p>
                <p className="mt-1 font-medium">
                  {selectedDestinationKiosk?.name ?? (destinationKioskId ? destinationKioskId : 'Não definido')}
                </p>
                {!destinationKioskId && (
                  <p className="mt-2 text-xs text-amber-600">Defina no fluxo de recebimento.</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold">Logística</h3>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Modalidade</span>
                <span className="font-medium">{isImmediate ? 'Retirada' : 'Entrega'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data prevista</span>
                <span className="font-medium">{receipt.expectedDate ? format(parseISO(receipt.expectedDate), 'dd/MM/yyyy') : '—'}</span>
              </div>
            </div>
          </div>

          {(order?.notes || receipt.notes) && (
            <div className="rounded-2xl border bg-card p-5 space-y-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Observações</h3>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{receipt.notes || order?.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
