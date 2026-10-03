"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Landmark, RefreshCw, SearchCheck } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatStoneMoney } from "../agent/presentation";
import type { MappingView } from "../agent/configuration";
import type { BankStatementCoverage } from "./receipt-bank-coverage";
import { receiptDayGroups, receiptFilterCount, receiptFilterLabels, receiptListRows, receiptRowAmount, receiptRowMatchesFilter, type ReceiptListFilter, type ReceiptListRow } from "./presentation";
import type { ReceiptMatchStatus, ReceiptReconciliationResult } from "./reconciliation";

type ReconciliationResponse = ReceiptReconciliationResult & {
  period: { from: string; through: string };
  collectedAt: string;
  scope: { mappingId: string; kioskId: string; accountId: string; stoneCode: string };
  stoneCoverage: "complete" | "partial";
  bankCoverage: BankStatementCoverage;
  missingDates: string[];
};

const statusLabels: Record<ReceiptMatchStatus, string> = {
  received: "Recebido", received_with_adjustment: "Recebido com estorno/ajuste", stone_payment_review: "Pagamento Stone para revisar",
  awaiting_bank_credit: "Aguardando crédito", missing_bank_credit: "Sem crédito após a janela", bank_amount_mismatch: "Valor divergente",
  ambiguous_bank_credit: "Mais de um crédito possível", bank_only: "Crédito sem par Stone",
};
const statusStyles: Record<ReceiptMatchStatus, string> = {
  received: "border-emerald-200 bg-emerald-50 text-emerald-900", received_with_adjustment: "border-amber-200 bg-amber-50 text-amber-950",
  stone_payment_review: "border-amber-200 bg-amber-50 text-amber-950", awaiting_bank_credit: "border-sky-200 bg-sky-50 text-sky-950",
  missing_bank_credit: "border-rose-200 bg-rose-50 text-rose-950", bank_amount_mismatch: "border-rose-200 bg-rose-50 text-rose-950",
  ambiguous_bank_credit: "border-amber-200 bg-amber-50 text-amber-950", bank_only: "border-violet-200 bg-violet-50 text-violet-950",
};

function dateLabel(value: string | null | undefined) { return value ? value.split("-").reverse().join("/") : "—"; }
function money(value: number | string | null) { return formatStoneMoney(value === null ? null : typeof value === "number" ? value.toFixed(2) : value); }
function localDate(offsetDays: number) { const value = new Date(); value.setDate(value.getDate() + offsetDays); return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem" }).format(value); }
function addDays(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function statusIcon(status: ReceiptMatchStatus) {
  if (status === "received" || status === "received_with_adjustment") return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  if (status === "awaiting_bank_credit") return <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />;
  return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
}
function StatusBadge({ status }: { status: ReceiptMatchStatus }) { return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${statusStyles[status]}`}>{statusIcon(status)}{statusLabels[status]}</span>; }

function BankCoverageNotice({ coverage }: { coverage: BankStatementCoverage }) {
  if (coverage.status === "complete") return <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-950">Extrato importado com cobertura até {dateLabel(coverage.syncedThrough)}. Cada baixa continua exigindo crédito importado compatível.</div>;
  if (coverage.status === "partial") return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">O extrato sincronizado alcança {dateLabel(coverage.syncedThrough)}, mas esta consulta precisa de cobertura até {dateLabel(coverage.requiredThrough)}. A lacuna não é classificada como falta de recebimento.</div>;
  return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">Não foi possível confirmar a cobertura da sincronização do extrato. Somente créditos efetivamente importados aparecem como recebidos.</div>;
}

function RowSummary({ row }: { row: ReceiptListRow }) {
  if (row.kind === "bank_only") return <><p className="font-mono text-xs font-semibold text-[#374151]">Sem liquidação Stone</p><p className="mt-1 truncate text-xs text-muted-foreground">{row.unmatched.bank.description}</p></>;
  return <><p className="font-mono text-xs font-semibold text-[#374151]">{row.match.stone.transactionId} · parcela {row.match.stone.installment}</p><p className="mt-1 truncate text-xs text-muted-foreground">Venda {dateLabel(row.match.stone.saleDate)} · arquivo {row.match.stone.sourceFileId}</p></>;
}
function RowBankSummary({ row }: { row: ReceiptListRow }) {
  const bank = row.kind === "match" ? row.match.bank : row.unmatched.bank;
  const candidates = row.kind === "match" ? row.match.candidateBankCredits.length : 0;
  if (!bank && candidates) return <p className="text-xs font-semibold text-amber-800">{candidates} crédito(s) candidato(s)</p>;
  if (!bank) return <p className="text-xs text-muted-foreground">Não localizado</p>;
  return <><p className="font-mono text-xs font-semibold text-[#374151]">{money(bank.amount)}</p><p className="mt-1 truncate text-xs text-muted-foreground">{bank.description}</p></>;
}

function EvidenceDrawer({ row, open, onOpenChange }: { row: ReceiptListRow | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const match = row?.kind === "match" ? row.match : null;
  const bank = match?.bank ?? (row?.kind === "bank_only" ? row.unmatched.bank : null);
  const candidates = match?.candidateBankCredits ?? [];
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full overflow-y-auto border-[#e6e3dc] p-5 sm:max-w-xl sm:p-6">{row ? <>
    <SheetHeader className="pr-8"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={row.status} /><span className="text-xs text-muted-foreground">Evidências da consulta</span></div><SheetTitle className="pt-2">{match ? `Liquidação ${match.stone.transactionId}` : "Crédito sem liquidação Stone"}</SheetTitle><SheetDescription>{row.kind === "match" ? row.match.explanation : row.unmatched.explanation}</SheetDescription></SheetHeader>
    <div className="mt-6 space-y-4">
      {match ? <section className="rounded-2xl border border-[#e6e3dc] bg-[#faf9f6] p-4"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#8a8a94]">Liquidação Stone</p><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Transação / parcela</dt><dd className="mt-1 font-mono font-semibold">{match.stone.transactionId} / {match.stone.installment}</dd></div><div><dt className="text-xs text-muted-foreground">Líquido informado</dt><dd className="mt-1 font-mono font-semibold">{money(match.stone.netAmount)}</dd></div><div><dt className="text-xs text-muted-foreground">Pagamento Stone</dt><dd className="mt-1 font-semibold">{dateLabel(match.stone.paymentDate)}</dd></div><div><dt className="text-xs text-muted-foreground">Janela de crédito</dt><dd className="mt-1 font-semibold">{dateLabel(match.stone.paymentDate)} até {dateLabel(addDays(match.stone.paymentDate, 2))}</dd></div><div><dt className="text-xs text-muted-foreground">Bruto</dt><dd className="mt-1 font-mono">{money(match.stone.grossAmount)}</dd></div><div><dt className="text-xs text-muted-foreground">PaymentId</dt><dd className="mt-1 break-all font-mono text-xs">{match.stone.paymentId ?? "não informado"}</dd></div></dl></section> : null}
      <section className="rounded-2xl border border-[#e6e3dc] p-4"><div className="flex items-center gap-2"><Landmark className="h-4 w-4 text-[#bd185c]" aria-hidden="true" /><p className="text-sm font-extrabold">Crédito no extrato importado</p></div>{bank ? <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Valor</dt><dd className="mt-1 font-mono font-semibold">{money(bank.amount)}</dd></div><div><dt className="text-xs text-muted-foreground">Data</dt><dd className="mt-1 font-semibold">{dateLabel(bank.date)}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Descrição importada</dt><dd className="mt-1 break-words">{bank.description}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Referências do extrato</dt><dd className="mt-1 break-all font-mono text-xs">{bank.references.length ? bank.references.join(", ") : "não informadas"}</dd></div></dl> : <p className="mt-3 text-sm text-muted-foreground">Nenhum crédito foi associado automaticamente a esta liquidação.</p>}</section>
      {match ? <section className="rounded-2xl border border-[#e6e3dc] p-4"><p className="text-sm font-extrabold">Créditos candidatos na janela</p>{candidates.length ? <ul className="mt-3 space-y-2">{candidates.map(candidate => <li key={candidate.id} className="rounded-xl bg-[#faf9f6] p-3 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-mono font-semibold">{money(candidate.amount)}</span><span className="text-xs text-muted-foreground">{dateLabel(candidate.date)}</span></div><p className="mt-1 break-words text-xs text-muted-foreground">{candidate.description}</p></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Nenhum crédito candidato foi importado dentro da janela.</p>}{match.amountDifference !== null ? <p className="mt-3 text-xs text-muted-foreground">Diferença para o líquido Stone: <strong className="font-mono text-foreground">{money(match.amountDifference)}</strong>.</p> : null}</section> : null}
    </div>
  </> : null}</SheetContent></Sheet>;
}

export function StoneBankReceiptReconciliation({ mapping, stoneCode }: { mapping: MappingView; stoneCode: string }) {
  const api = useAuthenticatedApi();
  const [from, setFrom] = useState(() => localDate(-7));
  const [through, setThrough] = useState(() => localDate(-1));
  const [result, setResult] = useState<ReconciliationResponse | null>(null);
  const [filter, setFilter] = useState<ReceiptListFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allRows = useMemo(() => result ? receiptListRows(result) : [], [result]);
  const rows = useMemo(() => allRows.filter(row => receiptRowMatchesFilter(row, filter)), [allRows, filter]);
  const groups = useMemo(() => receiptDayGroups(rows), [rows]);
  const selectedRow = allRows.find(row => row.id === selectedId) ?? null;
  const run = async () => {
    if (busy || !stoneCode || !from || !through) return;
    setBusy(true); setError("");
    try {
      const next = await api<ReconciliationResponse>("/api/financial/stone-receipts/reconcile", { method: "POST", json: { kioskId: mapping.kioskId, stoneCode, from, through } });
      if (next.scope.mappingId !== mapping.id || next.scope.accountId !== mapping.accountId || next.scope.kioskId !== mapping.kioskId || next.scope.stoneCode !== stoneCode) throw new AuthenticatedApiError("O vínculo mudou durante a consulta. Recarregue a página e tente novamente.", 409, null);
      setResult(next); setFilter("all"); setSelectedId(null);
    } catch (caught) { setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível conferir os créditos bancários."); } finally { setBusy(false); }
  };
  const invalidRange = !from || !through || from > through;
  const filters: Array<{ id: ReceiptListFilter; label: string; count: number; amount: number; tone: string }> = result ? [
    { id: "all", label: "Stone liquidado", count: result.summary.totalStoneSettlements, amount: result.summary.stoneNetAmount, tone: "border-[#e6e3dc] bg-white" },
    { id: "received", label: "Recebido", count: receiptFilterCount(allRows, "received"), amount: result.summary.bankMatchedAmount, tone: "border-emerald-200 bg-emerald-50" },
    { id: "awaiting", label: "Aguardando", count: receiptFilterCount(allRows, "awaiting"), amount: allRows.filter(row => receiptRowMatchesFilter(row, "awaiting")).reduce((sum, row) => sum + receiptRowAmount(row), 0), tone: "border-sky-200 bg-sky-50" },
    { id: "pending", label: "Pendência", count: receiptFilterCount(allRows, "pending"), amount: allRows.filter(row => receiptRowMatchesFilter(row, "pending")).reduce((sum, row) => sum + receiptRowAmount(row), 0), tone: "border-rose-200 bg-rose-50" },
    { id: "bank_only", label: "Crédito sem par", count: receiptFilterCount(allRows, "bank_only"), amount: allRows.filter(row => receiptRowMatchesFilter(row, "bank_only")).reduce((sum, row) => sum + receiptRowAmount(row), 0), tone: "border-violet-200 bg-violet-50" },
  ] : [];
  return <Card id="credito-bancario" className="scroll-mt-24 rounded-2xl border-[#e6e3dc] bg-white"><CardHeader className="pb-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#bd185c]">Etapa 04 · confirmação</p><CardTitle className="mt-1 flex items-center gap-2 text-lg"><Landmark className="h-5 w-5 text-[#bd185c]" />Crédito bancário × Stone</CardTitle><CardDescription className="mt-1">O recebimento só fecha quando a liquidação da Stone encontra um crédito importado na conta {mapping.accountName}.</CardDescription></div><Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800">Consulta sob demanda</Badge></div></CardHeader>
    <CardContent className="space-y-4"><div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">A data de pagamento da Stone é uma previsão/indício de liquidação. O crédito importado do extrato do Banco Inter, na conta vinculada, é a evidência de que entrou.</div><div className="rounded-2xl border border-[#e6e3dc] bg-[#faf9f6] p-4"><div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"><label className="grid gap-1.5 text-sm font-semibold text-[#4a4a55]">Liquidações desde<Input aria-label="Início da conciliação de recebimentos" type="date" value={from} onChange={event => { setFrom(event.target.value); setResult(null); }} /></label><label className="grid gap-1.5 text-sm font-semibold text-[#4a4a55]">Liquidações até<Input aria-label="Fim da conciliação de recebimentos" type="date" value={through} onChange={event => { setThrough(event.target.value); setResult(null); }} /></label><Button type="button" disabled={busy || invalidRange || !stoneCode} onClick={() => void run()} className="bg-[#d92775] hover:bg-[#bd185c]"><RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Conferindo…" : "Conferir créditos"}</Button></div><p className="mt-3 text-xs text-muted-foreground">Até 31 dias. A consulta usa apenas arquivos Stone publicados e créditos de entrada sincronizados; não cria lançamentos.</p></div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!result && !busy ? <div className="rounded-2xl border border-dashed border-[#d8d3c8] px-6 py-12 text-center"><SearchCheck className="mx-auto h-8 w-8 text-[#bd185c]" aria-hidden="true" /><p className="mt-3 font-bold">Defina o período e confira os créditos</p><p className="mt-1 text-sm text-muted-foreground">Cada liquidação Stone é procurada no extrato entre a data de pagamento e D+2.</p></div> : null}
      {busy ? <div className="h-72 animate-pulse rounded-2xl bg-muted/40" aria-label="Consultando conciliação" /> : null}
      {result ? <><BankCoverageNotice coverage={result.bankCoverage} />{result.stoneCoverage === "partial" ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Arquivos Stone indisponíveis: {result.missingDates.map(dateLabel).join(", ")}.</strong> A consulta não transforma essa lacuna em “sem recebimento”.</p> : null}
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Filtros do resumo da conciliação de recebimentos">{filters.map(item => <button key={item.id} type="button" onClick={() => { setFilter(item.id); setSelectedId(null); }} aria-pressed={filter === item.id} className={`rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#df2f78] ${item.tone} ${filter === item.id ? "ring-2 ring-[#df2f78] ring-offset-1" : "hover:border-[#c9c7bf]"}`}><p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">{item.label}</p><p className="mt-2 font-mono text-xl font-bold text-[#1d1d26]">{item.count}</p><p className="mt-1 text-xs text-muted-foreground">{money(item.amount)} · {item.id === "all" ? "liquidações" : receiptFilterLabels[item.id]}</p></button>)}</div>
        <section className="overflow-hidden rounded-2xl border border-[#e6e3dc]" aria-label="Liquidações e créditos por dia"><div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#eeeae2] bg-[#faf9f6] px-4 py-3"><div><h3 className="text-sm font-extrabold">{filter === "all" ? "Todas as liquidações e créditos" : receiptFilterLabels[filter]}</h3><p className="mt-1 text-xs text-muted-foreground">{rows.length} evidência(s) · clique em uma linha para abrir os fatos Stone e banco.</p></div>{filter !== "all" && allRows.length ? <Button type="button" variant="ghost" size="sm" onClick={() => setFilter("all")}>Limpar filtro</Button> : null}</div>{groups.length ? <div className="divide-y divide-[#eeeae2]">{groups.map(group => { const stoneAmount = group.rows.filter(row => row.kind === "match").reduce((sum, row) => sum + row.match.stone.netAmount, 0); const bankAmount = group.rows.reduce((sum, row) => sum + (row.kind === "match" ? row.match.bank?.amount ?? 0 : row.unmatched.bank.amount), 0); return <section key={group.date}><div className="flex flex-wrap items-center justify-between gap-3 bg-[#fcfbf9] px-4 py-2.5"><div><p className="text-sm font-bold text-[#374151]">{dateLabel(group.date)}</p><p className="text-xs text-muted-foreground">{group.rows.length} evidência(s) · Stone {money(stoneAmount)} · banco {money(bankAmount)}</p></div>{result.missingDates.includes(group.date) ? <Badge className="border-amber-200 bg-amber-50 text-amber-900" variant="outline">Arquivo Stone indisponível</Badge> : null}</div><div className="divide-y divide-[#f1eee8]">{group.rows.map(row => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className="grid w-full gap-3 px-4 py-3 text-left transition hover:bg-[#fdf8fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#df2f78] md:grid-cols-[minmax(180px,1.2fr)_minmax(140px,0.8fr)_100px_150px] md:items-center"><RowSummary row={row} /><RowBankSummary row={row} /><span className="font-mono text-sm font-bold text-[#374151]">{money(receiptRowAmount(row))}</span><span className="flex flex-wrap items-center gap-2"><StatusBadge status={row.status} /><span className="text-xs text-[#bd185c]">Ver evidências →</span></span></button>)}</div></section>; })}</div> : <div role="status" className="px-6 py-12 text-center"><p className="font-bold">Nada neste filtro.</p><p className="mt-1 text-sm text-muted-foreground">Isso não comprova ausência de recebíveis fora do recorte consultado.</p></div>}</section>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul></> : null}
      <EvidenceDrawer row={selectedRow} open={Boolean(selectedRow)} onOpenChange={open => { if (!open) setSelectedId(null); }} />
    </CardContent>
  </Card>;
}
