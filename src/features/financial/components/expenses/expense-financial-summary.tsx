"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ReceiptText, SearchCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/features/financial/lib/utils";
import type { FinancialObligationSummary } from "@/features/financial/obligations/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ExpenseSummarySource = {
  id: string;
  status?: string;
  totalValue?: number;
  netPayableValue?: number;
  provisionType?: string;
  provisionedValue?: number | null;
  obligationId?: string | null;
  linkedBankTransactionId?: string | null;
  settlementSummary?: Partial<FinancialObligationSummary> | null;
};

type SettlementDetails = {
  summary?: FinancialObligationSummary | null;
  payments?: Array<Record<string, any>>;
  links?: Array<Record<string, any>>;
  adjustments?: Array<Record<string, any>>;
  events?: Array<Record<string, any>>;
  chargeAccountPlans?: Array<{ id: string; name: string }>;
};

type AdjustmentForm = {
  type: string;
  reason: string;
  responsibility: string;
  responsibleArea: string;
  responsibleName: string;
  accountPlanId: string;
};

function moneyCents(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function fallbackSummary(expense: ExpenseSummarySource): FinancialObligationSummary {
  const stored = expense.settlementSummary;
  if (stored?.obligationStatus) return stored as FinancialObligationSummary;
  const isForecast = expense.provisionType === "forecast";
  const actualAmountCents = isForecast ? null : moneyCents(expense.totalValue);
  const settlementAmountCents = actualAmountCents == null
    ? null
    : moneyCents(expense.netPayableValue) || actualAmountCents;
  const forecastAmountCents = isForecast
    ? moneyCents(expense.totalValue)
    : expense.provisionedValue == null ? null : moneyCents(expense.provisionedValue);
  const isPaid = expense.status === "paid";
  const confirmed = isPaid && Boolean(expense.linkedBankTransactionId);
  const cashPaidAmountCents = isPaid ? settlementAmountCents || 0 : 0;
  return {
    forecastAmountCents,
    actualAmountCents,
    settlementAmountCents,
    reportedCashAmountCents: isPaid && !confirmed ? cashPaidAmountCents : 0,
    confirmedCashAmountCents: confirmed ? cashPaidAmountCents : 0,
    cashPaidAmountCents,
    principalSettledAmountCents: cashPaidAmountCents,
    confirmedPrincipalAmountCents: confirmed ? cashPaidAmountCents : 0,
    settlementCreditsAmountCents: 0,
    cashChargesAmountCents: 0,
    cashReductionsAmountCents: 0,
    unclassifiedDifferenceAmountCents: 0,
    balanceAmountCents: settlementAmountCents == null ? null : Math.max(0, settlementAmountCents - cashPaidAmountCents),
    obligationStatus: isPaid ? "PAID" : "OPEN",
    reconciliationStatus: confirmed ? "MATCHED" : "NOT_FOUND",
    paymentEvidenceStatus: confirmed ? "CONFIRMED" : isPaid ? "REPORTED" : "NONE",
  };
}

function currencyFromCents(value: number | null | undefined) {
  return value == null ? "—" : formatCurrency(value / 100);
}

function statusCopy(summary: FinancialObligationSummary) {
  if (summary.reconciliationStatus === "DIVERGENT") return { label: "Revisão necessária", tone: "warning" as const };
  if (summary.reconciliationStatus === "PENDING_DOCUMENT") return { label: "Pagamento localizado · documento pendente", tone: "warning" as const };
  if (summary.obligationStatus === "PARTIALLY_PAID") return { label: "Parcialmente pago", tone: "warning" as const };
  if (summary.obligationStatus === "PAID" && summary.paymentEvidenceStatus === "REPORTED") {
    return { label: "Pago informado · aguardando extrato", tone: "reported" as const };
  }
  if (summary.obligationStatus === "PAID") return { label: "Pago e conciliado", tone: "success" as const };
  return { label: "Em aberto", tone: "neutral" as const };
}

function adjustmentLabel(type: unknown) {
  return ({ INTEREST: "Juros", FINE: "Multa", DISCOUNT: "Desconto", ABATEMENT: "Abatimento", OTHER: "Outro ajuste" } as Record<string, string>)[String(type)] || "Ajuste";
}

export function ExpenseFinancialSummary({ expense }: { expense: ExpenseSummarySource }) {
  const { firebaseUser, permissions } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<SettlementDetails | null>(null);
  const [error, setError] = useState("");
  const [editingAdjustment, setEditingAdjustment] = useState<Record<string, any> | null>(null);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentForm | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState("");
  const summary = useMemo(() => fallbackSummary(expense), [expense]);
  const copy = statusCopy(summary);
  const variation = summary.forecastAmountCents == null || summary.actualAmountCents == null
    ? null
    : summary.actualAmountCents - summary.forecastAmountCents;
  const settlementAmountCents = summary.settlementAmountCents ?? summary.actualAmountCents;

  async function openDetails() {
    setOpen(true);
    if (details || !firebaseUser) return;
    setLoading(true);
    setError("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/financial/expenses/${encodeURIComponent(expense.id)}/settlement`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao consultar os detalhes.");
      setDetails(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao consultar os detalhes.");
    } finally {
      setLoading(false);
    }
  }

  const detailSummary = details?.summary || summary;
  const payments = details?.payments || [];
  const adjustments = details?.adjustments || [];
  const events = details?.events || [];
  const chargeAccountPlans = details?.chargeAccountPlans || [];
  const adjustmentTypeOptions = editingAdjustment?.effect === "SETTLEMENT_CREDIT"
    ? [["DISCOUNT", "Desconto"], ["ABATEMENT", "Abatimento"], ["OTHER", "Outro crédito"]]
    : editingAdjustment?.effect === "CASH_CHARGE"
      ? [["INTEREST", "Juros"], ["FINE", "Multa"], ["OTHER", "Outro encargo"]]
      : [[String(editingAdjustment?.type || "OTHER"), adjustmentLabel(editingAdjustment?.type)]];

  function editAdjustment(adjustment: Record<string, any>) {
    setEditingAdjustment(adjustment);
    setAdjustmentError("");
    setAdjustmentForm({
      type: String(adjustment.type || "OTHER"),
      reason: String(adjustment.reason || ""),
      responsibility: String(adjustment.responsibility || "UNDETERMINED"),
      responsibleArea: String(adjustment.responsibleArea || ""),
      responsibleName: String(adjustment.responsibleName || ""),
      accountPlanId: String(adjustment.accountPlanId || ""),
    });
  }

  async function saveAdjustment() {
    if (!editingAdjustment || !adjustmentForm || !firebaseUser) return;
    setSavingAdjustment(true);
    setAdjustmentError("");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(
        `/api/financial/expenses/${encodeURIComponent(expense.id)}/adjustments/${encodeURIComponent(editingAdjustment.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...adjustmentForm,
            accountPlanId: adjustmentForm.accountPlanId || null,
            accountPlanName: chargeAccountPlans.find((plan) => plan.id === adjustmentForm.accountPlanId)?.name || null,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao classificar o ajuste.");
      setDetails((current) => current ? {
        ...current,
        adjustments: (current.adjustments || []).map((adjustment) => adjustment.id === payload.adjustment.id
          ? { ...adjustment, ...payload.adjustment }
          : adjustment),
      } : current);
      setEditingAdjustment(null);
      setAdjustmentForm(null);
    } catch (caught) {
      setAdjustmentError(caught instanceof Error ? caught.message : "Falha ao classificar o ajuste.");
    } finally {
      setSavingAdjustment(false);
    }
  }

  return (
    <>
      <section className="sm:col-span-3 rounded-xl border bg-muted/20 p-3" aria-label="Resumo financeiro da obrigação">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Resumo financeiro</p>
            <div className={cn(
              "mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium",
              copy.tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
              copy.tone === "reported" && "border-sky-200 bg-sky-50 text-sky-700",
              copy.tone === "warning" && "border-amber-200 bg-amber-50 text-amber-800",
              copy.tone === "neutral" && "border-border bg-background text-muted-foreground",
            )}>
              {copy.tone === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : copy.tone === "warning" ? <AlertTriangle className="h-3.5 w-3.5" /> : <ReceiptText className="h-3.5 w-3.5" />}
              {copy.label}
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-xl" onClick={(event) => { event.stopPropagation(); void openDetails(); }}>
            <SearchCheck className="mr-1.5 h-4 w-4" /> Ver detalhes
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            ["Provisionado", currencyFromCents(summary.forecastAmountCents)],
            ["Real", currencyFromCents(summary.actualAmountCents)],
            ["Saída financeira", currencyFromCents(summary.cashPaidAmountCents)],
            ["Saldo principal", currencyFromCents(summary.balanceAmountCents)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-background px-3 py-2.5">
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
              <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
        {(variation != null || summary.cashChargesAmountCents > 0 || Math.abs(summary.unclassifiedDifferenceAmountCents) > 1 || settlementAmountCents !== summary.actualAmountCents) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {variation != null ? `Variação da previsão: ${variation >= 0 ? "+ " : "− "}${currencyFromCents(Math.abs(variation))}` : null}
            {variation != null && settlementAmountCents !== summary.actualAmountCents ? " · " : null}
            {settlementAmountCents !== summary.actualAmountCents ? `Líquido a pagar: ${currencyFromCents(settlementAmountCents)}` : null}
            {(variation != null || settlementAmountCents !== summary.actualAmountCents) && summary.cashChargesAmountCents > 0 ? " · " : null}
            {summary.cashChargesAmountCents > 0 ? `Encargos: + ${currencyFromCents(summary.cashChargesAmountCents)}` : null}
            {Math.abs(summary.unclassifiedDifferenceAmountCents) > 1 ? ` · Diferença não classificada: ${currencyFromCents(summary.unclassifiedDifferenceAmountCents)}` : null}
          </p>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(780px,calc(100vh-48px))] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Liquidação da obrigação</DialogTitle>
            <DialogDescription>Previsão, valor real, pagamentos, ajustes e rastreabilidade sem duplicar a despesa.</DialogDescription>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Consultando...</div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Provisionado", currencyFromCents(detailSummary.forecastAmountCents)],
                  ["Real", currencyFromCents(detailSummary.actualAmountCents)],
                  ["Líquido a pagar", currencyFromCents(detailSummary.settlementAmountCents ?? detailSummary.actualAmountCents)],
                  ["Principal liquidado", currencyFromCents(detailSummary.principalSettledAmountCents)],
                  ["Total pago", currencyFromCents(detailSummary.cashPaidAmountCents)],
                  ["Confirmado no banco", currencyFromCents(detailSummary.confirmedCashAmountCents)],
                  ["Encargos", currencyFromCents(detailSummary.cashChargesAmountCents)],
                  ["Créditos", currencyFromCents(detailSummary.settlementCreditsAmountCents)],
                  ["Saldo", currencyFromCents(detailSummary.balanceAmountCents)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border p-3"><p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-sm font-semibold">{value}</p></div>
                ))}
              </div>

              <div className="rounded-xl border">
                <div className="border-b px-3 py-2 text-sm font-semibold">Pagamentos</div>
                {payments.length ? payments.map((payment) => (
                  <div key={payment.id} className="flex items-start justify-between gap-3 border-b px-3 py-2.5 last:border-b-0">
                    <div><p className="text-sm font-medium">{payment.status === "MATCHED" ? "Confirmado pelo extrato" : "Informado manualmente"}</p><p className="text-xs text-muted-foreground">{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString("pt-BR") : "Data não informada"}</p></div>
                    <p className="font-mono text-sm font-semibold">{formatCurrency(Number(payment.totalPaid) || Number(payment.cashAmountCents || 0) / 100)}</p>
                  </div>
                )) : <p className="px-3 py-4 text-sm text-muted-foreground">Nenhum pagamento registrado.</p>}
              </div>

              <div className="rounded-xl border">
                <div className="border-b px-3 py-2 text-sm font-semibold">Ajustes</div>
                {adjustments.length ? adjustments.map((adjustment) => (
                  <div key={adjustment.id} className="flex items-start justify-between gap-3 border-b px-3 py-2.5 last:border-b-0">
                    <div><p className="text-sm font-medium">{adjustmentLabel(adjustment.type)}</p><p className="text-xs text-muted-foreground">{adjustment.reason || "Motivo ainda não informado"} · {adjustment.accountingStatus === "READY" ? "classificação pronta" : "classificação contábil pendente"}</p><p className="mt-0.5 text-xs text-muted-foreground">Responsabilidade: {String(adjustment.responsibility || "UNDETERMINED") === "UNDETERMINED" ? "a definir" : adjustment.responsibility}{adjustment.responsibleArea ? ` · ${adjustment.responsibleArea}` : ""}</p></div>
                    <div className="flex shrink-0 flex-col items-end gap-2"><p className="font-mono text-sm font-semibold">{formatCurrency(Number(adjustment.amount) || Number(adjustment.amountCents || 0) / 100)}</p>{permissions.financial?.reconciliation?.classifyAdjustments && <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg text-xs" onClick={() => editAdjustment(adjustment)}>Classificar</Button>}</div>
                  </div>
                )) : <p className="px-3 py-4 text-sm text-muted-foreground">Nenhum ajuste registrado.</p>}
              </div>

              <div className="rounded-xl border">
                <div className="border-b px-3 py-2 text-sm font-semibold">Histórico</div>
                {events.length ? events.map((event) => (
                  <div key={event.id} className="border-b px-3 py-2.5 text-sm last:border-b-0"><p className="font-medium">{event.type === "PAYMENT_REPORTED" ? "Pagamento informado" : String(event.type || "Evento")}</p><p className="text-xs text-muted-foreground">{event.occurredAt ? new Date(event.occurredAt).toLocaleString("pt-BR") : "Data não informada"}{event.actor?.name ? ` · ${event.actor.name}` : ""}</p></div>
                )) : <p className="px-3 py-4 text-sm text-muted-foreground">Nenhum evento adicional.</p>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingAdjustment)} onOpenChange={(nextOpen) => { if (!nextOpen) { setEditingAdjustment(null); setAdjustmentForm(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Classificar ajuste financeiro</DialogTitle>
            <DialogDescription>Informe a natureza, o motivo, a responsabilidade e o plano de contas. A alteração ficará no histórico da obrigação.</DialogDescription>
          </DialogHeader>
          {adjustmentForm && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm"><span className="font-medium">Tipo</span><Select value={adjustmentForm.type} onValueChange={(type) => setAdjustmentForm({ ...adjustmentForm, type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{adjustmentTypeOptions.map(([type, label]) => <SelectItem key={type} value={type}>{label}</SelectItem>)}</SelectContent></Select></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Responsabilidade</span><Select value={adjustmentForm.responsibility} onValueChange={(responsibility) => setAdjustmentForm({ ...adjustmentForm, responsibility })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UNDETERMINED">Ainda não determinada</SelectItem><SelectItem value="INTERNAL">Interna</SelectItem><SelectItem value="SUPPLIER">Fornecedor</SelectItem><SelectItem value="BANK">Banco</SelectItem><SelectItem value="PUBLIC_AGENCY">Órgão público</SelectItem><SelectItem value="OTHER">Outro</SelectItem><SelectItem value="NOT_APPLICABLE">Não aplicável</SelectItem></SelectContent></Select></label>
              </div>
              <label className="block space-y-1.5 text-sm"><span className="font-medium">Motivo</span><Textarea value={adjustmentForm.reason} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, reason: event.target.value })} placeholder="Ex.: pagamento realizado após o vencimento" /></label>
              <label className="block space-y-1.5 text-sm"><span className="font-medium">Plano de contas</span><Select value={adjustmentForm.accountPlanId || "none"} onValueChange={(accountPlanId) => setAdjustmentForm({ ...adjustmentForm, accountPlanId: accountPlanId === "none" ? "" : accountPlanId })}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="none">Classificação pendente</SelectItem>{chargeAccountPlans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectContent></Select></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm"><span className="font-medium">Área responsável</span><Input value={adjustmentForm.responsibleArea} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, responsibleArea: event.target.value })} /></label>
                <label className="space-y-1.5 text-sm"><span className="font-medium">Responsável</span><Input value={adjustmentForm.responsibleName} onChange={(event) => setAdjustmentForm({ ...adjustmentForm, responsibleName: event.target.value })} /></label>
              </div>
              {adjustmentError && <p className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{adjustmentError}</p>}
              <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={() => setEditingAdjustment(null)}>Cancelar</Button><Button type="button" disabled={savingAdjustment || adjustmentForm.reason.trim().length < 3} onClick={() => void saveAdjustment()}>{savingAdjustment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar classificação</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
