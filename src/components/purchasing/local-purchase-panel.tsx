"use client";

import { useRef, useState } from "react";

import { Field, fieldInputClass } from "@/components/patterns/field";
import { InlineConfirm } from "@/components/patterns/inline-confirm";
import { SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { purchasingMoney } from "@/components/purchasing/purchasing-ui";
import type { LocalPurchaseSummary } from "@/features/purchasing/local-purchase-admin";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";

export function localPurchaseCode(id: string) {
  return `CL-${id.slice(-8).toUpperCase()}`;
}

/** Financial situation of a local purchase in the words the purchasing list uses. */
export function localPurchaseFinancialLabel(purchase: LocalPurchaseSummary) {
  if (purchase.status === "cancelled") return "Cancelado";
  if (purchase.status === "reconciled") return "Pago pela sangria";
  if (purchase.status === "awaiting_cash_withdrawal") return purchase.withdrawal ? "Sangria pré-vinculada" : "Aguardando sangria";
  return "A pagar";
}

const stockLabels: Record<LocalPurchaseSummary["stockEntryStatus"], string> = {
  done: "Entrada concluída",
  pending: "Entrada pendente",
  not_needed: "Sem entrada (consumo direto)",
  reversed: "Entrada estornada",
};

function formatDay(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 text-[13px]"><span className="text-ds-ink-faint">{label}</span><span className="text-right font-semibold text-ds-ink">{children}</span></div>;
}

/** Detalhe da compra feita pelo aplicativo; o estorno desfaz estoque, despesa e pré-vínculo de sangria de uma vez. */
export function LocalPurchasePanel(props: {
  purchase: LocalPurchaseSummary | null;
  canReverse: boolean;
  onOpenChange: (open: boolean) => void;
  onReversed: (purchase: LocalPurchaseSummary) => void;
}) {
  const api = useAuthenticatedApi();
  const reverseButtonRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purchase = props.purchase;

  const close = (open: boolean) => {
    if (!open) { setReason(""); setConfirming(false); setError(null); }
    props.onOpenChange(open);
  };
  const reverse = async () => {
    if (!purchase || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ purchase: LocalPurchaseSummary }>("/api/purchasing/local-purchases/reverse", {
        method: "POST", json: { purchaseId: purchase.id, reason: reason.trim() }, fallbackError: "Não foi possível estornar a compra.",
      });
      setReason(""); setConfirming(false);
      props.onReversed(result.purchase);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível estornar a compra.");
      setConfirming(false);
    } finally { setBusy(false); }
  };
  const stockByItem = new Map(purchase?.stockLines.map((line) => [line.itemIndex, line]) ?? []);
  const cancelled = purchase?.status === "cancelled";

  return (
    <SidePanel
      open={!!purchase}
      onOpenChange={close}
      kicker={purchase ? `Compra local · ${localPurchaseCode(purchase.id)}` : undefined}
      title={purchase?.supplierName || "Compra local"}
      subtitle={purchase ? `${purchase.unitName} · ${formatDay(purchase.purchaseDate)}` : undefined}
      highlights={purchase ? <span>{purchasingMoney(purchase.totalCents / 100)}</span> : undefined}
    >
      {purchase ? <>
        <section className="space-y-2">
          <Row label="Origem">Aplicativo Coala Notas</Row>
          <Row label="Pagamento">{purchase.fundingSource === "cash_withdrawal" ? "Sangria do caixa" : `Recurso da empresa${purchase.companyPaymentMethod ? ` · ${purchase.companyPaymentMethod}` : ""}`}</Row>
          <Row label="Financeiro">{localPurchaseFinancialLabel(purchase)}</Row>
          {purchase.withdrawal ? <Row label="Sangria escolhida">{purchasingMoney(purchase.withdrawal.amountCents / 100)} em {formatDay(purchase.withdrawal.date)}{purchase.withdrawal.changeCents > 0 ? ` · troco ${purchasingMoney(purchase.withdrawal.changeCents / 100)}` : ""}</Row> : null}
          <Row label="Categoria">{purchase.accountPlanName || "—"}</Row>
          <Row label="Centro de resultado">{purchase.resultCenterName || "—"}</Row>
          <Row label="Estoque">{stockLabels[purchase.stockEntryStatus]}</Row>
          {purchase.note ? <Row label="Observação">{purchase.note}</Row> : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-ds-ink-faint">Itens</h3>
          <ul className="divide-y divide-ds-border rounded-ds-md border border-ds-border bg-ds-surface">
            {purchase.items.map((item, index) => {
              const stock = stockByItem.get(index);
              return <li key={`${index}-${item.description}`} className="px-3 py-2.5 text-[13px]">
                <div className="flex items-baseline justify-between gap-3"><span className="font-semibold text-ds-ink">{item.description}</span><span className="shrink-0 font-mono text-ds-ink">{purchasingMoney(item.totalCents / 100)}</span></div>
                <p className="mt-0.5 text-xs text-ds-ink-faint">{item.quantity} {item.unit}{stock ? ` · estoque: ${stock.quantity} × ${stock.productName} · lote ${stock.lotCode}${stock.expiryDate ? ` · validade ${formatDay(stock.expiryDate)}` : " · sem validade"}` : " · consumo direto"}</p>
              </li>;
            })}
          </ul>
        </section>

        {cancelled && purchase.cancellation ? <section className="space-y-1 rounded-ds-md border border-ds-border bg-ds-surface p-3 text-[13px]">
          <p className="font-bold text-ds-ink">Compra estornada</p>
          <p className="text-ds-ink-2">{purchase.cancellation.reason}</p>
          <p className="text-xs text-ds-ink-faint">{purchase.cancellation.by} · {formatDay(purchase.cancellation.at)}</p>
        </section> : null}

        {!cancelled && props.canReverse ? <section className="mt-auto space-y-3 border-t border-ds-border pt-4">
          <p className="text-xs text-ds-ink-faint">O estorno retira a mercadoria do estoque, cancela a despesa e libera a sangria para receber outra nota. Para corrigir uma compra, estorne e registre de novo pelo aplicativo.</p>
          <Field label="Motivo do estorno" htmlFor="local-purchase-reverse-reason" error={error}>
            <textarea id="local-purchase-reverse-reason" value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} className={`${fieldInputClass} h-20 py-2`} />
          </Field>
          {confirming
            ? <InlineConfirm message={`Estornar a compra ${localPurchaseCode(purchase.id)}? O estoque e a despesa serão desfeitos.`} confirmLabel="Estornar compra" loadingLabel="Estornando…" loading={busy} onConfirm={() => void reverse()} onCancel={() => setConfirming(false)} returnFocusRef={reverseButtonRef} />
            : <Button ref={reverseButtonRef} type="button" variant="outline" disabled={reason.trim().length < 5} onClick={() => { setError(null); setConfirming(true); }}>Estornar compra</Button>}
        </section> : null}
      </> : null}
    </SidePanel>
  );
}
