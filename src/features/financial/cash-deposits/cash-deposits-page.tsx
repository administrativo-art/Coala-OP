"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Barcode,
  Check,
  Banknote,
  CalendarDays,
  CheckCircle2,
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
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { PanelField, PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { LiftRow } from "@/components/patterns/lift-row";
import { formatBRL } from "../cash-closures/money";
import { CentsInput } from "../cash-closures/components/cents-input";
import type { InterCobrancaDocument } from "./inter-cobranca";
import {
  CASH_DEPOSIT_SOURCE_LABEL,
  cashDepositBatchReference,
  cashDepositDenominationRows,
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

function statusPillVariant(status: CashDepositBatch["status"]): StatusPillVariant {
  if (status === "paid") return "ok";
  if (status === "issued" || status === "issuing") return "info";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "locked") return "warn";
  return "neutral";
}

const BATCH_STEPS = ["Formado", "Travado", "Boleto emitido", "Pago"] as const;

function batchStepIndex(status: CashDepositBatch["status"]) {
  if (status === "open") return 0;
  if (status === "locked") return 1;
  if (status === "paid") return 3;
  return 2;
}

/** Trilho das etapas do malote: o que já passou, onde está e o que falta. */
function BatchSteps({ status }: { status: CashDepositBatch["status"] }) {
  const current = batchStepIndex(status);
  const failed = status === "failed" || status === "cancelled";
  return <ol aria-label="Etapas do malote" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] font-bold sm:flex-nowrap sm:whitespace-nowrap">
    {BATCH_STEPS.map((label, index) => {
      const done = index < current || status === "paid";
      const active = index === current && status !== "paid";
      const text = active && failed ? (status === "failed" ? "Falha na emissão" : "Boleto cancelado") : label;
      return <li key={label} aria-current={active ? "step" : undefined} className="flex items-center gap-1.5">
        {index > 0 && <span aria-hidden="true" className={cn("h-px w-4", done || active ? "bg-ds-ok" : "bg-ds-border")} />}
        <span className={cn("grid h-4 w-4 place-items-center rounded-full", done ? "bg-ds-ok text-white" : active ? (failed ? "bg-ds-danger text-white" : "bg-ds-dark text-white") : "border border-ds-border bg-white")}>{done ? <Check aria-hidden="true" className="h-2.5 w-2.5" strokeWidth={3} /> : active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}</span>
        <span className={cn(done ? "text-ds-ok" : active ? (failed ? "text-ds-danger" : "text-ds-ink") : "text-ds-ink-faint")}>{text}</span>
      </li>;
    })}
  </ol>;
}

const BATCH_STAGES: { key: string; title: string; empty: string; statuses: CashDepositBatch["status"][] }[] = [
  { key: "awaiting", title: "Aguardando boleto", empty: "Nenhum malote aguardando boleto.", statuses: ["failed", "cancelled", "locked", "open"] },
  { key: "issued", title: "Boleto emitido", empty: "Nenhum boleto aguardando pagamento.", statuses: ["issuing", "issued"] },
  { key: "paid", title: "Pago", empty: "Nenhum malote pago ainda.", statuses: ["paid"] },
];

const INTER_STATUS_LABEL: Record<string, string> = {
  requested: "Solicitado",
  issued: "Emitido",
  paid: "Pago",
  marked_received: "Marcado recebido",
  cancelled: "Cancelado",
  failed: "Falha",
};

function formatDateKey(value: string) {
  return value.split("-").reverse().join("/");
}

function batchKioskLabel(batch: CashDepositBatch) {
  return batch.kioskNames?.length ? batch.kioskNames.join(" · ") : batch.kioskName;
}

function batchDatesLabel(batch: CashDepositBatch) {
  const dates = [...batch.dates].sort();
  if (dates.length === 0) return batch.countingSessionId ? "Sessão de contagem" : "Sem dias";
  if (batch.countingSessionId) return `Contagem de ${dates.map(formatDateKey).join(", ")}`;
  if (dates.length === 1) return formatDateKey(dates[0]);
  return `${formatDateKey(dates[0])} a ${formatDateKey(dates[dates.length - 1])} · ${dates.length} dias`;
}

/** Uma frase do que acontece agora com o malote, para a linha da lista. */
function batchHint(batch: CashDepositBatch, cobranca: InterCobrancaDocument | null | undefined): { text: string; tone: "danger" | "action" | "muted" } {
  if (batch.status === "failed") return { text: batch.bankWarning ?? "Falha na emissão do boleto", tone: "danger" };
  if (batch.status === "cancelled") return { text: "Boleto cancelado · emita novamente", tone: "danger" };
  if (batch.status === "locked") return { text: "Pronto para emitir o boleto", tone: "action" };
  if (batch.status === "open") return { text: `Em formação · ${Math.min(100, Math.round((batch.totalCents / batch.maxCents) * 100))}% do limite`, tone: "muted" };
  if (batch.status === "issuing") return { text: "Emissão em andamento no Inter", tone: "muted" };
  if (batch.status === "issued") return { text: cobranca ? `Vence em ${formatDateKey(cobranca.dataVencimento)}` : "Aguardando pagamento", tone: "muted" };
  return { text: batch.paidAt ? `Pago em ${new Date(batch.paidAt).toLocaleDateString("pt-BR")}` : "Pago", tone: "muted" };
}

type InterReadiness = {
  ready: boolean;
  environment: "sandbox" | "production";
  reason: string | null;
  payer?: { name: string; cpfCnpj: string };
  issueSettings?: {
    dueBusinessDays: number;
    dueDate: string;
    minimumDueDate: string;
    maximumDueDate: string;
  };
};

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

function calendarDateFromKey(value: string | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function calendarDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function sessionQuantityRecord(session: CashCountingSession) {
  const quantities = quantityRecord(CASH_COUNTING_DENOMINATION_VALUES_CENTS);
  for (const denomination of session.denominations) {
    quantities[denomination.valueCents] = denomination.quantity;
  }
  return quantities;
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

function DenominationBreakdown({
  title,
  description,
  denominations,
  kind,
}: {
  title: string;
  description: string;
  denominations: CashDepositBatch["denominations"];
  kind: "note" | "coin";
}) {
  const rows = cashDepositDenominationRows(denominations, kind);
  if (rows.length === 0) return null;
  const unitLabel = kind === "note" ? "cédula" : "moeda";
  const count = rows.reduce((sum, entry) => sum + entry.quantity, 0);
  return <div className="rounded-xl border border-ds-border bg-white p-3">
    <div className="flex items-baseline justify-between gap-3">
      <p className="flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint"><span aria-hidden="true" className={cn("h-2 w-2 rounded-full", kind === "note" ? "bg-ds-ok" : "bg-ds-warn")} />{title}</p>
      <span className="text-[11.5px] text-ds-ink-faint">{count} {unitLabel}{count === 1 ? "" : "s"} · <strong className="font-mono text-ds-ink-2">{formatBRL(rows.reduce((sum, entry) => sum + entry.totalCents, 0))}</strong></span>
    </div>
    <p className="mt-1 text-[11px] text-ds-ink-muted">{description}</p>
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {rows.map((entry) => <span key={entry.valueCents} title={`Subtotal ${formatBRL(entry.totalCents)}`} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ds-border bg-ds-muted px-2.5 text-[11.5px] font-semibold text-ds-ink-2"><span className="font-mono">{entry.quantity}×</span>{formatBRL(entry.valueCents)}<span className="font-mono text-ds-ink-faint">= {formatBRL(entry.totalCents)}</span></span>)}
    </div>
  </div>;
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
  const [customDueDateEnabled, setCustomDueDateEnabled] = useState(false);
  const [customDueDate, setCustomDueDate] = useState("");
  const [dueVisibleMonth, setDueVisibleMonth] = useState(() => new Date());
  const [exchangeBalance, setExchangeBalance] = useState<CashCoinBalance | null>(null);
  const [exchangeCents, setExchangeCents] = useState<number | null>(null);
  const [cancelBatch, setCancelBatch] = useState<CashDepositBatch | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [report, setReport] = useState<DepositReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
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
      const hashId = typeof window !== "undefined" && window.location.hash.startsWith("#deposit-") ? window.location.hash.slice("#deposit-".length) : null;
      if (hashId && (payload.batches ?? []).some((batch: CashDepositBatch) => batch.id === hashId)) setDetailId((current) => current ?? hashId);
      setAdjustments(payload.adjustments ?? []);
      setCoinBalances(payload.coinBalances ?? []);
      const nextCountingSessions = (payload.countingSessions ?? []) as CashCountingSession[];
      setCountingSessions(nextCountingSessions);
      setCountingSessionsHasMore(payload.countingSessionsHasMore === true);
      const focusedSession = nextCountingSessions.find((session) => session.id === focusSessionId);
      if (focusedSession) setQuantities(sessionQuantityRecord(focusedSession));
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

  const stageGroups = useMemo(() => BATCH_STAGES.map((stage) => ({
    ...stage,
    items: batches
      .filter((batch) => stage.statuses.includes(batch.status))
      .sort((a, b) => Number(b.status === "failed") - Number(a.status === "failed") || b.createdAt.localeCompare(a.createdAt)),
  })), [batches]);

  const detail = useMemo(() => batches.find((batch) => batch.id === detailId) ?? null, [batches, detailId]);

  const cobrancaById = useMemo(
    () => new Map(cobrancas.map((cobranca) => [cobranca.id, cobranca])),
    [cobrancas],
  );

  const totals = useMemo(() => ({
    inBatches: batches.reduce((sum, batch) => sum + batch.totalCents, 0),
    coins: coinBalances.reduce((sum, balance) => sum + balance.pendingExchangeCents, 0)
      + batches.filter((batch) => !!batch.countingSessionId).reduce((sum, batch) => sum + batch.coinHoldCents, 0),
    awaitingIssue: batches.filter((batch) => ["open", "locked", "failed", "cancelled"].includes(batch.status)).reduce((sum, batch) => sum + batch.totalCents, 0),
    issued: batches.filter((batch) => ["issuing", "issued"].includes(batch.status)).reduce((sum, batch) => sum + batch.totalCents, 0),
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

  function openDetail(batch: CashDepositBatch) {
    setDetailId(batch.id);
    void ensureBatchComposition(batch);
  }

  async function prepareIssue(batch: CashDepositBatch) {
    setCoinHoldCents(batch.coinHoldCents);
    setCustomDueDateEnabled(false);
    setCustomDueDate(inter.issueSettings?.dueDate ?? "");
    setDueVisibleMonth(calendarDateFromKey(inter.issueSettings?.dueDate) ?? new Date());
    setSelected(batch);
    await ensureBatchComposition(batch);
  }

  async function issueSelected() {
    if (!selected) return;
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
      await postAction(`/api/financial/cash-deposits/${encodeURIComponent(selected.id)}/issue`, customDueDateEnabled ? { dueDate: customDueDate } : {});
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
        <HeroChip value={formatBRL(totals.inBatches)} label="Cédulas em malotes" />
        <HeroChip value={formatBRL(totals.awaitingIssue)} label="Aguardando boleto" tone={totals.awaitingIssue > 0 ? "warning" : "neutral"} />
        <HeroChip value={formatBRL(totals.issued)} label="Boleto emitido" />
        <HeroChip value={formatBRL(totals.paid)} label="Pago / depositado" />
        <HeroChip value={formatBRL(totals.coins)} label="Moedas retidas" />
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

    {permissions.financial.cashDeposits.view && permissions.financial.cashDeposits.issue && countingSessions.length > 0 && <Card className="overflow-hidden rounded-2xl border-ds-accent-soft shadow-xs">
      <CardHeader className="border-b border-ds-accent-soft bg-linear-to-r from-pink-50 via-white to-emerald-50/50">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-lg"><Banknote className="h-5 w-5 text-ds-accent-ink" />Sessões aguardando composição física</CardTitle><p className="mt-1 text-sm text-ds-ink-muted">Informe as quantidades reais. Somente cédulas formarão os malotes de depósito.</p></div><Badge variant="outline" className="border-ds-accent-soft bg-white text-ds-accent-ink">{countingSessions.length} pendente(s)</Badge></div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-6">
        {countingSessionsHasMore && <div className="rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink">A fila possui mais de 50 sessões. As mais antigas são exibidas primeiro; ao concluir uma, a próxima aparecerá automaticamente.</div>}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{countingSessions.map((session) => <button key={session.id} type="button" onClick={() => { setSelectedCountingSession(session); setQuantities(sessionQuantityRecord(session)); }} className={cn("rounded-xl border p-3 text-left transition-all motion-reduce:transform-none motion-reduce:transition-none", selectedCountingSession?.id === session.id ? "border-ds-accent-soft bg-ds-accent-soft ring-2 ring-ds-accent" : "border-ds-border hover:-translate-y-0.5 hover:border-ds-accent-soft hover:shadow-xs")}><strong className="block truncate text-sm">{session.kioskNames.join(" · ")}</strong><span className="mt-1 block text-xs text-ds-ink-muted">{session.finalizedOperatorCount} operador(es) · {formatBRL(session.depositEligibleCents)}</span></button>)}</div>

        <Dialog open={selectedCountingSession !== null} onOpenChange={(open) => { if (!open) setSelectedCountingSession(null); }}>
          <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[960px] sm:p-0">
            <DialogHeader className="border-b border-ds-border px-6 py-5 text-left">
              <DialogTitle className="text-lg font-bold tracking-tight">Composição física do malote</DialogTitle>
              <DialogDescription className="mt-1 leading-5">{selectedCountingSession?.kioskNames.join(" · ")} · informe as cédulas e moedas contadas para gerar os malotes.</DialogDescription>
            </DialogHeader>
            {selectedCountingSession && <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="rounded-xl border border-ds-border bg-ds-info-bg px-4 py-3 text-sm font-semibold text-ds-info">As cédulas formarão os malotes enviados ao banco; as moedas retornam ao caixa e ficam aguardando troca.</div>
              <div className="rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink"><strong>Conciliação obrigatória:</strong> cédulas + moedas precisam totalizar {formatBRL(selectedCountingSession.depositEligibleCents)}.</div>
              <div className="grid gap-4 lg:grid-cols-2"><div><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Cédulas</p><strong className="font-mono text-sm text-ds-ok">{formatBRL(denominationNoteTotal)}</strong></div><DenominationGrid values={CASH_COUNTING_NOTE_VALUES_CENTS} quantities={quantities} setQuantities={setQuantities} disabled={submitting} /></div><div><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Moedas</p><strong className="font-mono text-sm text-ds-warn">{formatBRL(denominationCoinTotal)}</strong></div><DenominationGrid values={CASH_COUNTING_COIN_VALUES_CENTS} quantities={quantities} setQuantities={setQuantities} disabled={submitting} /></div></div>
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
      : batches.length === 0 ? <Card className="rounded-2xl border-ds-border shadow-xs"><CardContent className="flex min-h-24 items-center justify-center px-6 py-6! text-center text-sm text-muted-foreground">Nenhum malote foi formado. Eles aparecerão após a aprovação de fechamentos com dinheiro contado.</CardContent></Card>
        : <div className="space-y-5">{stageGroups.map((stage) => <section key={stage.key} aria-labelledby={`stage-${stage.key}`} className="rounded-[18px] border border-ds-border bg-ds-surface">
          <header className="flex items-baseline justify-between gap-3 px-[18px] pb-2 pt-4">
            <h2 id={`stage-${stage.key}`} className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-ds-ink">{stage.title} <span className="font-mono text-ds-ink-faint">{stage.items.length}</span></h2>
            <strong className="font-mono text-sm text-ds-accent-ink">{formatBRL(stage.items.reduce((sum, batch) => sum + batch.totalCents, 0))}</strong>
          </header>
          {stage.items.length === 0 ? <p className="border-t border-ds-divider px-[18px] py-4 text-sm text-ds-ink-faint">{stage.empty}</p>
            : <div className="border-t border-ds-divider pb-1.5">{stage.items.map((batch) => {
              const cobranca = batch.interCobrancaId ? cobrancaById.get(batch.interCobrancaId) : null;
              const hint = batchHint(batch, cobranca);
              return <LiftRow key={batch.id} id={`deposit-${batch.id}`} selected={detailId === batch.id} onClick={() => openDetail(batch)} className="grid scroll-mt-24 items-center gap-x-5 gap-y-1 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_auto_auto]">
                <div className="min-w-0"><div className="flex items-center gap-2"><strong className="text-[13.5px] font-extrabold">{batch.countingSessionId ? "Malote" : "Bloco"} #{batch.sequence}</strong><StatusPill variant={statusPillVariant(batch.status)}>{STATUS_LABEL[batch.status]}</StatusPill></div><p className="mt-0.5 truncate font-mono text-[11.5px] font-bold text-ds-ink-faint">{cashDepositBatchReference(batch)}</p></div>
                <div className="min-w-0"><p className="truncate text-[13px] font-semibold text-ds-ink">{batchKioskLabel(batch)}</p><p className="mt-0.5 truncate text-xs text-ds-ink-muted">{batchDatesLabel(batch)}</p></div>
                <p className={cn("min-w-0 truncate text-xs font-semibold", hint.tone === "danger" ? "text-ds-danger" : hint.tone === "action" ? "text-ds-ink" : "text-ds-ink-muted")}>{hint.tone === "danger" && <AlertTriangle aria-hidden="true" className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" />}{hint.text}</p>
                <strong className="font-mono text-[17px] font-extrabold tabular-nums md:text-right">{formatBRL(batch.totalCents)}</strong>
                <ChevronRight aria-hidden="true" className="hidden h-4 w-4 text-ds-ink-faint md:block" />
              </LiftRow>;
            })}</div>}
        </section>)}</div>}

    <SidePanel
      open={detail !== null}
      className="w-[540px]"
      onOpenChange={(open) => { if (!open) setDetailId(null); }}
      kicker={detail ? `${detail.countingSessionId ? "Malote" : "Bloco"} #${detail.sequence} · ${cashDepositBatchReference(detail)}` : undefined}
      title={detail ? batchKioskLabel(detail) : ""}
      subtitle={detail ? batchDatesLabel(detail) : undefined}
      highlights={detail && <>
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-sub">{detail.countingSessionId ? "Cédulas no malote" : "Valor do bloco"}</p><p className="mt-0.5 font-mono">{formatBRL(detail.totalCents)}</p></div>
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-sub">Situação</p><p className={cn("mt-0.5", ["failed", "cancelled"].includes(detail.status) && "text-ds-accent-kicker")}>{STATUS_LABEL[detail.status]}</p></div>
      </>}
    >
      {detail && (() => {
        const cobranca = detail.interCobrancaId ? cobrancaById.get(detail.interCobrancaId) : null;
        const canIssue = ["open", "locked", "failed", "cancelled"].includes(detail.status);
        const compositionLoading = loadingBatchIds.has(detail.id);
        const dayComposition = groupCashDepositItemsByDay(batchItemsById[detail.id] ?? []);
        const usagePercent = Math.min(100, Math.round((detail.totalCents / detail.maxCents) * 100));
        return <>
          {detail.status === "failed" && <div role="alert" className="flex gap-3 rounded-xl border border-ds-confirm-border bg-ds-danger-bg px-4 py-3 text-sm leading-5 text-ds-confirm-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>O Banco Inter não emitiu o boleto.</strong> {detail.bankWarning ?? "A cobrança foi recusada."} Revise o vencimento e emita novamente.</span></div>}
          {detail.status === "cancelled" && <div className="flex gap-3 rounded-xl border border-ds-confirm-border bg-ds-danger-bg px-4 py-3 text-sm leading-5 text-ds-confirm-ink"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Boleto cancelado.</strong> As cédulas continuam neste malote; emita um novo boleto para depositá-las.</span></div>}
          {detail.status !== "failed" && detail.bankWarning && <div className="rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink">{detail.bankWarning}</div>}
          {detail.lockReason === "next_item_would_exceed_limit" && <div className="flex gap-2 rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-xs text-ds-alert-ink"><Lock className="h-4 w-4 shrink-0" /><span>Travado porque o próximo fechamento de {formatBRL(detail.nextRejectedCents ?? 0)} ultrapassaria o limite.</span></div>}

          <PanelSection title="Andamento"><BatchSteps status={detail.status} /></PanelSection>

          <PanelSection title={detail.countingSessionId ? "Composição física" : "Dias e valores"} aside={compositionLoading ? "carregando…" : undefined}>
            {detail.coinPreparedAt && <p className="text-xs leading-5 text-ds-ink-muted"><span className="font-mono">{formatBRL(detail.grossTotalCents)}</span> em dinheiro físico − <span className="font-mono text-ds-alert-ink">{formatBRL(detail.coinHoldCents)}</span> {detail.countingSessionId ? "em moedas retidas" : "em moedas para troca"} = <strong className="font-mono text-ds-ink">{formatBRL(detail.totalCents)}</strong> <strong className="text-ds-ink">no boleto</strong></p>}
            {detail.status === "open" && <div><div className="h-1.5 overflow-hidden rounded-full bg-ds-muted"><div className={cn("h-full rounded-full", usagePercent >= 90 ? "bg-ds-warn" : "bg-ds-ink-faint")} style={{ width: `${usagePercent}%` }} /></div><p className="mt-1.5 text-xs text-ds-ink-muted"><span className="font-mono">{usagePercent}%</span> do limite de {formatBRL(detail.maxCents)} · cabem mais {formatBRL(detail.remainingCapacityCents)}</p></div>}
            {compositionLoading ? <Loader2 className="h-4 w-4 animate-spin text-ds-ink-faint" /> : detail.countingSessionId ? <>
              <DenominationBreakdown title="Cédulas do malote" description="Conte só a quantidade indicada em cada valor." denominations={detail.denominations} kind="note" />
              <DenominationBreakdown title="Moedas retidas" description="Ficam no caixa ou vão para troca; não entram no boleto." denominations={detail.reservedCoinDenominations} kind="coin" />
            </> : dayComposition.length === 0 ? <p className="text-xs text-ds-ink-muted">Nenhum item encontrado neste bloco.</p> : <ul className="divide-y divide-ds-divider">{dayComposition.map((day) => {
              const [year, month, dayOfMonth] = day.date.split("-");
              const hasClosure = day.sources.some((source) => ["cash_counted", "cash_adjustment", "manual_split"].includes(source));
              const label = day.date.split("-").reverse().join("/");
              return <li key={day.date} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">{hasClosure ? <Link href={`/dashboard/financial/cash-closures/${encodeURIComponent(detail.kioskId)}/${year}/${month}/${dayOfMonth}`} className="text-[13px] font-semibold text-ds-accent-ink hover:underline">{label}</Link> : <span className="text-[13px] font-semibold text-ds-ink">{label}</span>}<p className="truncate text-[11.5px] text-ds-ink-muted">{day.sources.map((source) => CASH_DEPOSIT_SOURCE_LABEL[source]).join(" + ")}{day.itemCount > 1 ? ` · ${day.itemCount} lançamentos` : ""}</p></div>
                <strong className="font-mono text-[13px] tabular-nums">{formatBRL(day.amountCents)}</strong>
              </li>;
            })}</ul>}
          </PanelSection>

          {cobranca && <PanelSection title="Boleto" aside={INTER_STATUS_LABEL[cobranca.status] ?? cobranca.status}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <PanelField label="Vencimento">{cobranca.dataVencimento.split("-").reverse().join("/")}</PanelField>
              <PanelField label="Referência bancária"><span className="font-mono">{cobranca.seuNumero}</span></PanelField>
              {cobranca.codigoSolicitacao && <div className="col-span-2"><PanelField label="Código da solicitação"><span className="break-all font-mono text-xs">{cobranca.codigoSolicitacao}</span></PanelField></div>}
            </div>
            {cobranca.linhaDigitavel && <div className="flex items-center gap-2 rounded-lg border border-ds-border bg-ds-muted px-3 py-2"><p className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-ds-ink-2">{cobranca.linhaDigitavel}</p><Button variant="ds-secondary" size="xs" onClick={() => void navigator.clipboard.writeText(cobranca.linhaDigitavel ?? "")}><Copy className="h-3.5 w-3.5" />Copiar</Button></div>}
            {cobranca.recebidoManual && <p className="text-xs text-ds-alert-ink">Marcado recebido manualmente; não tratado como liquidação bancária.</p>}
            {detail.ledgerTransactionId && <p className="text-xs font-semibold text-ds-ok">Entrada bancária registrada no financeiro.</p>}
            {cobranca.codigoSolicitacao && <div className="grid grid-cols-2 gap-2">
              <Button variant="ds-secondary" size="md" onClick={() => void refreshBatch(detail)} disabled={submitting}><RefreshCw className="h-4 w-4" />Consultar no Inter</Button>
              {["issued", "paid", "marked_received"].includes(cobranca.status) && <Button variant="ds-secondary" size="md" onClick={() => void openPdf(detail)}><FileText className="h-4 w-4" />Abrir PDF</Button>}
            </div>}
            {cobranca.codigoSolicitacao && ["requested", "issued", "marked_received"].includes(cobranca.status) && permissions.financial.cashDeposits.cancel && <Button variant="danger-link" size="xs" className="self-start px-0" onClick={() => setCancelBatch(detail)}>Cancelar boleto</Button>}
          </PanelSection>}

          {detail.countingSessionId && <Link href={`/dashboard/financial/cash-closures/sessions/${detail.countingSessionId}`} className="text-xs font-bold text-ds-accent-ink hover:underline">Abrir sessão de contagem {detail.countingSessionId.slice(0, 8)} ›</Link>}

          {canIssue && <div className="sticky bottom-0 -mx-6 -mb-5 mt-auto flex justify-end gap-2 border-t border-ds-divider bg-ds-warm px-6 py-4"><Button variant="ds-ghost" size="md" className="mr-auto" onClick={() => setDetailId(null)}>Fechar</Button><Button variant="primary-modal" size="md" disabled={!permissions.financial.cashDeposits.issue} onClick={() => { setDetailId(null); void prepareIssue(detail); }}><Barcode className="h-4 w-4" />{["failed", "cancelled"].includes(detail.status) ? "Reemitir boleto" : "Emitir boleto"}</Button></div>}
        </>;
      })()}
    </SidePanel>
    <SidePanel
      open={selected !== null}
      onOpenChange={(open) => { if (!open) setSelected(null); }}
      kicker={`Bloco #${selected?.sequence ?? ""} · Boleto`}
      title={selected && ["failed", "cancelled"].includes(selected.status) ? "Reemitir boleto" : "Emitir boleto"}
      subtitle={selected?.kioskName}
      highlights={selected && <>
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-sub">Valor do boleto</p><p className={cn("mt-0.5 font-mono", (coinHoldCents ?? 0) > selected.grossTotalCents && !selected.countingSessionId && "text-ds-accent-kicker")}>{formatBRL(selected.countingSessionId ? selected.totalCents : Math.max(0, selected.grossTotalCents - (coinHoldCents ?? 0)))}</p></div>
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-sub">Vencimento</p><p className="mt-0.5">{formatShortDate(customDueDateEnabled ? customDueDate : inter.issueSettings?.dueDate)}</p></div>
      </>}
    >
          {!selected?.countingSessionId && <div className="flex gap-3 rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm leading-5 text-ds-alert-ink"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Informe o total de moedas físicas, incluindo <strong>todas as moedas de R$ 1 e de centavos</strong>. O sistema não tenta inferir esse valor pelas denominações de cédulas.</span></div>}
          {!selected?.countingSessionId ? <PanelSection title="Composição física">
            <div className="grid gap-3 sm:grid-cols-3">
              <PanelField label="Dinheiro físico"><span className="font-mono">{formatBRL(selected?.grossTotalCents ?? 0)}</span></PanelField>
              <PanelField label="Moedas para troca"><CentsInput value={coinHoldCents} onChange={setCoinHoldCents} ariaLabel="Valor total de moedas separado para troca" className="h-9 bg-white font-mono" /></PanelField>
              <PanelField label="Cédulas no boleto"><span className={cn("font-mono", (coinHoldCents ?? 0) > (selected?.grossTotalCents ?? 0) && "text-ds-danger")}>{formatBRL(Math.max(0, (selected?.grossTotalCents ?? 0) - (coinHoldCents ?? 0)))}</span></PanelField>
            </div>
          </PanelSection> : <div className="flex gap-3 rounded-xl border border-ds-ok/20 bg-ds-ok-bg px-4 py-3 text-sm leading-5 text-ds-ok"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span><strong>Composição física já confirmada na sessão.</strong> Este malote contém apenas cédulas; as moedas ficaram reservadas no caixa ou para troca.</span></div>}
          <PanelField label="Pagador">{inter.payer ? <>{inter.payer.name} <span className="font-mono text-ds-ink-muted">· {formatCnpj(inter.payer.cpfCnpj)}</span></> : "Pagador institucional configurado"}</PanelField>
          <PanelSection title="Vencimento" aside="dias úteis">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setCustomDueDateEnabled(false)} className={cn("rounded-xl border px-3 py-3 text-left transition-colors", !customDueDateEnabled ? "border-ds-accent bg-ds-accent-soft text-ds-accent-ink" : "border-ds-border bg-white text-ds-ink-2")}>
                <span className="block text-[11px] font-bold uppercase tracking-wide">Automático</span>
                <strong className="mt-1 block text-sm">D+{inter.issueSettings?.dueBusinessDays ?? 7} · {formatShortDate(inter.issueSettings?.dueDate)}</strong>
              </button>
              <button type="button" onClick={() => { setCustomDueDateEnabled(true); setCustomDueDate((current) => current || inter.issueSettings?.dueDate || ""); }} className={cn("rounded-xl border px-3 py-3 text-left transition-colors", customDueDateEnabled ? "border-ds-accent bg-ds-accent-soft text-ds-accent-ink" : "border-ds-border bg-white text-ds-ink-2")}>
                <span className="block text-[11px] font-bold uppercase tracking-wide">Personalizado</span>
                <strong className="mt-1 block text-sm">Outra data</strong>
              </button>
            </div>
            {customDueDateEnabled && <div className="mt-3 overflow-hidden rounded-xl border border-ds-border bg-white">
              <div className="flex items-center gap-2 border-b border-ds-border px-3 py-2 text-xs font-semibold text-ds-ink-muted"><CalendarDays className="h-4 w-4" />Escolha entre hoje e {inter.issueSettings?.maximumDueDate?.split("-").reverse().join("/") ?? "60 dias"}</div>
              <Calendar
                mode="single"
                locale={ptBR}
                month={dueVisibleMonth}
                onMonthChange={setDueVisibleMonth}
                selected={calendarDateFromKey(customDueDate)}
                onSelect={(value) => value && setCustomDueDate(calendarDateKey(value))}
                fromDate={calendarDateFromKey(inter.issueSettings?.minimumDueDate)}
                toDate={calendarDateFromKey(inter.issueSettings?.maximumDueDate)}
                disabled={[
                  { before: calendarDateFromKey(inter.issueSettings?.minimumDueDate) ?? new Date() },
                  { after: calendarDateFromKey(inter.issueSettings?.maximumDueDate) ?? new Date() },
                ]}
                className="mx-auto"
                classNames={{ day_selected: "bg-ds-accent text-white hover:bg-ds-accent-hover hover:text-white focus:bg-ds-accent focus:text-white", day_today: "border border-ds-accent-soft bg-ds-accent-soft text-ds-accent-ink" }}
              />
            </div>}
            <p className="text-xs text-ds-ink-muted">D+{inter.issueSettings?.dueBusinessDays ?? 7} dias úteis é o padrão. Fins de semana e feriados configurados não entram na contagem.</p>
          </PanelSection>
          <PanelSection title={selected?.countingSessionId ? "Cédulas do malote" : "Dias neste bloco"} aside={selected?.countingSessionId ? `${cashDepositDenominationRows(selected.denominations, "note").reduce((sum, item) => sum + item.quantity, 0)} cédulas` : `${selected?.dates.length ?? 0} dias`}><div className="flex flex-wrap gap-1.5">{selected?.countingSessionId ? cashDepositDenominationRows(selected.denominations, "note").map((item) => <span key={item.valueCents} className="inline-flex h-6 items-center rounded-full border border-ds-border bg-white px-2.5 text-[11px] font-semibold text-ds-ink-muted">{item.quantity}× {formatBRL(item.valueCents)}</span>) : loadingBatchIds.has(selected?.id ?? "") ? <Loader2 className="h-4 w-4 animate-spin text-ds-ink-faint" /> : selectedComposition.length > 0 ? selectedComposition.map((day) => <span key={day.date} className="inline-flex h-6 items-center rounded-full border border-ds-border bg-white px-2.5 text-[11px] font-semibold text-ds-ink-muted">{day.date.slice(5).split("-").reverse().join("/")} · {formatBRL(day.amountCents)}</span>) : selected?.dates.map((date) => <span key={date} className="inline-flex h-6 items-center rounded-full border border-ds-border bg-white px-2.5 text-[11px] font-semibold text-ds-ink-muted">{date.slice(5).split("-").reverse().join("/")}</span>)}</div></PanelSection>
          {!inter.ready && <div className="rounded-xl border border-ds-alert-border bg-ds-warn-bg px-4 py-3 text-sm text-ds-alert-ink">{inter.reason}</div>}
        <div className="sticky bottom-0 -mx-6 -mb-5 mt-auto flex justify-end gap-2 border-t border-ds-divider bg-ds-warm px-6 py-4"><Button variant="ds-ghost" size="md" className="mr-auto" onClick={() => setSelected(null)}>Cancelar</Button><Button variant="primary-modal" size="md" onClick={() => void issueSelected()} disabled={(customDueDateEnabled && !customDueDate) || (!selected?.countingSessionId && (selected?.grossTotalCents ?? 0) !== (coinHoldCents ?? 0) && !inter.ready) || (selected?.countingSessionId && !inter.ready) || submitting || (!selected?.countingSessionId && (coinHoldCents ?? 0) > (selected?.grossTotalCents ?? 0))}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : !selected?.countingSessionId && (coinHoldCents ?? 0) === (selected?.grossTotalCents ?? 0) ? <Coins className="mr-2 h-4 w-4" /> : <Barcode className="mr-2 h-4 w-4" />}{!selected?.countingSessionId && (coinHoldCents ?? 0) === (selected?.grossTotalCents ?? 0) ? "Separar moedas" : "Emitir boleto"}</Button></div>
    </SidePanel>

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
