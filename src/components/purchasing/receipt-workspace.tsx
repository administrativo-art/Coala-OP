"use client";

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, Info, ShoppingCart, ReceiptText, Scale, Truck, Building2 } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { usePurchaseReceipts } from '@/hooks/use-purchase-receipts';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { canReceivePurchase } from '@/lib/purchasing-permissions';
import { storage } from '@/lib/firebase';
import { calculateStockQuantityFromPurchase } from '@/lib/purchasing-units';
import { type PurchaseReceipt, type PurchaseReceiptItem } from '@/types';
import { cn } from '@/lib/utils';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { usePurchaseFinancials } from '@/hooks/use-purchase-financials';

interface LotDraft {
  _key: string;
  lotCode: string;
  expiryDate?: string;
  quantity: number;
}

interface ItemDraft {
  receiptItemId: string;
  purchaseOrderItemId: string;
  baseItemId: string;
  productId: string;
  unit: string;
  purchaseUnitType: PurchaseReceiptItem['purchaseUnitType'];
  purchaseUnitLabel: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPriceConfirmed: number;
  divergenceReason: string;
  lots: LotDraft[];
  expiryDate?: string;
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
  const { products } = useProducts();
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
  const isInConference = receipt.status === 'in_conference';
  const isAwaitingStock = receipt.status === 'awaiting_stock';
  const isInStockEntry =
    receipt.status === 'in_stock_entry' ||
    receipt.status === 'partially_stocked' ||
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
          .filter((item) => receipt.status !== 'partially_stocked' || item.status === 'pending' || item.status === 'partial')
          .map((item) => {
            const base = baseProducts.find((bp) => bp.id === item.baseItemId);
            const remainingQuantity =
              receipt.status === 'partially_stocked'
                ? Math.max(item.quantityOrdered - (item.quantityReceived ?? 0), 0)
                : (item.quantityReceived && item.quantityReceived > 0 ? item.quantityReceived : item.quantityOrdered);
            return {
              receiptItemId: item.id,
              purchaseOrderItemId: item.purchaseOrderItemId,
              baseItemId: item.baseItemId,
              productId: item.productId || '',
              unit: item.unit || item.purchaseUnitLabel || base?.unit || '',
              purchaseUnitType: item.purchaseUnitType ?? 'content',
              purchaseUnitLabel: item.purchaseUnitLabel || item.unit || base?.unit || '',
              quantityOrdered: item.quantityOrdered,
              quantityReceived: remainingQuantity,
              unitPriceConfirmed: item.unitPriceConfirmed || item.unitPriceOrdered,
              divergenceReason: '',
              expiryDate: '',
              lots: [
                {
                  _key: lotKey(),
                  lotCode: generateLotCode(base?.name ?? 'INS'),
                  expiryDate: '',
                  quantity: remainingQuantity,
                },
              ],
            };
          }),
      );
      setLoadingItems(false);
    });
  }, [baseProducts, fetchReceiptItems, receipt.id, receipt.notes, receipt.receiptProofDescription, receipt.status]);

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
          { _key: lotKey(), lotCode: generateLotCode(base?.name ?? 'INS'), expiryDate: '', quantity: 0 },
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
        const lotSum = d.lots.reduce((s, l) => s + (l.quantity || 0), 0);
        return Math.abs(lotSum - d.quantityReceived) < 0.001;
      }),
    [drafts],
  );

  const immediateValid = useMemo(
    () =>
      !isImmediate ||
      drafts.every(
        (d) =>
          d.quantityReceived > 0 &&
          d.unitPriceConfirmed > 0,
      ),
    [drafts, isImmediate],
  );

  const canSaveConference =
    canReceive &&
    isInConference &&
    drafts.every((d) => d.quantityReceived >= 0 && d.unitPriceConfirmed > 0);

  const canConfirmStock =
    canReceive &&
    isInStockEntry &&
    !!destinationKioskId &&
    lotsValid &&
    immediateValid &&
    drafts.every((d) => {
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
        items: drafts.map((d) => ({
          receiptItemId: d.receiptItemId,
          purchaseOrderItemId: d.purchaseOrderItemId,
          baseItemId: d.baseItemId,
          unit: d.unit,
          purchaseUnitType: d.purchaseUnitType,
          purchaseUnitLabel: d.purchaseUnitLabel,
          quantityReceived: d.quantityReceived,
          unitPriceConfirmed: d.unitPriceConfirmed,
          divergenceReason: d.divergenceReason || undefined,
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
    const kiosk = kiosks.find((k) => k.id === destinationKioskId);
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
        destinationKioskName: kiosk?.name ?? destinationKioskId,
        notes,
        receiptProofUrl,
        receiptProofDescription: proofDescription || undefined,
        items: drafts.map((d) => ({
          ...(() => {
            const product = products.find((p) => p.id === d.productId);
            return { productName: product?.baseName ?? d.baseItemId };
          })(),
          receiptItemId: d.receiptItemId,
          purchaseOrderItemId: d.purchaseOrderItemId,
          baseItemId: d.baseItemId,
          productId: d.productId,
          purchaseUnitType: d.purchaseUnitType,
          purchaseUnitLabel: d.purchaseUnitLabel,
          lots: d.lots.map(({ _key, ...rest }) => rest),
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
                <span>Vencimento: {format(parseISO(order.paymentDueDate), 'dd/MM/yyyy')}</span>
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

      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-6 items-start">
        <div className="space-y-6">
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
                  const variantOptions = products.filter(
                    (p) => p.baseProductId === draft.baseItemId && !p.isArchived,
                  );
                  const selectedStockProduct = products.find((p) => p.id === draft.productId);
                  const lotSum = draft.lots.reduce((s, l) => s + (l.quantity || 0), 0);
                  const lotValid = Math.abs(lotSum - draft.quantityReceived) < 0.001;
                  const hasDivergence =
                    Math.abs(draft.quantityReceived - draft.quantityOrdered) > 0.001 ||
                    !!draft.divergenceReason;
                  
                  const isReadonly = isAwaitingDelivery || isDone;

                  return (
                    <div key={draft.receiptItemId} className={cn(
                      "px-5 py-5 space-y-4",
                      hasDivergence && 'bg-amber-50/30 dark:bg-amber-950/10'
                    )}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-semibold text-lg">{base?.name ?? draft.baseItemId}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>Pedido: {draft.quantityOrdered} {draft.purchaseUnitLabel} × {fmt(draft.unitPriceConfirmed)}</span>
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
                        {hasDivergence && (
                          <Badge variant="outline" className="text-amber-600 border-amber-400 shrink-0">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            Divergência
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Qtd. recebida</Label>
                          <Input
                            type="number"
                            step="0.001"
                            value={draft.quantityReceived}
                            disabled={isReadonly || (!isImmediate && isInStockEntry)}
                            onChange={(e) => updateDraft(idx, { quantityReceived: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Preço unit. (R$)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={draft.unitPriceConfirmed}
                            disabled={isReadonly || (!isImmediate && isInStockEntry)}
                            onChange={(e) => updateDraft(idx, { unitPriceConfirmed: parseFloat(e.target.value) || 0 })}
                          />
                        </div>
                        {isInStockEntry && (
                          <div className="space-y-1">
                            <Label className="text-xs">Unidade estoque</Label>
                            {selectedStockProduct ? (
                              <Input
                                value={`${selectedStockProduct.baseName} (${selectedStockProduct.packageSize}${selectedStockProduct.unit})`}
                                readOnly
                                disabled
                                className="bg-muted font-medium"
                              />
                            ) : (
                              <Select value={draft.productId} onValueChange={(v) => updateDraft(idx, { productId: v })}>
                                <SelectTrigger className={cn(!draft.productId && 'border-amber-400')} disabled={isReadonly}>
                                  <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {variantOptions.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.baseName} ({p.packageSize}{p.unit})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        )}
                      </div>

                      {hasDivergence && (
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

                      {isInStockEntry && (
                        <div className="space-y-3 pt-2">
                           <div className="flex items-center justify-between">
                            <Label className="text-xs font-medium">Lotes ({lotSum.toFixed(3)} / {draft.quantityReceived.toFixed(3)})</Label>
                            {!isReadonly && (
                              <Button type="button" variant="ghost" size="sm" onClick={() => addLot(idx)} className="h-7 text-xs">
                                <Plus className="mr-1 h-3 w-3" /> Lote
                              </Button>
                            )}
                          </div>
                          <div className="space-y-2">
                            {draft.lots.map((lot) => (
                              <div key={lot._key} className="grid grid-cols-[1fr_1fr_120px_auto] gap-2 items-end">
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Cód. Lote</Label>
                                  <Input value={lot.lotCode} disabled={isReadonly} onChange={(e) => updateLot(idx, lot._key, { lotCode: e.target.value })} className="h-8 text-sm" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Qtd.</Label>
                                  <Input type="number" value={lot.quantity} disabled={isReadonly} onChange={(e) => updateLot(idx, lot._key, { quantity: parseFloat(e.target.value) || 0 })} className="h-8 text-sm" />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground uppercase">Validade</Label>
                                  <Input type="date" value={lot.expiryDate} disabled={isReadonly} onChange={(e) => updateLot(idx, lot._key, { expiryDate: e.target.value })} className="h-8 text-sm" />
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

          {isInStockEntry && (
            <div className="rounded-2xl border bg-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">Destino do estoque</h3>
              </div>
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
                {!destinationKioskId && (
                  <p className="text-xs text-amber-600">Obrigatório para confirmar a entrada.</p>
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
