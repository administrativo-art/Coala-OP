"use client";

import { useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Route } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { PURCHASING_COLLECTIONS } from "@/lib/purchasing-constants";
import { useEntities } from "@/hooks/use-entities";
import { useBaseProducts } from "@/hooks/use-base-products";
import {
  type EffectiveCostEntry,
  type PurchaseOrder,
  type PurchaseReceipt,
  type Quotation,
} from "@/types";

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

function StepRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-8">
      <span className="absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border-4 border-violet-100 bg-violet-600" />
      <div className="absolute bottom-[-16px] left-[9px] top-6 w-px bg-violet-200" />
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.1em] text-violet-700">
        {label}
      </p>
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
    if (!open || !entry) {
      setChain(null);
      return;
    }

    setLoading(true);
    async function fetch() {
      if (!entry) return;
      try {
        const [receiptSnap, orderSnap] = await Promise.all([
          getDoc(
            doc(
              db,
              PURCHASING_COLLECTIONS.purchaseReceipts,
              entry.purchaseReceiptId,
            ),
          ),
          getDoc(
            doc(
              db,
              PURCHASING_COLLECTIONS.purchaseOrders,
              entry.purchaseOrderId,
            ),
          ),
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
          const quotSnap = await getDoc(
            doc(db, PURCHASING_COLLECTIONS.quotations, quotationId),
          );
          if (quotSnap.exists())
            quotation = { id: quotSnap.id, ...quotSnap.data() } as Quotation;
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
      <SheetContent className="font-purchasing flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 border-b border-violet-200 bg-violet-50/80 px-6 py-5 pr-12 text-left">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
              <Route className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="text-[19px] font-black tracking-[-0.035em] text-zinc-950">
                Rastreabilidade
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs leading-relaxed text-zinc-600">
                Percurso completo do custo efetivo até a cotação de origem.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto bg-[#f6f6f7] px-5 py-5 sm:px-6">
          {!entry ? null : loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-[14px]" />
              ))}
            </div>
          ) : (
            <div className="space-y-0">
              {/* Effective cost entry */}
              <StepRow label="Custo efetivo">
                <div className="space-y-2 rounded-[14px] border border-zinc-200 bg-white p-4 text-sm shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                  <p className="font-black text-zinc-900">
                    {baseItem?.name ?? entry.baseItemId}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    <span>
                      {entry.unitCost.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                      /{baseItem?.unit ?? ""}
                    </span>
                    <span>
                      Qtd: {entry.quantity} {baseItem?.unit ?? ""}
                    </span>
                    <span>
                      {format(parseISO(entry.occurredAt), "dd/MM/yyyy", {
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                  {entry.purchasePrice != null && (
                    <p className="border-t border-zinc-100 pt-2 text-xs leading-relaxed text-zinc-500">
                      Pago:{" "}
                      {entry.purchasePrice.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                      {entry.purchaseUnitLabel
                        ? ` / ${entry.purchaseUnitLabel}`
                        : ""}
                      {entry.stockProductQuantity != null
                        ? ` • estoque gerado: ${entry.stockProductQuantity}`
                        : ""}
                    </p>
                  )}
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                    Lote: …{entry.purchaseReceiptLotId.slice(-8)}
                  </p>
                </div>
              </StepRow>

              {/* Supplier */}
              <StepRow label="Fornecedor">
                <div className="rounded-[14px] border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                  <p className="text-sm font-black text-zinc-900">
                    {supplier?.fantasyName ??
                      supplier?.name ??
                      entry.supplierId}
                  </p>
                  {supplier?.contact?.email && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {supplier.contact.email}
                    </p>
                  )}
                </div>
              </StepRow>

              {/* Receipt */}
              <StepRow label="Recebimento">
                {chain?.receipt ? (
                  <div className="space-y-2 rounded-[14px] border border-zinc-200 bg-white p-4 text-sm shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="rounded-md border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700"
                      >
                        {chain.receipt.status === "stocked"
                          ? "Estocado"
                          : "Estocado c/ divergência"}
                      </Badge>
                      {chain.receipt.stockEnteredAt && (
                        <span className="text-xs text-zinc-500">
                          {format(
                            parseISO(chain.receipt.stockEnteredAt),
                            "dd/MM/yyyy",
                            { locale: ptBR },
                          )}
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                      ID: …{entry.purchaseReceiptId.slice(-8)}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-[14px] border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">
                    Recebimento não encontrado.
                  </p>
                )}
              </StepRow>

              {/* Order */}
              <StepRow label="Pedido de compra">
                {chain?.order ? (
                  <div className="space-y-2 rounded-[14px] border border-zinc-200 bg-white p-4 text-sm shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="rounded-md border-violet-200 bg-violet-50 text-xs font-bold text-violet-700"
                      >
                        {chain.order.receiptMode === "immediate_pickup"
                          ? "Retirada imediata"
                          : "Entrega futura"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>
                        Previsto:{" "}
                        {chain.order.totalEstimated.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </span>
                      {chain.order.totalConfirmed != null && (
                        <span>
                          Confirmado:{" "}
                          {chain.order.totalConfirmed.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">
                      Criado em{" "}
                      {format(parseISO(chain.order.createdAt), "dd/MM/yyyy", {
                        locale: ptBR,
                      })}
                    </p>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                      ID: …{entry.purchaseOrderId.slice(-8)}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-[14px] border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">
                    Pedido não encontrado.
                  </p>
                )}
              </StepRow>

              {/* Quotation */}
              <StepRow label="Cotação">
                {chain?.quotation ? (
                  <div className="space-y-2 rounded-[14px] border border-zinc-200 bg-white p-4 text-sm shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className="rounded-md bg-zinc-100 text-xs font-bold text-zinc-700"
                      >
                        {chain.quotation.mode === "remote"
                          ? "Remota"
                          : "In loco"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-md border-zinc-200 text-xs font-bold"
                      >
                        {chain.quotation.status}
                      </Badge>
                    </div>
                    {chain.quotation.notes && (
                      <p className="text-xs italic leading-relaxed text-zinc-500">
                        {chain.quotation.notes}
                      </p>
                    )}
                    <p className="text-xs text-zinc-500">
                      Criada em{" "}
                      {format(
                        parseISO(chain.quotation.createdAt),
                        "dd/MM/yyyy",
                        { locale: ptBR },
                      )}
                    </p>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                      ID: …{chain.quotation.id.slice(-8)}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-[14px] border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">
                    {chain?.order?.origin === "direct"
                      ? "Compra direta — sem cotação."
                      : "Cotação não encontrada."}
                  </p>
                )}
              </StepRow>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
