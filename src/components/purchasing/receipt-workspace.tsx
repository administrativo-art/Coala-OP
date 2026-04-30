"use client";

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  const { baseProducts } = useBaseProducts();
  const { products } = useProducts();
  const { kiosks } = useKiosks();

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
            productId: '',
            unit: item.unit || item.purchaseUnitLabel || base?.unit || '',
            purchaseUnitType: item.purchaseUnitType ?? 'content',
            purchaseUnitLabel: item.purchaseUnitLabel || item.unit || base?.unit || '',
            quantityOrdered: item.quantityOrdered,
            quantityReceived: remainingQuantity,
            unitPriceConfirmed: item.unitPriceConfirmed || item.unitPriceOrdered,
            divergenceReason: '',
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

  const handleConfirmStock = async () => {
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

  if (isDone) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <p className="text-lg font-semibold">Recebimento concluído</p>
        <p className="text-sm text-muted-foreground">
          Status: {receipt.status === 'stocked_with_divergence' ? 'Estocado com divergência' : 'Estocado'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Mode badge */}
      <div className="flex items-center gap-3">
        <Badge variant="outline">
          {isImmediate ? 'Retirada imediata' : 'Entrega futura'}
        </Badge>
        <Badge variant={isInConference || isInStockEntry ? 'default' : 'secondary'}>
          {isAwaitingDelivery
            ? 'Aguardando entrega'
            : isInConference
            ? 'Em conferência'
            : isAwaitingStock
            ? 'Aguardando estoque'
            : isInStockEntry
            ? 'Entrada no estoque'
            : 'Concluído'}
        </Badge>
      </div>

      {isAwaitingDelivery && canReceive && (
        <div className="rounded-lg border-2 border-dashed p-8 text-center space-y-4">
          <Info className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            A entrega ainda não chegou. Clique abaixo quando os itens estiverem disponíveis para conferência.
          </p>
          <Button onClick={handleStartConference} disabled={starting}>
            {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Iniciar conferência
          </Button>
        </div>
      )}

      {isAwaitingStock && !isImmediate && canReceive && (
        <div className="rounded-lg border-2 border-dashed p-8 text-center space-y-4">
          <Info className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            A conferência foi concluída. Revise os itens recebidos e inicie a entrada no estoque.
          </p>
          <Button onClick={handleStartStockEntry} disabled={starting}>
            {starting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Iniciar entrada no estoque
          </Button>
        </div>
      )}

      {(isInConference || isInStockEntry) && (
        <>
          {(isInConference || isInStockEntry) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {isInStockEntry && (
            <div className="space-y-1.5">
              <Label>Destino (unidade)</Label>
              <Select value={destinationKioskId} onValueChange={setDestinationKioskId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a unidade de destino" />
                </SelectTrigger>
                <SelectContent>
                  {kiosks.map((k) => (
                    <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}

            <div className="space-y-1.5">
              <Label>Observações (opcional)</Label>
              <Input
                placeholder="Observações do recebimento..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          )}

          {isInConference && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Comprovante (opcional)</Label>
              <Input
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => setProofFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição do comprovante</Label>
              <Input
                placeholder="Ex: cupom do caixa 03"
                value={proofDescription}
                onChange={(event) => setProofDescription(event.target.value)}
              />
            </div>
          </div>
          )}

          <Separator />

          {/* Items */}
          {loadingItems ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
          ) : (
            <div className="space-y-4">
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
                const stockConversion =
                  base && selectedStockProduct
                    ? calculateStockQuantityFromPurchase(
                        draft.quantityReceived,
                        selectedStockProduct,
                        selectedStockProduct,
                        base,
                        draft.purchaseUnitType,
                      )
                    : null;

                return (
                  <div
                    key={draft.receiptItemId}
                    className={cn(
                      'rounded-lg border p-4 space-y-4',
                      hasDivergence && 'border-amber-400 bg-amber-50/30 dark:bg-amber-950/10',
                    )}
                  >
                    {/* Item header */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{base?.name ?? draft.baseItemId}</p>
                        <p className="text-xs text-muted-foreground">
                          Pedido: {draft.quantityOrdered} {draft.purchaseUnitLabel}
                        </p>
                        {stockConversion?.ok && selectedStockProduct && (
                          <p className="text-xs text-muted-foreground">
                            Estoque: {stockConversion.stockQuantity.toFixed(3)} unidade(s) de {selectedStockProduct.baseName} ({selectedStockProduct.packageSize}{selectedStockProduct.unit})
                          </p>
                        )}
                        {stockConversion && !stockConversion.ok && (
                          <p className="text-xs text-destructive">{stockConversion.error}</p>
                        )}
                      </div>
                      {hasDivergence && (
                        <Badge variant="outline" className="text-amber-600 border-amber-400 shrink-0">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Divergência
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {/* Qty received */}
                      <div className="space-y-1">
                        <Label className="text-xs">Qtd. recebida</Label>
                        <Input
                          type="number"
                          step="0.001"
                          value={draft.quantityReceived}
                          disabled={!isImmediate && isInStockEntry}
                          onChange={(e) =>
                            updateDraft(idx, { quantityReceived: parseFloat(e.target.value) || 0 })
                          }
                        />
                      </div>

                      {/* Unit price confirmed */}
                      <div className="space-y-1">
                        <Label className="text-xs">Preço unit. confirmado (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={draft.unitPriceConfirmed}
                          disabled={!isImmediate && isInStockEntry}
                          onChange={(e) =>
                            updateDraft(idx, { unitPriceConfirmed: parseFloat(e.target.value) || 0 })
                          }
                        />
                      </div>

                      {isInStockEntry && (
                        <div className="space-y-1 col-span-2 sm:col-span-1">
                          <Label className="text-xs">Unidade de estoque</Label>
                          <Select
                            value={draft.productId}
                            onValueChange={(v) => updateDraft(idx, { productId: v })}
                          >
                            <SelectTrigger className={cn(!draft.productId && 'border-amber-400')}>
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              {variantOptions.length === 0 ? (
                                <SelectItem value="_none" disabled>
                                  Nenhuma variante cadastrada
                                </SelectItem>
                              ) : (
                                variantOptions.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.baseName} {p.brand ? `— ${p.brand}` : ''} ({p.packageSize}{p.unit})
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Divergence reason */}
                      {hasDivergence && (
                        <div className="space-y-1 col-span-2 sm:col-span-3">
                          <Label className="text-xs">Motivo da divergência</Label>
                          <Input
                            placeholder="Ex: Produto com embalagem danificada..."
                            value={draft.divergenceReason}
                            disabled={!isImmediate && isInStockEntry}
                            onChange={(e) => updateDraft(idx, { divergenceReason: e.target.value })}
                          />
                        </div>
                      )}
                    </div>

                    {isInStockEntry && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">
                          Lotes —{' '}
                          <span className={cn('font-medium', lotValid ? 'text-green-600' : 'text-destructive')}>
                            {lotSum.toFixed(3)} / {draft.quantityReceived.toFixed(3)} {draft.unit}
                            {lotValid ? ' ✓' : ' ✗ ajuste necessário'}
                          </span>
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => addLot(idx)}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          Lote
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {draft.lots.map((lot) => (
                          <div key={lot._key} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Código</Label>
                              <Input
                                value={lot.lotCode}
                                onChange={(e) => updateLot(idx, lot._key, { lotCode: e.target.value })}
                                className="h-8 text-sm font-mono"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Validade</Label>
                              <Input
                                type="date"
                                value={lot.expiryDate ?? ''}
                                onChange={(e) => updateLot(idx, lot._key, { expiryDate: e.target.value || undefined })}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Qtd.</Label>
                              <Input
                                type="number"
                                step="0.001"
                                value={lot.quantity}
                                onChange={(e) =>
                                  updateLot(idx, lot._key, { quantity: parseFloat(e.target.value) || 0 })
                                }
                                className="h-8 text-sm w-24"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 mb-0 text-muted-foreground hover:text-destructive"
                              onClick={() => removeLot(idx, lot._key)}
                              disabled={draft.lots.length === 1}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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

          <Separator />

          {/* Confirm */}
          {isInStockEntry && !lotsValid && (
            <p className="text-sm text-destructive">
              A soma dos lotes precisa ser igual à quantidade recebida em todos os itens.
            </p>
          )}
          {!immediateValid && (
            <p className="text-sm text-destructive">
              Ajuste quantidades e preços confirmados antes de concluir o recebimento.
            </p>
          )}
          {isInStockEntry && drafts.some((d) => !d.productId) && (
            <p className="text-sm text-amber-600">
              Selecione a variante do produto em todos os itens.
            </p>
          )}

          <Button
            className="w-full"
            size="lg"
            disabled={!(isInConference ? canSaveConference : canConfirmStock) || confirming}
            onClick={isInConference ? handleSaveConference : handleConfirmStock}
          >
            {confirming ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-5 w-5" />
            )}
            {isInConference ? 'Concluir conferência' : 'Confirmar entrada no estoque'}
          </Button>
        </>
      )}
    </div>
  );
}
