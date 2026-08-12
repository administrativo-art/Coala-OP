"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Barcode,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Info,
  Loader2,
  Lock,
  RefreshCw,
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
import { formatBRL } from "../cash-closures/money";
import { CashControlNavigation } from "../cash-closures/components/cash-control-navigation";
import type { InterCobrancaDocument } from "./inter-cobranca";
import {
  CASH_DEPOSIT_SOURCE_LABEL,
  cashDepositBatchReference,
  groupCashDepositItemsByDay,
} from "./references";
import type { CashDepositAdjustment, CashDepositBatch, CashDepositBatchItem } from "./types";

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
  if (status === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "issued" || status === "issuing") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "failed" || status === "cancelled") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "locked") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function statusBarClass(status: CashDepositBatch["status"]) {
  if (status === "paid") return "bg-emerald-500";
  if (status === "issued" || status === "issuing") return "bg-blue-500";
  if (status === "failed" || status === "cancelled") return "bg-rose-500";
  if (status === "open") return "bg-emerald-500";
  return "bg-amber-500";
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

export function CashDepositsPage() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [batches, setBatches] = useState<CashDepositBatch[]>([]);
  const [cobrancas, setCobrancas] = useState<InterCobrancaDocument[]>([]);
  const [adjustments, setAdjustments] = useState<CashDepositAdjustment[]>([]);
  const [inter, setInter] = useState<InterReadiness>({ ready: false, environment: "sandbox", reason: "Verificando configuração..." });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<CashDepositBatch | null>(null);
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
      const response = await authorizedFetch("/api/financial/cash-deposits");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar depósitos.");
      setBatches(payload.batches ?? []);
      setAdjustments(payload.adjustments ?? []);
      setCobrancas(payload.cobrancas ?? []);
      setInter(payload.inter ?? { ready: false, environment: "sandbox", reason: "Integração não configurada." });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch, firebaseUser, toast]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const result = new Map<string, CashDepositBatch[]>();
    for (const batch of batches) result.set(batch.kioskId, [...(result.get(batch.kioskId) ?? []), batch]);
    return [...result.entries()];
  }, [batches]);

  const cobrancaById = useMemo(
    () => new Map(cobrancas.map((cobranca) => [cobranca.id, cobranca])),
    [cobrancas],
  );

  const totals = useMemo(() => ({
    counted: batches.reduce((sum, batch) => sum + batch.totalCents, 0),
    allocated: batches.reduce((sum, batch) => sum + batch.totalCents, 0),
    issued: batches.filter((batch) => ["issuing", "issued", "paid"].includes(batch.status)).reduce((sum, batch) => sum + batch.totalCents, 0),
    paid: batches.filter((batch) => batch.status === "paid").reduce((sum, batch) => sum + batch.totalCents, 0),
  }), [batches]);
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
      if (!response.ok) throw new Error(payload.error || "A operação não foi concluída.");
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
        if (!response.ok) throw new Error(payload.error || "Falha ao carregar a composição do depósito.");
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
      await postAction(`/api/financial/cash-deposits/${encodeURIComponent(selected.id)}/issue`, dueChoice === "custom"
        ? { dueDate: customDueDate }
        : { dueBusinessDays: Number(dueChoice) });
      toast({ title: "Boleto enviado ao Inter", description: "A situação foi confirmada por consulta ativa." });
      setSelected(null);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na emissão." });
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
    return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso aos depósitos em dinheiro.</div>;
  }

  return <div className="mx-auto w-full max-w-[1180px] space-y-[18px] pb-10">
    <CashControlNavigation active="deposits" />
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[11px] font-semibold text-zinc-400">Financeiro <span className="px-1 text-stone-300">›</span> Depósitos em dinheiro</p>
        <h1 className="mt-1.5 text-[24px] font-black tracking-tight">Depósitos em dinheiro</h1>
        <p className="mt-1.5 text-[13px] font-medium text-zinc-500">Somente dinheiro físico aprovado · nenhum boleto é emitido automaticamente</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="h-[42px] rounded-xl border-stone-200 px-4 font-bold" onClick={() => void loadReport()} disabled={reportLoading}>
          {reportLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Relatórios
        </Button>
        <Button variant="outline" className="h-[42px] rounded-xl border-stone-200 px-4 font-bold" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
      </div>
    </div>

    <Card className="overflow-hidden rounded-2xl border-0 bg-zinc-900 text-white shadow-[0_2px_10px_rgba(15,23,42,.08)]"><CardContent className="grid min-h-[82px] items-stretch !p-0 sm:grid-cols-2 lg:grid-cols-4">{[
      ["Dinheiro contado", formatBRL(totals.counted), "text-white"],
      ["Alocado em blocos", formatBRL(totals.allocated), "text-zinc-300"],
      ["Emitido (boleto)", formatBRL(totals.issued), "text-indigo-300"],
      ["Pago / depositado", formatBRL(totals.paid), "text-emerald-300"],
    ].map(([label, value, valueClass], index) => <div key={label} className={cn("flex min-w-0 flex-col justify-center border-zinc-700/70 px-6 py-4", index > 0 && "sm:border-l")}><p className="text-[9.5px] font-extrabold uppercase tracking-[.06em] text-zinc-500">{label}</p><strong className={cn("mt-1 whitespace-nowrap font-mono text-[18px]", index === 0 && "text-[21px]", valueClass)}>{value}</strong></div>)}</CardContent></Card>

    {!inter.ready && <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
      <Info className="h-4 w-4 shrink-0" />
      <span className="truncate">
        <strong>Inter em configuração.</strong>{" "}
        A emissão de boletos ficará disponível após configurar a integração.
      </span>
    </div>}

    {adjustments.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-amber-200 bg-amber-50 px-[18px] py-3 text-[13px] text-amber-900">
      <div className="flex items-center gap-3"><AlertTriangle className="h-[18px] w-[18px] shrink-0" /><span><strong>{adjustments.length} ajuste(s) aguardando alocação.</strong>
      {adjustments.some((item) => Date.now() - new Date(item.createdAt).getTime() > 15 * 86_400_000) && <span> Há ajustes pendentes há mais de 15 dias.</span>}</span></div>
      {permissions.financial.cashDeposits.adjust && <Button size="sm" variant="outline" className="border-amber-300 bg-white font-bold text-amber-900" onClick={() => void processAdjustments()} disabled={submitting}>Realocar</Button>}
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
          ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-950"><strong>{report.reconciliationIssues.length} inconsistência(s) encontrada(s).</strong> Exporte o CSV para os detalhes.</div>
          : <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">Reconciliação fechamento × depósito sem inconsistências.</div>}
      </CardContent>
    </Card>}

    {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
      : groups.length === 0 ? <Card className="rounded-[18px] border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.05)]"><CardContent className="flex min-h-20 items-center justify-center px-6 !py-6 text-center text-sm text-muted-foreground">Nenhum bloco foi formado. Eles aparecerão após a aprovação de fechamentos com dinheiro contado.</CardContent></Card>
        : <div className="space-y-6">{groups.map(([kioskId, items]) => <section key={kioskId} className="space-y-3">
          <div><h2 className="text-base font-black">{items[0].kioskName}</h2><p className="mt-0.5 text-[11.5px] font-semibold text-zinc-400">{kioskId}</p></div>
          <div className="space-y-3.5">{items.map((batch) => {
            const cobranca = batch.interCobrancaId ? cobrancaById.get(batch.interCobrancaId) : null;
            const canIssue = ["open", "locked", "failed", "cancelled"].includes(batch.status);
            const reference = cashDepositBatchReference(batch);
            const expanded = expandedBatchIds.has(batch.id);
            const compositionLoading = loadingBatchIds.has(batch.id);
            const dayComposition = groupCashDepositItemsByDay(batchItemsById[batch.id] ?? []);
            return <Card key={batch.id} id={`deposit-${batch.id}`} className={cn("relative scroll-mt-24 overflow-hidden rounded-[18px] border-stone-200 shadow-[0_2px_10px_rgba(15,23,42,.05)] target:ring-2 target:ring-emerald-500 target:ring-offset-2", "before:absolute before:inset-y-0 before:left-0 before:w-1.5", batch.status === "open" ? "before:bg-emerald-500" : batch.status === "locked" ? "before:bg-amber-400" : ["issued", "issuing"].includes(batch.status) ? "before:bg-indigo-500" : batch.status === "paid" ? "before:bg-emerald-500" : "before:bg-rose-500") }>
              <CardHeader className="px-[22px] pb-2 pt-[17px]"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><CardTitle className="text-[16px] font-black">Bloco #{batch.sequence}</CardTitle><Badge variant="outline" className={cn("rounded-full px-3 py-1 text-[11px] font-extrabold", statusBadgeClass(batch.status))}>{STATUS_LABEL[batch.status]}</Badge><span className="font-mono text-[11px] font-bold text-zinc-400">{reference}</span></div><div className="flex items-center gap-3"><strong className="font-mono text-[17px]">{formatBRL(batch.totalCents)} <span className="text-[13px] font-semibold text-zinc-400">/ {formatBRL(batch.maxCents)}</span></strong>{canIssue && <Button size="sm" variant={batch.status === "open" ? "default" : "outline"} className={cn("h-10 rounded-[10px] font-extrabold", batch.status === "open" && "bg-pink-600 text-white hover:bg-pink-700")} onClick={() => void prepareIssue(batch)} disabled={!permissions.financial.cashDeposits.issue || !inter.ready}><Barcode className="mr-2 h-4 w-4" />{["failed", "cancelled"].includes(batch.status) ? "Reemitir boleto" : "Preparar emissão"}</Button>}</div></div></CardHeader>
              <CardContent className="space-y-3 px-[22px] pb-[17px]">
                <div><div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className={cn("h-full rounded-full", statusBarClass(batch.status))} style={{ width: `${Math.min(100, (batch.totalCents / batch.maxCents) * 100)}%` }} /></div><p className="mt-2 text-[12.5px] font-semibold text-zinc-500">{batch.status === "paid" ? `Liquidado em ${batch.paidAt ? new Date(batch.paidAt).toLocaleDateString("pt-BR") : "data registrada"}` : `Ainda cabem ${formatBRL(batch.remainingCapacityCents)} antes do limite`}</p></div>
                {batch.lockReason === "next_item_would_exceed_limit" && <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><Lock className="h-4 w-4 shrink-0" /><span>Travado porque o próximo fechamento de {formatBRL(batch.nextRejectedCents ?? 0)} ultrapassaria o limite.</span></div>}
                {cobranca && <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-[11.5px]"><div className="flex flex-wrap justify-between gap-3"><span className="text-zinc-500">Inter: <strong className="text-zinc-900">{cobranca.situacao ?? cobranca.status}</strong></span><span className="text-zinc-500">Referência bancária: <strong className="font-mono text-zinc-900">{cobranca.seuNumero}</strong></span><span className="text-zinc-500">Vencimento: <strong className="text-zinc-900">{cobranca.dataVencimento.split("-").reverse().join("/")}</strong></span></div>{cobranca.linhaDigitavel && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-indigo-100 pt-3"><div className="min-w-0 flex-1"><p className="text-[9.5px] font-extrabold uppercase tracking-wide text-zinc-400">Linha digitável</p><p className="truncate font-mono text-[12.5px] font-bold text-zinc-800">{cobranca.linhaDigitavel}</p></div><Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => void navigator.clipboard.writeText(cobranca.linhaDigitavel ?? "")}><Copy className="mr-1.5 h-3.5 w-3.5" />Copiar</Button></div>}{cobranca.codigoSolicitacao && <p className="mt-2 text-muted-foreground">Código da solicitação: <span className="font-mono">{cobranca.codigoSolicitacao}</span></p>}{cobranca.recebidoManual && <p className="mt-2 text-amber-800">Marcado recebido manualmente; não tratado como liquidação bancária.</p>}{batch.ledgerTransactionId && <p className="mt-2 font-semibold text-emerald-700">Entrada bancária registrada no financeiro.</p>}{batch.bankWarning && <p className="mt-2 text-amber-800">{batch.bankWarning}</p>}</div>}
                <div className="overflow-hidden rounded-xl border border-stone-200">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-between rounded-none px-3 py-2.5 text-[12.5px] font-bold"
                    onClick={() => void toggleBatchComposition(batch)}
                    disabled={compositionLoading}
                  >
                    <span>{compositionLoading ? "Carregando composição..." : `Dias e valores (${batch.dates.length})`}</span>
                    {compositionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                  {expanded && <div className="space-y-2 border-t p-3">
                    {dayComposition.length === 0
                      ? <p className="text-xs text-muted-foreground">Nenhum item encontrado neste bloco.</p>
                      : dayComposition.map((day) => {
                        const [year, month, dayOfMonth] = day.date.split("-");
                        const closureHref = `/dashboard/financial/cash-closures/${encodeURIComponent(batch.kioskId)}/${year}/${month}/${dayOfMonth}`;
                        return <div key={day.date} className="grid gap-2 rounded-[10px] bg-stone-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                          <div>
                            <Link href={closureHref} className="text-sm font-semibold text-emerald-700 hover:underline">{day.date.split("-").reverse().join("/")}</Link>
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
      <DialogContent className="gap-0 overflow-hidden rounded-[20px] p-0 sm:max-w-[540px]">
        <DialogHeader className="border-b border-stone-100 px-[26px] pb-[18px] pt-[22px] text-left">
          <div className="flex items-center gap-3"><span className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-indigo-50"><Barcode className="h-5 w-5 text-indigo-600" /></span><div><DialogTitle className="text-[18px] font-black">{selected && ["failed", "cancelled"].includes(selected.status) ? "Reemitir boleto" : "Emitir boleto"}</DialogTitle><DialogDescription className="mt-0.5 text-[13px]">Bloco #{selected?.sequence} · {selected?.kioskName}</DialogDescription></div></div>
        </DialogHeader>
        <div className="space-y-5 px-[26px] py-[22px]">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-[15px] py-[13px] text-[13px] leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-[17px] w-[17px] shrink-0" /><span>Este bloco possui <strong>{formatBRL(selected?.totalCents ?? 0)}</strong> e ainda comporta <strong>{formatBRL(selected?.remainingCapacityCents ?? 0)}</strong> antes do limite. Emitir agora impede que novos dias entrem nele.</span></div>
          <div className="flex items-center justify-between"><span className="text-[13px] text-zinc-500">Valor do bloco</span><strong className="font-mono text-xl">{formatBRL(selected?.totalCents ?? 0)}</strong></div>
          <div><p className="mb-1.5 text-[9.5px] font-extrabold uppercase tracking-[.06em] text-zinc-400">Pagador</p><div className="rounded-[10px] border border-stone-200 bg-stone-50 px-3 py-2.5 text-[13px] font-semibold text-zinc-700">{inter.payer ? `${inter.payer.name} · ${formatCnpj(inter.payer.cpfCnpj)}` : "Pagador institucional configurado"}</div></div>
          <div><p className="mb-1.5 text-[9.5px] font-extrabold uppercase tracking-[.06em] text-zinc-400">Vencimento</p><div className="grid grid-cols-3 gap-2"><Button type="button" variant="outline" className={cn("h-10 rounded-[10px] text-[12px] font-bold", dueChoice === "1" && "border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-50")} onClick={() => setDueChoice("1")}>D+1 · {formatShortDate(inter.issueSettings?.suggestedDueDates["1"])}</Button><Button type="button" variant="outline" className={cn("h-10 rounded-[10px] text-[12px] font-bold", dueChoice === "2" && "border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-50")} onClick={() => setDueChoice("2")}>D+2 · {formatShortDate(inter.issueSettings?.suggestedDueDates["2"])}</Button><Button type="button" variant="outline" className={cn("h-10 rounded-[10px] text-[12px] font-bold", dueChoice === "custom" && "border-pink-300 bg-pink-50 text-pink-700 hover:bg-pink-50")} onClick={() => setDueChoice("custom")}>Escolher</Button></div>{dueChoice === "custom" && <input type="date" value={customDueDate} onChange={(event) => setCustomDueDate(event.target.value)} className="mt-2 h-10 w-full rounded-[10px] border border-stone-200 bg-white px-3 text-[13px] outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100" />}</div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5"><p className="mb-2 text-[9.5px] font-extrabold uppercase tracking-[.06em] text-zinc-400">{selected?.dates.length ?? 0} dias neste bloco</p><div className="flex flex-wrap gap-1.5">{loadingBatchIds.has(selected?.id ?? "") ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : selectedComposition.length > 0 ? selectedComposition.map((day) => <span key={day.date} className="inline-flex h-6 items-center rounded-full border border-stone-200 bg-white px-2.5 text-[11px] font-semibold text-zinc-600">{day.date.slice(5).split("-").reverse().join("/")} · {formatBRL(day.amountCents)}</span>) : selected?.dates.map((date) => <span key={date} className="inline-flex h-6 items-center rounded-full border border-stone-200 bg-white px-2.5 text-[11px] font-semibold text-zinc-600">{date.slice(5).split("-").reverse().join("/")}</span>)}</div></div>
          {!inter.ready && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{inter.reason}</div>}
        </div>
        <DialogFooter className="border-t border-stone-100 px-[26px] py-4"><Button variant="outline" className="rounded-[10px]" onClick={() => setSelected(null)}>Cancelar</Button><Button className="rounded-[10px] bg-pink-600 font-bold text-white hover:bg-pink-700" onClick={() => void issueSelected()} disabled={!inter.ready || submitting || (dueChoice === "custom" && !customDueDate)}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Barcode className="mr-2 h-4 w-4" />}Emitir boleto</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={cancelBatch !== null} onOpenChange={(open) => { if (!open) { setCancelBatch(null); setCancelReason(""); } }}>
      <DialogContent className="rounded-[20px] sm:max-w-[460px]">
        <DialogHeader><DialogTitle>Cancelar boleto Inter</DialogTitle><DialogDescription>O motivo é obrigatório e será enviado ao banco. Se o boleto já tiver sido pago, a consulta ativa prevalece e o bloco será marcado como depositado.</DialogDescription></DialogHeader>
        <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value.slice(0, 50))} placeholder="Motivo do cancelamento" />
        <p className="text-right text-xs text-muted-foreground">{cancelReason.length}/50</p>
        <DialogFooter><Button variant="outline" onClick={() => setCancelBatch(null)}>Voltar</Button><Button variant="destructive" onClick={() => void cancelSelected()} disabled={!cancelReason.trim() || submitting}>{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cancelar boleto</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>;
}
