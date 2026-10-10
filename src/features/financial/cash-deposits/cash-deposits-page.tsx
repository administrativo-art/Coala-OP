"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Barcode,
  Banknote,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Info,
  Loader2,
  Lock,
  Coins,
  RefreshCw,
  PackageCheck,
  XCircle,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/page-container";
import { PageHero } from "@/components/patterns/page-hero";
import { HeroChip } from "@/components/patterns/hero-chip";
import { formatBRL } from "../cash-closures/money";
import { CentsInput } from "../cash-closures/components/cents-input";
import type { InterCobrancaDocument } from "./inter-cobranca";
import {
  CASH_DEPOSIT_SOURCE_LABEL,
  cashDepositBatchReference,
  groupCashDepositItemsByDay,
} from "./references";
import type {
  CashCoinBalance,
  CashDepositAdjustment,
  CashDepositBatch,
  CashDepositBatchItem,
} from "./types";
import {
  CASH_COUNTING_COIN_VALUES_CENTS,
  CASH_COUNTING_DENOMINATION_VALUES_CENTS,
  CASH_COUNTING_NOTE_VALUES_CENTS,
  type CashCountingSession,
} from "../cash-counting-sessions/types";

const STATUS_LABEL: Record<CashDepositBatch["status"], string> = {
  open: "Aberto",
  locked: "Travado",
  issuing: "Em emissão",
  issued: "Emitido",
  paid: "Pago",
  cancelled: "Cancelado",
  failed: "Falha",
};

function statusBadgeClass(status: CashDepositBatch["status"]) {
  if (status === "paid") return "border-ds-border bg-ds-ok-bg text-ds-ok";
  if (status === "issued" || status === "issuing") return "border-ds-border bg-ds-info-bg text-ds-info";
  if (status === "failed" || status === "cancelled") return "border-ds-confirm-border bg-ds-danger-bg text-ds-danger";
  if (status === "locked") return "border-ds-alert-border bg-ds-warn-bg text-ds-alert-ink";
  return "border-ds-border bg-ds-ok-bg text-ds-ok";
}

function statusBarClass(status: CashDepositBatch["status"]) {
  if (status === "paid") return "bg-ds-ok";
  if (status === "issued" || status === "issuing") return "bg-ds-info";
  if (status === "failed" || status === "cancelled") return "bg-ds-danger";
  if (status === "open") return "bg-ds-ok";
  return "bg-ds-warn";
}

type InterReadiness = {
  ready: boolean;
  environment: "sandbox" | "production";
  reason: string | null;
  payer?: { name: string; cpfCnpj: string };
  issueSettings?: {
    dueBusinessDays: number;
    suggestedDueDates: Record<"1" | "2", string>;
  };
};

type DueChoice = "1" | "2" | "custom";

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 14
    ? digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : value;
}

function formatShortDate(value: string | undefined) {
  if (!value) return "—";
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function responseErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return fallback;
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

type DepositReport = {
  indicators: {
    approvedClosureCount: number;
    closedOnTimeCount: number;
    closedOnTimePercent: number;
    averageAbsoluteDivergenceCents: number;
    cashAwaitingDepositCents: number;
    averageSettlementHours: number | null;
  };
  reconciliationIssues: Array<{ code: string; message: string; batchId: string }>;
  issuedNotPaid: unknown[];
  openOrLockedBatches: unknown[];
};

function quantityRecord(values: readonly number[]) {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<number, number>;
}

function DenominationGrid({
  values,
  quantities,
  setQuantities,
  disabled = false,
}: {
  values: readonly number[];
  quantities: Record<number, number>;
  setQuantities: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  disabled?: boolean;
}) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{values.map((valueCents) => <label key={valueCents} className="rounded-xl border border-ds-border bg-ds-muted p-3 transition-colors focus-within:border-ds-accent-soft focus-within:bg-ds-accent-soft">
    <span className="block text-xs font-bold text-ds-ink-muted">{formatBRL(valueCents)}</span>
    <Input className="mt-2 bg-white" type="number" inputMode="numeric" min={0} step={1} disabled={disabled} value={quantities[valueCents] ?? 0} onChange={(event) => setQuantities((current) => ({ ...current, [valueCents]: Math.max(0, Number.parseInt(event.target.value || "0", 10) || 0) }))} />
    <span className="mt-1 block text-right font-mono text-xs text-ds-ink-faint">{formatBRL(valueCents * (quantities[valueCents] ?? 0))}</span>
  </label>)}</div>;
}

export function CashDepositsPage({ focusSessionId }: { focusSessionId?: string } = {}) {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [batches, setBatches] = useState<CashDepositBatch[]>([]);
  const [cobrancas, setCobrancas] = useState<InterCobrancaDocument[]>([]);
  const [adjustments, setAdjustments] = useState<CashDepositAdjustment[]>([]);
  const [coinBalances, setCoinBalances] = useState<CashCoinBalance[]>([]);
  const [countingSessions, setCountingSessions] = useState<CashCountingSession[]>([]);
  const [countingSessionsHasMore, setCountingSessionsHasMore] = useState(false);
  const [selectedCountingSession, setSelectedCountingSession] = useState<CashCountingSession | null>(null);
  const [quantities, setQuantities] = useState(() => quantityRecord(CASH_COUNTING_DENOMINATION_VALUES_CENTS));
  const [inter, setInter] = useState<InterReadiness>({ ready: false, environment: "sandbox", reason: "Verificando configuração..." });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<CashDepositBatch | null>(null);
  const [coinHoldCents, setCoinHoldCents] = useState<number | null>(0);
  const [exchangeBalance, setExchangeBalance] = useState<CashCoinBalance | null>(null);
  const [exchangeCents, setExchangeCents] = useState<number | null>(null);
  const [dueChoice, setDueChoice] = useState<DueChoice>("1");
  const [customDueDate, setCustomDueDate] = useState("");
  const [cancelBatch, setCancelBatch] = useState<CashDepositBatch | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [report, setReport] = useState<DepositReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(() => new Set());
  const [loadingBatchIds, setLoadingBatchIds] = useState<Set<string>>(() => new Set());
  const [batchItemsById, setBatchItemsById] = useState<Record<string, CashDepositBatchItem[]>>({});

  const authorizedFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    if (!firebaseUser) throw new Error("Sessão não encontrada.");
    return fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${await firebaseUser.getIdToken()}`,
      },
      cache: "no-store",
    });
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (focusSessionId) params.set("sessionId", focusSessionId);
      const response = await authorizedFetch(`/api/financial/cash-deposits${params.size > 0 ? `?${params}` : ""}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseErrorMessage(payload, "Falha ao carregar depósitos."));
      setBatches(payload.batches ?? []);
      setAdjustments(payload.adjustments ?? []);
      setCoinBalances(payload.coinBalances ?? []);
      const nextCountingSessions = (payload.countingSessions ?? []) as CashCountingSession[];
      setCountingSessions(nextCountingSessions);
      setCountingSessionsHasMore(payload.countingSessionsHasMore === true);
      setSelectedCountingSession((current) => {
        const preferredId = current?.id ?? focusSessionId;
        return nextCountingSessions.find((session) => session.id === preferredId) ?? null;
      });
      setCobrancas(payload.cobrancas ?? []);
      setInter(payload.inter ?? { ready: false, environment: "sandbox", reason: "Integração não configurada." });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch, firebaseUser, focusSessionId, toast]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const result = new Map<string, CashDepositBatch[]>();
    for (const batch of batches) {
      const key = batch.countingSessionId ? `session:${batch.countingSessionId}` : `unit:${batch.kioskId}`;
      result.set(key, [...(result.get(key) ?? []), batch]);
    }
    return [...result.entries()];
  }, [batches]);

  const cobrancaById = useMemo(
    () => new Map(cobrancas.map((cobranca) => [cobranca.id, cobranca])),
    [cobrancas],
  );

  const totals = useMemo(() => ({
    inBatches: batches.reduce((sum, batch) => sum + batch.totalCents, 0),
    coins: coinBalances.reduce((sum, balance) => sum + balance.pendingExchangeCents, 0),
    issued: batches.filter((batch) => ["issuing", "issued", "paid"].includes(batch.status)).reduce((sum, batch) => sum + batch.totalCents, 0),
    paid: batches.filter((batch) => batch.status === "paid").reduce((sum, batch) => sum + batch.totalCents, 0),
  }), [batches, coinBalances]);
  const denominationTotal = useMemo(
    () => CASH_COUNTING_DENOMINATION_VALUES_CENTS.reduce((total, value) => total + value * (quantities[value] ?? 0), 0),
    [quantities],
  );
  const denominationNoteTotal = useMemo(
    () => CASH_COUNTING_NOTE_VALUES_CENTS.reduce((total, value) => total + value * (quantities[value] ?? 0), 0),
    [quantities],
  );
  const denominationCoinTotal = denominationTotal - denominationNoteTotal;
  const selectedComposition = useMemo(
    () => groupCashDepositItemsByDay(selected ? batchItemsById[selected.id] ?? [] : []),
    [batchItemsById, selected],
  );

  const postAction = useCallback(async (path: string, body?: unknown) => {
    setSubmitting(true);
    try {
      const response = await authorizedFetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseErrorMessage(payload, "A operação não foi concluída."));
      await load();
      return payload;
    } finally {
      setSubmitting(false);
    }
  }, [authorizedFetch, load]);

  async function ensureBatchComposition(batch: CashDepositBatch) {
    if (!batchItemsById[batch.id]) {
      setLoadingBatchIds((current) => new Set(current).add(batch.id));
      try {
        const response = await authorizedFetch(`/api/financial/cash-deposits/${encodeURIComponent(batch.id)}`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseErrorMessage(payload, "Falha ao carregar a composição do depósito."));
        setBatchItemsById((current) => ({ ...current, [batch.id]: payload.items ?? [] }));
      } catch (error) {
        toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar composição." });
        return false;
      } finally {
        setLoadingBatchIds((current) => {
          const next = new Set(current);
          next.delete(batch.id);
          return next;
        });
      }
    }

    return true;
  }

  async function confirmCountingSessionPhysical() {
    if (!selectedCountingSession || !permissions.financial.cashDeposits.view || !permissions.financial.cashDeposits.issue) return;
    setSubmitting(true);
    try {
      await postAction(`/api/financial/cash-counting-sessions/${encodeURIComponent(selectedCountingSession.id)}/denominations`, {
        denominations: CASH_COUNTING_DENOMINATION_VALUES_CENTS.map((valueCents) => ({
          valueCents,
          quantity: quantities[valueCents] ?? 0,
        })),
      });
      toast({
        title: "Composição física confirmada",
        description: "As cédulas formaram os malotes e as moedas foram registradas como retorno ao caixa.",
      });
      setQuantities(quantityRecord(CASH_COUNTING_DENOMINATION_VALUES_CENTS));
      setSelectedCountingSession(null);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao confirmar a composição física." });
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleBatchComposition(batch: CashDepositBatch) {
    if (expandedBatchIds.has(batch.id)) {
      setExpandedBatchIds((current) => {
        const next = new Set(current);
        next.delete(batch.id);
        return next;
      });
      return;
    }

    if (!await ensureBatchComposition(batch)) return;

    setExpandedBatchIds((current) => new Set(current).add(batch.id));
  }

  async function prepareIssue(batch: CashDepositBatch) {
    setDueChoice("1");
    setCustomDueDate("");
    setCoinHoldCents(batch.coinHoldCents);
    setSelected(batch);
    await ensureBatchComposition(batch);
  }

  async function issueSelected() {
    if (!selected) return;
    if (dueChoice === "custom" && !customDueDate) {
      toast({ variant: "destructive", title: "Escolha a data de vencimento." });
      return;
    }
    try {
      const prepared = selected.countingSessionId
        ? { batch: selected }
        : await postAction(
          `/api/financial/cash-deposits/${encodeURIComponent(selected.id)}/coins`,
          { coinCents: coinHoldCents ?? 0 },
        );
      if (prepared.batch.totalCents === 0) {
        toast({
          title: "Moedas separadas para troca",
          description: "Não há cédulas neste bloco para emitir boleto agora.",
        });
        setSelected(null);
        return;
      }
      await postAction(`/api/financial/cash-deposits/${encodeURIComponent(selected.id)}/issue`, dueChoice === "custom"
        ? { dueDate: customDueDate }
        : { dueBusinessDays: Number(dueChoice) });
      toast({ title: "Boleto enviado ao Inter", description: "A situação foi confirmada por consulta ativa." });
      setSelected(null);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na emissão." });
    }
  }

  async function registerCoinExchange() {
    if (!exchangeBalance || !exchangeCents) return;
    try {
      await postAction("/api/financial/cash-deposits/coins/exchange", {
        kioskId: exchangeBalance.kioskId,
        amountCents: exchangeCents,
        operationId: crypto.randomUUID(),
      });
      toast({
        title: "Troca registrada",
        description: "As cédulas entraram no próximo bloco de depósito.",
      });
      setExchangeBalance(null);
      setExchangeCents(null);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao registrar troca." });
    }
  }

  async function refreshBatch(batch: CashDepositBatch) {
    try {
      await postAction(`/api/financial/cash-deposits/${encodeURIComponent(batch.id)}/refresh`);
      toast({ title: "Situação atualizada" });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na consulta." });
    }
  }

  async function cancelSelected() {
    if (!cancelBatch) return;
    try {
      await postAction(`/api/financial/cash-deposits/${encodeURIComponent(cancelBatch.id)}/cancel`, { reason: cancelReason });
      toast({ title: "Cancelamento processado", description: "A situação final foi confirmada por consulta ativa." });
      setCancelBatch(null);
      setCancelReason("");
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha no cancelamento." });
    }
  }

  async function openPdf(batch: CashDepositBatch) {
    try {
      const response = await authorizedFetch(`/api/financial/cash-deposits/${encodeURIComponent(batch.id)}/pdf`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "PDF indisponível.");
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao abrir PDF." });
    }
  }

  async function loadReport() {
    setReportLoading(true);
    try {
      const response = await authorizedFetch("/api/financial/cash-deposits/reports");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao gerar relatório.");
      setReport(payload);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha no relatório." });
    } finally {
      setReportLoading(false);
    }
  }

  async function processAdjustments() {
    setSubmitting(true);
    try {
      const kioskIds = Array.from(new Set(adjustments.map((adjustment) => adjustment.kioskId)));
      for (const kioskId of kioskIds) {
        const response = await authorizedFetch("/api/financial/cash-deposits/adjustments/allocate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kioskId }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Falha ao processar ajustes.");
      }
      await load();
      toast({ title: "Fila de ajustes processada" });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao processar ajustes." });
    } finally {
      setSubmitting(false);
    }
  }

  async function exportReport() {
    try {
      const response = await authorizedFetch("/api/financial/cash-deposits/reports/export");
      if (!response.ok) throw new Error("Falha ao exportar relatório.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "relatorio-depositos.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na exportação." });
    }
  }

  if (!permissions.financial?.cashDeposits?.view) {
    return <PageContainer variant="compact" surface><div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso aos depósitos em dinheiro.</div></PageContainer>;
  }

  return <PageContainer variant="wide" surface className="space-y-6 pb-10">
    <PageHero
      kicker="Financeiro · Controle de caixa"
      title="Depósitos em dinheiro"
      subtitle="Composição física, emissão de boletos e troca de moedas."
      chips={<>
        <HeroChip value={formatBRL(totals.inBatches)} label="Cédulas em blocos" />
        <HeroChip value={formatBRL(totals.coins)} label="Moedas aguardando troca" tone="warning" />
        <HeroChip value={formatBRL(totals.issued)} label="Emitido (boleto)" tone="info" />
        <HeroChip value={formatBRL(totals.paid)} label="Pago / depositado" />
      </>}
      actions={<>
        <Button variant="on-dark-secondary" size="md" onClick={() => void loadReport()} disabled={reportLoading}>
          {reportLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Relatórios
        </Button>
        <Button variant="on-dark-secondary" size="md" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />Atualizar</Button>
      </>}
    />

    {!inter.ready && <div className="flex w-full items-start gap-3 rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink">
      <Info className="h-4 w-4 shrink-0" />
      <span>
        <strong>Inter em configuração.</strong>{" "}
        A emissão de boletos ficará disponível após configurar a integração.
      </span>
    </div>}

    {permissions.financial.cashDeposits.view && permissions.financial.cashDeposits.issue && countingSessions.length > 0 && <Card className="overflow-hidden rounded-2xl border-ds-accent-soft shadow-sm">
      <CardHeader className="border-b border-ds-accent-soft bg-gradient-to-r from-pink-50 via-white to-emerald-50/50">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-lg"><Banknote className="h-5 w-5 text-ds-accent-ink" />Sessões aguardando composição física</CardTitle><p className="mt-1 text-sm text-ds-ink-muted">Informe as quantidades reais. Somente cédulas formarão os malotes de depósito.</p></div><Badge variant="outline" className="border-ds-accent-soft bg-white text-ds-accent-ink">{countingSessions.length} pendente(s)</Badge></div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-6">
        {countingSessionsHasMore && <div className="rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink">A fila possui mais de 50 sessões. As mais antigas são exibidas primeiro; ao concluir uma, a próxima aparecerá automaticamente.</div>}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{countingSessions.map((session) => <button key={session.id} type="button" onClick={() => { setSelectedCountingSession(session); setQuantities(quantityRecord(CASH_COUNTING_DENOMINATION_VALUES_CENTS)); }} className={cn("rounded-xl border p-3 text-left transition-all motion-reduce:transform-none motion-reduce:transition-none", selectedCountingSession?.id === session.id ? "border-ds-accent-soft bg-ds-accent-soft ring-2 ring-ds-accent" : "border-ds-border hover:-translate-y-0.5 hover:border-ds-accent-soft hover:shadow-sm")}><strong className="block truncate text-sm">{session.kioskNames.join(" · ")}</strong><span className="mt-1 block text-xs text-ds-ink-muted">{session.finalizedOperatorCount} operador(es) · {formatBRL(session.depositEligibleCents)}</span></button>)}</div>

        <Dialog open={selectedCountingSession !== null} onOpenChange={(open) => { if (!open) setSelectedCountingSession(null); }}>
          <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[960px] sm:p-0">
            <DialogHeader className="border-b border-ds-border px-6 py-5 text-left">
              <DialogTitle className="text-lg font-bold tracking-tight">Composição física do malote</DialogTitle>
              <DialogDescription className="mt-1 leading-5">{selectedCountingSession?.kioskNames.join(" · ")} · informe as cédulas e moedas contadas para gerar os malotes.</DialogDescription>
            </DialogHeader>
            {selectedCountingSession && <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="rounded-xl border border-ds-border bg-ds-info-bg px-4 py-3 text-sm font-semibold text-ds-info">As cédulas formarão os malotes enviados ao banco; as moedas retornam ao caixa e ficam aguardando troca.</div>
              <div className="rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink"><strong>Conciliação obrigatória:</strong> cédulas + moedas precisam totalizar {formatBRL(selectedCountingSession.depositEligibleCents)}.</div>
              <div className="grid gap-4 lg:grid-cols-2"><div><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Cédulas</p><strong className="font-mono text-sm text-ds-ok">{formatBRL(denominationNoteTotal)}</strong></div><DenominationGrid values={CASH_COUNTING_NOTE_VALUES_CENTS} quantities={quantities} setQuantities={setQuantities} disabled={submitting} /></div><div><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Moedas</p><strong className="font-mono text-sm text-ds-warn">{formatBRL(denominationCoinTotal)}</strong></div><DenominationGrid values={CASH_COUNTING_COIN_VALUES_CENTS} quantities={quantities} setQuantities={setQuantities} disabled={submitting} /></div></div>
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-ds-border bg-ds-muted p-4"><span className="block text-xs font-bold text-ds-ink-muted">Valor esperado</span><strong className="mt-1 block font-mono text-lg">{formatBRL(selectedCountingSession.depositEligibleCents)}</strong></div><div className="rounded-xl border border-ds-border bg-white p-4"><span className="block text-xs font-bold text-ds-ink-muted">Total físico</span><strong className="mt-1 block font-mono text-lg">{formatBRL(denominationTotal)}</strong></div><div className={cn("rounded-xl border p-4", denominationTotal === selectedCountingSession.depositEligibleCents ? "border-ds-border bg-ds-ok-bg text-ds-ok" : denominationTotal > selectedCountingSession.depositEligibleCents ? "border-ds-border bg-ds-info-bg text-ds-info" : "border-ds-confirm-border bg-ds-danger-bg text-ds-confirm-ink")}><span className="block text-xs font-bold opacity-80">Diferença</span><strong className="mt-1 block font-mono text-lg">{denominationTotal === selectedCountingSession.depositEligibleCents ? formatBRL(0) : `${denominationTotal > selectedCountingSession.depositEligibleCents ? "+" : "−"} ${formatBRL(Math.abs(selectedCountingSession.depositEligibleCents - denominationTotal))}`}</strong></div></div>
            </div>}
            {selectedCountingSession && <DialogFooter className="flex-col items-stretch gap-3 border-t border-ds-border bg-ds-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><span className={cn("text-sm font-bold", denominationTotal === selectedCountingSession.depositEligibleCents ? "text-ds-ok" : "text-ds-warn")}>{denominationTotal === selectedCountingSession.depositEligibleCents ? "Total físico igual ao valor esperado." : "A confirmação só é liberada quando os totais forem iguais."}</span><div className="flex gap-2"><Button variant="outline" onClick={() => setSelectedCountingSession(null)}>Cancelar</Button><Button className="bg-ds-accent font-bold hover:bg-ds-accent-hover" disabled={submitting || denominationTotal !== selectedCountingSession.depositEligibleCents} onClick={() => void confirmCountingSessionPhysical()}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}Confirmar e criar malotes</Button></div></DialogFooter>}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>}

    {coinBalances.some((balance) => balance.pendingExchangeCents > 0) && <Card className="rounded-2xl border-ds-alert-border bg-ds-warn-bg">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Coins className="h-5 w-5 text-ds-warn" />Moedas aguardando troca por cédulas</CardTitle></CardHeader>
      <CardContent className="grid gap-2 pb-4">
        {coinBalances.filter((balance) => balance.pendingExchangeCents > 0).map((balance) => <div key={balance.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ds-alert-border bg-white px-4 py-3">
          <div><p className="text-sm font-bold">{balance.kioskName}</p><p className="text-xs text-ds-ink-muted">As moedas permanecem pendentes até a troca física por cédulas.</p></div>
          <div className="flex items-center gap-3"><strong className="font-mono text-base text-ds-alert-ink">{formatBRL(balance.pendingExchangeCents)}</strong>{permissions.financial.cashDeposits.adjust && <Button size="sm" variant="outline" onClick={() => { setExchangeBalance(balance); setExchangeCents(balance.pendingExchangeCents); }}>Registrar troca</Button>}</div>
        </div>)}
      </CardContent>
    </Card>}

    {adjustments.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink">
      <div className="flex items-center gap-3"><AlertTriangle className="h-4 w-4 shrink-0" /><span><strong>{adjustments.length} ajuste(s) aguardando alocação.</strong>
      {adjustments.some((item) => Date.now() - new Date(item.createdAt).getTime() > 15 * 86_400_000) && <span> Há ajustes pendentes há mais de 15 dias.</span>}</span></div>
      {permissions.financial.cashDeposits.adjust && <Button size="sm" variant="outline" className="border-ds-alert-border bg-white font-bold text-ds-alert-ink" onClick={() => void processAdjustments()} disabled={submitting}>Realocar</Button>}
    </div>}

    {report && <Card>
      <CardHeader className="pb-3"><div className="flex items-center justify-between gap-3"><CardTitle className="text-base">Indicadores e reconciliação</CardTitle><Button size="sm" variant="outline" onClick={() => void exportReport()}><Download className="mr-2 h-4 w-4" />CSV</Button></div></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Fechados no prazo" value={`${report.indicators.closedOnTimePercent}%`} />
          <Metric label="Divergência média" value={formatBRL(report.indicators.averageAbsoluteDivergenceCents)} />
          <Metric label="Aguardando depósito" value={formatBRL(report.indicators.cashAwaitingDepositCents)} />
          <Metric label="Tempo até liquidação" value={report.indicators.averageSettlementHours === null ? "—" : `${report.indicators.averageSettlementHours}h`} />
        </div>
        {report.reconciliationIssues.length > 0
          ? <div className="rounded-lg border border-ds-confirm-border bg-ds-danger-bg p-3 text-sm text-ds-confirm-ink"><strong>{report.reconciliationIssues.length} inconsistência(s) encontrada(s).</strong> Exporte o CSV para os detalhes.</div>
          : <div className="rounded-lg border border-ds-border bg-ds-ok-bg p-3 text-sm text-ds-ok">Reconciliação fechamento × depósito sem inconsistências.</div>}
      </CardContent>
    </Card>}

    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
      : groups.length === 0 ? <Card className="rounded-2xl border-ds-border shadow-sm"><CardContent className="flex min-h-24 items-center justify-center px-6 !py-6 text-center text-sm text-muted-foreground">Nenhum bloco foi formado. Eles aparecerão após a aprovação de fechamentos com dinheiro contado.</CardContent></Card>
        : <div className="space-y-6">{groups.map(([groupKey, items]) => <section key={groupKey} className="space-y-3">
          <div><h2 className="text-base font-bold">{items[0].countingSessionId ? "Sessão de contagem" : items[0].kioskName}</h2><p className="mt-1 text-xs text-muted-foreground">{items[0].countingSessionId ? <Link className="font-semibold text-ds-accent-ink hover:underline" href={`/dashboard/financial/cash-closures/sessions/${items[0].countingSessionId}`}>{items[0].kioskNames?.join(" · ")} · sessão {items[0].countingSessionId.slice(0, 8)}</Link> : items[0].kioskId}</p></div>
          <div className="space-y-3.5">{items.map((batch) => {
            const cobranca = batch.interCobrancaId ? cobrancaById.get(batch.interCobrancaId) : null;
            const canIssue = ["open", "locked", "failed", "cancelled"].includes(batch.status);
            const reference = cashDepositBatchReference(batch);
            const expanded = expandedBatchIds.has(batch.id);
            const compositionLoading = loadingBatchIds.has(batch.id);
            const dayComposition = groupCashDepositItemsByDay(batchItemsById[batch.id] ?? []);
            return <Card key={batch.id} id={`deposit-${batch.id}`} className={cn("relative scroll-mt-24 overflow-hidden rounded-2xl border-ds-border shadow-sm target:ring-2 target:ring-ds-ok target:ring-offset-2", "before:absolute before:inset-y-0 before:left-0 before:w-1.5", batch.status === "open" ? "before:bg-ds-ok" : batch.status === "locked" ? "before:bg-ds-warn" : ["issued", "issuing"].includes(batch.status) ? "before:bg-ds-info" : batch.status === "paid" ? "before:bg-ds-ok" : "before:bg-ds-danger") }>
              <CardHeader className="px-6 pb-2 pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><CardTitle className="text-base font-bold">{batch.countingSessionId ? "Malote" : "Bloco"} #{batch.sequence}</CardTitle><Badge variant="outline" className={cn("rounded-full px-3 py-1 text-[11px] font-bold", statusBadgeClass(batch.status))}>{STATUS_LABEL[batch.status]}</Badge><span className="font-mono text-[11px] font-bold text-muted-foreground">{reference}</span></div><div className="flex items-center gap-3"><strong className="font-mono text-base">{formatBRL(batch.totalCents)} <span className="text-sm font-semibold text-muted-foreground">/ {formatBRL(batch.maxCents)}</span></strong>{canIssue && <Button size="sm" variant={batch.status === "open" ? "default" : "outline"} className={cn("h-9 rounded-[11px] text-[13px] font-extrabold", batch.status === "open" && "bg-ds-accent text-white hover:bg-ds-accent-hover")} onClick={() => void prepareIssue(batch)} disabled={!permissions.financial.cashDeposits.issue}><Barcode className="mr-2 h-4 w-4" />{["failed", "cancelled"].includes(batch.status) ? "Reemitir boleto" : "Preparar emissão"}</Button>}</div></div></CardHeader>
              <CardContent className="space-y-3 px-6 pb-5">
                <div><div className="h-2 overflow-hidden rounded-full bg-ds-muted"><div className={cn("h-full rounded-full", statusBarClass(batch.status))} style={{ width: `${Math.min(100, (batch.totalCents / batch.maxCents) * 100)}%` }} /></div><p className="mt-2 text-xs font-semibold text-muted-foreground">{batch.status === "paid" ? `Liquidado em ${batch.paidAt ? new Date(batch.paidAt).toLocaleDateString("pt-BR") : "data registrada"}` : `Ainda cabem ${formatBRL(batch.remainingCapacityCents)} antes do limite`}</p></div>
                {batch.coinPreparedAt && <div className="grid gap-2 rounded-xl border border-ds-alert-border bg-ds-warn-bg p-3 text-xs sm:grid-cols-3"><div><span className="block text-ds-ink-muted">Dinheiro físico</span><strong>{formatBRL(batch.grossTotalCents)}</strong></div><div><span className="block text-ds-ink-muted">Moedas para troca</span><strong className="text-ds-alert-ink">− {formatBRL(batch.coinHoldCents)}</strong></div><div><span className="block text-ds-ink-muted">Cédulas no boleto</span><strong>{formatBRL(batch.totalCents)}</strong></div></div>}
                {batch.lockReason === "next_item_would_exceed_limit" && <div className="flex gap-2 rounded-lg bg-ds-warn-bg p-3 text-xs text-ds-alert-ink"><Lock className="h-4 w-4 shrink-0" /><span>Travado porque o próximo fechamento de {formatBRL(batch.nextRejectedCents ?? 0)} ultrapassaria o limite.</span></div>}
                {cobranca && <div className="rounded-xl border border-ds-border bg-ds-info-bg p-3 text-xs"><div className="flex flex-wrap justify-between gap-3"><span className="text-ds-ink-muted">Inter: <strong className="text-ds-ink-2">{cobranca.situacao ?? cobranca.status}</strong></span><span className="text-ds-ink-muted">Referência bancária: <strong className="font-mono text-ds-ink-2">{cobranca.seuNumero}</strong></span><span className="text-ds-ink-muted">Vencimento: <strong className="text-ds-ink-2">{cobranca.dataVencimento.split("-").reverse().join("/")}</strong></span></div>{cobranca.linhaDigitavel && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ds-border pt-3"><div className="min-w-0 flex-1"><p className="text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Linha digitável</p><p className="truncate font-mono text-xs font-bold text-ds-ink-2">{cobranca.linhaDigitavel}</p></div><Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => void navigator.clipboard.writeText(cobranca.linhaDigitavel ?? "")}><Copy className="mr-1.5 h-3.5 w-3.5" />Copiar</Button></div>}{cobranca.codigoSolicitacao && <p className="mt-2 text-muted-foreground">Código da solicitação: <span className="font-mono">{cobranca.codigoSolicitacao}</span></p>}{cobranca.recebidoManual && <p className="mt-2 text-ds-alert-ink">Marcado recebido manualmente; não tratado como liquidação bancária.</p>}{batch.ledgerTransactionId && <p className="mt-2 font-semibold text-ds-ok">Entrada bancária registrada no financeiro.</p>}{batch.bankWarning && <p className="mt-2 text-ds-alert-ink">{batch.bankWarning}</p>}</div>}
                <div className="overflow-hidden rounded-xl border border-ds-border">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-between rounded-none px-3 py-2.5 text-xs font-bold"
                    onClick={() => void toggleBatchComposition(batch)}
                    disabled={compositionLoading}
                  >
                    <span>{compositionLoading ? "Carregando composição..." : batch.countingSessionId ? "Composição do malote" : `Dias e valores (${batch.dates.length})`}</span>
                    {compositionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                  {expanded && <div className="space-y-2 border-t p-3">
                    {dayComposition.length === 0
                      ? <p className="text-xs text-muted-foreground">Nenhum item encontrado neste bloco.</p>
                      : dayComposition.map((day) => {
                        const [year, month, dayOfMonth] = day.date.split("-");
                        const closureHref = `/dashboard/financial/cash-closures/${encodeURIComponent(batch.kioskId)}/${year}/${month}/${dayOfMonth}`;
                        const hasClosure = day.sources.some((source) => ["cash_counted", "cash_adjustment", "manual_split"].includes(source));
                        return <div key={day.date} className="grid gap-2 rounded-lg bg-ds-muted p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <div>
                            {hasClosure ? <Link href={closureHref} className="text-sm font-semibold text-ds-ok hover:underline">{day.date.split("-").reverse().join("/")}</Link> : <span className="text-sm font-semibold text-ds-ink-2">{day.date.split("-").reverse().join("/")}</span>}
                            <p className="mt-1 text-xs text-muted-foreground">{day.sources.map((source) => CASH_DEPOSIT_SOURCE_LABEL[source]).join(" + ")}{day.itemCount > 1 ? ` · ${day.itemCount} lançamentos` : ""}</p>
                          </div>
                          <strong className="text-sm tabular-nums sm:text-right">{formatBRL(day.amountCents)}</strong>
                        </div>;
                      })}
                    <div className="flex items-center justify-between border-t pt-2 text-sm"><span className="font-semibold">Total do depósito</span><strong>{formatBRL(dayComposition.reduce((total, day) => total + day.amountCents, 0))}</strong></div>
                  </div>}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {cobranca?.codigoSolicitacao && <Button size="sm" variant="outline" onClick={() => void refreshBatch(batch)} disabled={submitting}><RefreshCw className="mr-2 h-4 w-4" />Consultar</Button>}
                  {cobranca?.codigoSolicitacao && ["issued", "paid", "marked_received"].includes(cobranca.status) && <Button size="sm" variant="outline" onClick={() => void openPdf(batch)}><FileText className="mr-2 h-4 w-4" />PDF</Button>}
                  {cobranca?.codigoSolicitacao && ["requested", "issued", "marked_received"].includes(cobranca.status) && permissions.financial.cashDeposits.cancel && <Button size="sm" variant="outline" onClick={() => setCancelBatch(batch)}><XCircle className="mr-2 h-4 w-4" />Cancelar</Button>}
                </div>
              </CardContent>
            </Card>;
          })}</div>
        </section>)}</div>}

    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:max-h-none sm:w-full sm:max-w-[520px] sm:translate-x-0 sm:translate-y-0 sm:rounded-l-2xl sm:rounded-r-none sm:p-0">
        <DialogHeader className="border-b border-ds-border px-6 py-5 text-left">
          <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-ds-info-bg"><Barcode className="h-5 w-5 text-ds-info" /></span><div><DialogTitle className="text-lg font-bold tracking-tight">{selected && ["failed", "cancelled"].includes(selected.status) ? "Reemitir boleto" : "Emitir boleto"}</DialogTitle><DialogDescription className="mt-1">Bloco #{selected?.sequence} · {selected?.kioskName}</DialogDescription></div></div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {!selected?.countingSessionId && <div className="flex gap-3 rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm leading-5 text-ds-alert-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Informe o total de moedas físicas, incluindo <strong>todas as moedas de R$ 1 e de centavos</strong>. O sistema não tenta inferir esse valor pelas denominações de cédulas.</span></div>}
          {!selected?.countingSessionId ? <div className="grid gap-3 rounded-xl border border-ds-border bg-ds-muted p-4 sm:grid-cols-3">
            <div><span className="text-[11px] text-ds-ink-muted">Dinheiro físico</span><strong className="mt-1 block font-mono">{formatBRL(selected?.grossTotalCents ?? 0)}</strong></div>
            <div><span className="text-[11px] text-ds-ink-muted">Moedas para troca</span><CentsInput value={coinHoldCents} onChange={setCoinHoldCents} ariaLabel="Valor total de moedas separado para troca" className="mt-1 h-9 bg-white font-mono" /></div>
            <div><span className="text-[11px] text-ds-ink-muted">Cédulas no boleto</span><strong className={cn("mt-1 block font-mono", (coinHoldCents ?? 0) > (selected?.grossTotalCents ?? 0) && "text-ds-danger")}>{formatBRL(Math.max(0, (selected?.grossTotalCents ?? 0) - (coinHoldCents ?? 0)))}</strong></div>
          </div> : <div className="rounded-xl border border-ds-border bg-ds-ok-bg p-4 text-sm text-ds-ok"><strong>Composição física já confirmada na sessão.</strong><p className="mt-1 text-xs">Este malote contém apenas cédulas; as moedas foram registradas como retorno ao caixa.</p></div>}
          <div><p className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Pagador</p><div className="rounded-lg border border-ds-border bg-ds-muted px-3 py-2.5 text-sm font-semibold text-ds-ink-2">{inter.payer ? `${inter.payer.name} · ${formatCnpj(inter.payer.cpfCnpj)}` : "Pagador institucional configurado"}</div></div>
          <div><p className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Vencimento</p><div className="grid grid-cols-3 gap-2"><Button type="button" variant="outline" className={cn("h-10 rounded-lg text-xs font-bold", dueChoice === "1" && "border-ds-accent-soft bg-ds-accent-soft text-ds-accent-ink hover:bg-ds-accent-soft")} onClick={() => setDueChoice("1")}>D+1 · {formatShortDate(inter.issueSettings?.suggestedDueDates["1"])}</Button><Button type="button" variant="outline" className={cn("h-10 rounded-lg text-xs font-bold", dueChoice === "2" && "border-ds-accent-soft bg-ds-accent-soft text-ds-accent-ink hover:bg-ds-accent-soft")} onClick={() => setDueChoice("2")}>D+2 · {formatShortDate(inter.issueSettings?.suggestedDueDates["2"])}</Button><Button type="button" variant="outline" className={cn("h-10 rounded-lg text-xs font-bold", dueChoice === "custom" && "border-ds-accent-soft bg-ds-accent-soft text-ds-accent-ink hover:bg-ds-accent-soft")} onClick={() => setDueChoice("custom")}>Escolher</Button></div>{dueChoice === "custom" && <input type="date" value={customDueDate} onChange={(event) => setCustomDueDate(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-ds-border bg-white px-3 text-sm outline-none focus:border-ds-accent-soft focus:ring-2 focus:ring-ds-accent" />}</div>
          <div className="rounded-xl border border-ds-border bg-ds-muted p-4"><p className="mb-2 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">{selected?.countingSessionId ? "Cédulas do malote" : `${selected?.dates.length ?? 0} dias neste bloco`}</p><div className="flex flex-wrap gap-1.5">{selected?.countingSessionId ? selected.denominations?.filter((item) => item.quantity > 0).map((item) => <span key={item.valueCents} className="inline-flex h-6 items-center rounded-full border border-ds-border bg-white px-2.5 text-[11px] font-semibold text-ds-ink-muted">{item.quantity}× {formatBRL(item.valueCents)}</span>) : loadingBatchIds.has(selected?.id ?? "") ? <Loader2 className="h-4 w-4 animate-spin text-ds-ink-faint" /> : selectedComposition.length > 0 ? selectedComposition.map((day) => <span key={day.date} className="inline-flex h-6 items-center rounded-full border border-ds-border bg-white px-2.5 text-[11px] font-semibold text-ds-ink-muted">{day.date.slice(5).split("-").reverse().join("/")} · {formatBRL(day.amountCents)}</span>) : selected?.dates.map((date) => <span key={date} className="inline-flex h-6 items-center rounded-full border border-ds-border bg-white px-2.5 text-[11px] font-semibold text-ds-ink-muted">{date.slice(5).split("-").reverse().join("/")}</span>)}</div></div>
          {!inter.ready && <div className="rounded-lg border border-ds-alert-border bg-ds-warn-bg p-3 text-sm text-ds-alert-ink">{inter.reason}</div>}
        </div>
        <DialogFooter className="border-t border-ds-border px-6 py-4"><Button variant="outline" className="rounded-lg" onClick={() => setSelected(null)}>Cancelar</Button><Button className="rounded-lg bg-ds-accent font-bold text-white hover:bg-ds-accent-hover" onClick={() => void issueSelected()} disabled={(!selected?.countingSessionId && (selected?.grossTotalCents ?? 0) !== (coinHoldCents ?? 0) && !inter.ready) || (selected?.countingSessionId && !inter.ready) || submitting || (!selected?.countingSessionId && (coinHoldCents ?? 0) > (selected?.grossTotalCents ?? 0)) || (dueChoice === "custom" && !customDueDate)}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : !selected?.countingSessionId && (coinHoldCents ?? 0) === (selected?.grossTotalCents ?? 0) ? <Coins className="mr-2 h-4 w-4" /> : <Barcode className="mr-2 h-4 w-4" />}{!selected?.countingSessionId && (coinHoldCents ?? 0) === (selected?.grossTotalCents ?? 0) ? "Separar moedas" : "Emitir boleto"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={exchangeBalance !== null} onOpenChange={(open) => { if (!open) { setExchangeBalance(null); setExchangeCents(null); } }}>
      <DialogContent className="rounded-2xl sm:max-w-[460px]">
        <DialogHeader><DialogTitle>Registrar troca por cédulas</DialogTitle><DialogDescription>Registre somente depois da troca física. O valor entrará automaticamente no próximo bloco de depósito.</DialogDescription></DialogHeader>
        {exchangeBalance && <div className="space-y-4"><div className="flex items-center justify-between rounded-xl bg-ds-warn-bg p-3 text-sm"><span>Moedas pendentes em {exchangeBalance.kioskName}</span><strong>{formatBRL(exchangeBalance.pendingExchangeCents)}</strong></div><div><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ds-ink-muted">Valor trocado</p><CentsInput value={exchangeCents} onChange={setExchangeCents} ariaLabel="Valor de moedas trocado por cédulas" /></div></div>}
        <DialogFooter><Button variant="outline" onClick={() => setExchangeBalance(null)}>Cancelar</Button><Button onClick={() => void registerCoinExchange()} disabled={submitting || !exchangeCents || exchangeCents > (exchangeBalance?.pendingExchangeCents ?? 0)}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar troca física</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={cancelBatch !== null} onOpenChange={(open) => { if (!open) { setCancelBatch(null); setCancelReason(""); } }}>
      <DialogContent className="rounded-2xl sm:max-w-[460px]">
        <DialogHeader><DialogTitle>Cancelar boleto Inter</DialogTitle><DialogDescription>O motivo é obrigatório e será enviado ao banco. Se o boleto já tiver sido pago, a consulta ativa prevalece e o bloco será marcado como depositado.</DialogDescription></DialogHeader>
        <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value.slice(0, 50))} placeholder="Motivo do cancelamento" />
        <p className="text-right text-xs text-muted-foreground">{cancelReason.length}/50</p>
        <DialogFooter><Button variant="outline" onClick={() => setCancelBatch(null)}>Voltar</Button><Button variant="destructive" onClick={() => void cancelSelected()} disabled={!cancelReason.trim() || submitting}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cancelar boleto</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </PageContainer>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>;
}
