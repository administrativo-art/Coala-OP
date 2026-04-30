"use client";

import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { PURCHASING_COLLECTIONS } from '@/lib/purchasing-constants';
import { useEntities } from '@/hooks/use-entities';
import { useBaseProducts } from '@/hooks/use-base-products';
import { type EffectiveCostEntry, type PurchaseOrder, type PurchaseReceipt, type Quotation } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry: EffectiveCostEntry | null;
}

interface ChainData {
  receipt: PurchaseReceipt | null;
  order: PurchaseOrder | null;
  quotation: Quotation | null;
}

function StepRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-primary bg-background" />
      <div className="absolute left-1.5 top-4 bottom-0 w-px bg-border" />
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <div className="mb-4">{children}</div>
    </div>
  );
}

export function TraceDrawer({ open, onOpenChange, entry }: Props) {
  const { entities } = useEntities();
  const { baseProducts } = useBaseProducts();
  const [chain, setChain] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !entry) { setChain(null); return; }

    setLoading(true);
    async function fetch() {
      if (!entry) return;
      try {
        const [receiptSnap, orderSnap] = await Promise.all([
          getDoc(doc(db, PURCHASING_COLLECTIONS.purchaseReceipts, entry.purchaseReceiptId)),
          getDoc(doc(db, PURCHASING_COLLECTIONS.purchaseOrders, entry.purchaseOrderId)),
        ]);

        const receipt = receiptSnap.exists()
          ? ({ id: receiptSnap.id, ...receiptSnap.data() } as PurchaseReceipt)
          : null;
        const order = orderSnap.exists()
          ? ({ id: orderSnap.id, ...orderSnap.data() } as PurchaseOrder)
          : null;

        let quotation: Quotation | null = null;
        const quotationId = entry.quotationId ?? order?.quotationId;
        if (quotationId) {
          const quotSnap = await getDoc(doc(db, PURCHASING_COLLECTIONS.quotations, quotationId));
          if (quotSnap.exists()) quotation = { id: quotSnap.id, ...quotSnap.data() } as Quotation;
        }

        setChain({ receipt, order, quotation });
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, [open, entry]);

  const supplier = entities.find((e) => e.id === entry?.supplierId);
  const baseItem = baseProducts.find((bp) => bp.id === entry?.baseItemId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>Rastreabilidade</SheetTitle>
          <SheetDescription>
            Cadeia completa desde o custo efetivo até a cotação de origem.
          </SheetDescription>
        </SheetHeader>

        {!entry ? null : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (
          <div className="space-y-0">
            {/* Effective cost entry */}
            <StepRow label="Custo efetivo">
              <div className="rounded-md border bg-card p-3 space-y-1 text-sm">
                <p className="font-medium">{baseItem?.name ?? entry.baseItemId}</p>
                <div className="flex gap-4 text-muted-foreground text-xs">
                  <span>
                    {entry.unitCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{baseItem?.unit ?? ''}
                  </span>
                  <span>Qtd: {entry.quantity} {baseItem?.unit ?? ''}</span>
                  <span>{format(parseISO(entry.occurredAt), 'dd/MM/yyyy', { locale: ptBR })}</span>
                </div>
                {entry.purchasePrice != null && (
                  <p className="text-xs text-muted-foreground">
                    Pago: {entry.purchasePrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    {entry.purchaseUnitLabel ? ` / ${entry.purchaseUnitLabel}` : ''}
                    {entry.stockProductQuantity != null ? ` • estoque gerado: ${entry.stockProductQuantity}` : ''}
                  </p>
                )}
                <p className="text-xs text-muted-foreground font-mono">
                  Lote: …{entry.purchaseReceiptLotId.slice(-8)}
                </p>
              </div>
            </StepRow>

            {/* Supplier */}
            <StepRow label="Fornecedor">
              <p className="text-sm font-medium">
                {supplier?.fantasyName ?? supplier?.name ?? entry.supplierId}
              </p>
              {supplier?.contact?.email && (
                <p className="text-xs text-muted-foreground">{supplier.contact.email}</p>
              )}
            </StepRow>

            {/* Receipt */}
            <StepRow label="Recebimento">
              {chain?.receipt ? (
                <div className="rounded-md border bg-card p-3 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {chain.receipt.status === 'stocked' ? 'Estocado' : 'Estocado c/ divergência'}
                    </Badge>
                    {chain.receipt.stockEnteredAt && (
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(chain.receipt.stockEnteredAt), 'dd/MM/yyyy', { locale: ptBR })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">
                    ID: …{entry.purchaseReceiptId.slice(-8)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Recebimento não encontrado.</p>
              )}
            </StepRow>

            {/* Order */}
            <StepRow label="Pedido de compra">
              {chain?.order ? (
                <div className="rounded-md border bg-card p-3 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">
                      {chain.order.receiptMode === 'immediate_pickup' ? 'Retirada imediata' : 'Entrega futura'}
                    </Badge>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>
                      Previsto: {chain.order.totalEstimated.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                    {chain.order.totalConfirmed != null && (
                      <span>
                        Confirmado: {chain.order.totalConfirmed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Criado em {format(parseISO(chain.order.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    ID: …{entry.purchaseOrderId.slice(-8)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Pedido não encontrado.</p>
              )}
            </StepRow>

            {/* Quotation */}
            <StepRow label="Cotação">
              {chain?.quotation ? (
                <div className="rounded-md border bg-card p-3 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {chain.quotation.mode === 'remote' ? 'Remota' : 'In loco'}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {chain.quotation.status}
                    </Badge>
                  </div>
                  {chain.quotation.notes && (
                    <p className="text-xs text-muted-foreground italic">{chain.quotation.notes}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Criada em {format(parseISO(chain.quotation.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    ID: …{chain.quotation.id.slice(-8)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {chain?.order?.origin === 'direct' ? 'Compra direta — sem cotação.' : 'Cotação não encontrada.'}
                </p>
              )}
            </StepRow>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
