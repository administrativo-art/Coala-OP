"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ReceiptText, SearchCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/features/financial/lib/utils";
import type { FinancialObligationSummary } from "@/features/financial/obligations/types";
import {
  expenseNeedsImportedBankEvidence,
  expenseReconciliationSummary,
  resolveExpenseReconciliation,
  type ExpenseReconciliation,
  type ExpenseReconciliationSource,
} from "@/features/financial/obligations/expense-reconciliation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SourceSettlementNotice } from "./source-settlement-notice";
import type { SourceSettlement } from "../../lib/source-settlement";

type ExpenseSummarySource = ExpenseReconciliationSource & {
  sourceSettlement?: SourceSettlement & { closureId?: string };
  status?: string;
};

type SettlementResult = { summary: FinancialObligationSummary; reconciliation: ExpenseReconciliation };

type SettlementDetails = SettlementResult & {
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

function currencyFromCents(value: number | null | undefined) {
  return value == null ? "—" : formatCurrency(value / 100);
}

function statusCopy(
  summary: FinancialObligationSummary,
  reconciliation: ExpenseReconciliation,
  status: string | undefined,
) {
  if (status === "cancelled") return { label: "Cancelado", tone: "neutral" as const };
  if (reconciliation === "divergent") return { label: "Revisão necessária", tone: "warning" as const };
  if (reconciliation === "pending_document") return { label: "Pagamento confirmado · conferir despesa", tone: "warning" as const };
  if (reconciliation === "cash") return { label: "Pago em dinheiro", tone: "success" as const };
  if (summary.obligationStatus === "PARTIALLY_PAID") return { label: "Parcialmente pago", tone: "warning" as const };
  if (summary.obligationStatus === "PAID" || status === "paid") {
    if (reconciliation === "bank") return { label: "Pago e conciliado", tone: "success" as const };
    if (reconciliation === "reported") return { label: "Pago informado · aguardando extrato", tone: "reported" as const };
    return { label: "Pago · conciliação pendente", tone: "reported" as const };
  }
  return { label: "Em aberto", tone: "neutral" as const };
}

function adjustmentLabel(type: unknown) {
  return ({ INTEREST: "Juros", FINE: "Multa", DISCOUNT: "Desconto", ABATEMENT: "Abatimento", OTHER: "Outro ajuste" } as Record<string, string>)[String(type)] || "Ajuste";
}

export function ExpenseFinancialSummary({
  expense,
  compact = false,
}: {
  expense: ExpenseSummarySource;
  compact?: boolean;
}) {
  const { firebaseUser, permissions } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detailResult, setDetails] = useState<{ expense: ExpenseSummarySource; value: SettlementDetails } | null>(null);
  const [remoteResult, setRemoteResult] = useState<{ expense: ExpenseSummarySource; value: SettlementResult | null } | null>(null);
  const [error, setError] = useState("");
  const [editingAdjustment, setEditingAdjustment] = useState<Record<string, any> | null>(null);
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentForm | null>(null);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState("");
  const details = detailResult?.expense === expense ? detailResult.value : null;
  const remoteSettlement = remoteResult?.expense === expense ? remoteResult : null;
  const needsEvidence = !expense.sourceSettlement && expenseNeedsImportedBankEvidence(expense);

  useEffect(() => {
    if (!needsEvidence || !firebaseUser) return;
    const controller = new AbortController();

    const user = firebaseUser;

    async function load() {
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/financial/expenses/${encodeURIComponent(expense.id)}/settlement?summary=1`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Falha ao consultar a conciliação.");
        const value: SettlementResult = await response.json();
        if (!controller.signal.aborted) setRemoteResult({ expense, value });
      } catch {
        if (!controller.signal.aborted) setRemoteResult({ expense, value: null });
      }
    }

    void load();
    return () => controller.abort();
  }, [expense, needsEvidence, firebaseUser]);

  const result = details ?? remoteSettlement?.value;
  const reconciliation = result?.reconciliation ?? resolveExpenseReconciliation(expense);
  const summary = result?.summary ?? expenseReconciliationSummary(expense, reconciliation);
  const copy = needsEvidence && !result
    ? { label: remoteSettlement || !firebaseUser ? "Conciliação indisponível" : "Conferindo conciliação…", tone: "neutral" }
    : statusCopy(summary, reconciliation, expense.status);
  const variation = summary.forecastAmountCents == null || summary.actualAmountCents == null
    ? null
    : summary.actualAmountCents - summary.forecastAmountCents;
  const settlementAmountCents = summary.settlementAmountCents ?? summary.actualAmountCents;

  if (expense.sourceSettlement) return <SourceSettlementNotice source={expense.sourceSettlement} cancelled={expense.status === "cancelled"} />;

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
      if (!response.ok) throw new Error(payload.error?.message || "Falha ao consultar os detalhes.");
      setDetails({ expense, value: payload });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao consultar os detalhes.");
    } finally {
      setLoading(false);
    }
  }

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
      setDetails((current) => current?.expense === expense ? {
        expense,
        value: {
          ...current.value,
          adjustments: (current.value.adjustments || []).map((adjustment) => adjustment.id === payload.adjustment.id
            ? { ...adjustment, ...payload.adjustment }
            : adjustment),
        },
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
      <section
        className={cn(
          "rounded-xl border p-3",
          compact ? "border-[#eceadf] bg-white dark:border-border dark:bg-background" : "sm:col-span-3 bg-muted/20",
        )}
        aria-label="Pagamento da despesa"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pagamento</p>
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
            <SearchCheck className="mr-1.5 h-4 w-4" /> {compact ? "Detalhes" : "Ver detalhes"}
          </Button>
        </div>

        <div className={cn("mt-3 grid grid-cols-2 gap-2", !compact && "md:grid-cols-4")}>
          {[
            ["Provisionado", currencyFromCents(summary.forecastAmountCents)],
            ["Real", currencyFromCents(summary.actualAmountCents)],
            ["Saída financeira", currencyFromCents(summary.cashPaidAmountCents)],
            ["Saldo principal", currencyFromCents(summary.balanceAmountCents)],
          ].map(([label, value]) => (
            <div key={label} className={cn("rounded-xl border bg-background px-3 py-2.5", compact && "px-2.5 py-2")}>
              <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
              <p className={cn("mt-1 font-mono text-sm font-semibold", compact && "text-xs")}>{value}</p>
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
                  ["Provisionado", currencyFromCents(summary.forecastAmountCents)],
                  ["Real", currencyFromCents(summary.actualAmountCents)],
                  ["Líquido a pagar", currencyFromCents(summary.settlementAmountCents ?? summary.actualAmountCents)],
                  ["Principal liquidado", currencyFromCents(summary.principalSettledAmountCents)],
                  ["Total pago", currencyFromCents(summary.cashPaidAmountCents)],
                  ["Confirmado no banco", currencyFromCents(summary.confirmedCashAmountCents)],
                  ["Encargos", currencyFromCents(summary.cashChargesAmountCents)],
                  ["Créditos", currencyFromCents(summary.settlementCreditsAmountCents)],
                  ["Saldo", currencyFromCents(summary.balanceAmountCents)],
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
