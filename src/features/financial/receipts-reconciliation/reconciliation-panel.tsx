"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Landmark, RefreshCw } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatStoneMoney } from "../agent/presentation";
import type { MappingView } from "../agent/configuration";
import type { ReceiptMatchStatus, ReceiptReconciliationResult } from "./reconciliation";

type ReconciliationResponse = ReceiptReconciliationResult & {
  period: { from: string; through: string };
  collectedAt: string;
  scope: { mappingId: string; kioskId: string; accountId: string; stoneCode: string };
  stoneCoverage: "complete" | "partial";
  missingDates: string[];
  files: Array<{ id: string; referenceDate: string; generatedAtProvider: string }>;
};

const statusLabels: Record<ReceiptMatchStatus, string> = {
  received: "Recebido",
  received_with_adjustment: "Recebido com estorno/ajuste",
  stone_payment_review: "Pagamento Stone para revisar",
  awaiting_bank_credit: "Aguardando crédito",
  missing_bank_credit: "Sem crédito após a janela",
  bank_amount_mismatch: "Valor divergente",
  ambiguous_bank_credit: "Mais de um crédito possível",
  bank_only: "Crédito sem par Stone",
};

const statusStyles: Record<ReceiptMatchStatus, string> = {
  received: "border-emerald-200 bg-emerald-50 text-emerald-900",
  received_with_adjustment: "border-amber-200 bg-amber-50 text-amber-950",
  stone_payment_review: "border-amber-200 bg-amber-50 text-amber-950",
  awaiting_bank_credit: "border-sky-200 bg-sky-50 text-sky-950",
  missing_bank_credit: "border-rose-200 bg-rose-50 text-rose-950",
  bank_amount_mismatch: "border-rose-200 bg-rose-50 text-rose-950",
  ambiguous_bank_credit: "border-amber-200 bg-amber-50 text-amber-950",
  bank_only: "border-violet-200 bg-violet-50 text-violet-950",
};

function dateLabel(value: string | null) {
  return value ? value.split("-").reverse().join("/") : "—";
}

function money(value: number | string | null) {
  return formatStoneMoney(value === null ? null : typeof value === "number" ? value.toFixed(2) : value);
}

function localDate(offsetDays: number) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem" }).format(value);
}

function statusIcon(status: ReceiptMatchStatus) {
  if (status === "received") return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />;
  if (status === "awaiting_bank_credit") return <Clock3 className="h-4 w-4" aria-hidden="true" />;
  return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
}

export function StoneBankReceiptReconciliation({ mapping, stoneCode }: { mapping: MappingView; stoneCode: string }) {
  const api = useAuthenticatedApi();
  const [from, setFrom] = useState(() => localDate(-7));
  const [through, setThrough] = useState(() => localDate(-1));
  const [result, setResult] = useState<ReconciliationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (busy || !stoneCode || !from || !through) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<ReconciliationResponse>("/api/financial/stone-receipts/reconcile", {
        method: "POST",
        json: { kioskId: mapping.kioskId, stoneCode, from, through },
      });
      if (next.scope.mappingId !== mapping.id || next.scope.accountId !== mapping.accountId || next.scope.kioskId !== mapping.kioskId || next.scope.stoneCode !== stoneCode) {
        throw new AuthenticatedApiError("O vínculo mudou durante a consulta. Recarregue a página e tente novamente.", 409, null);
      }
      setResult(next);
    } catch (caught) {
      setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível conferir os créditos bancários.");
    } finally {
      setBusy(false);
    }
  };

  const invalidRange = !from || !through || from > through;
  return <Card id="credito-bancario" className="scroll-mt-24 rounded-2xl">
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4 text-pink-700" />Crédito bancário × Stone</CardTitle>
          <CardDescription className="mt-1">O recebimento só fecha quando a liquidação da Stone encontra um crédito importado na conta {mapping.accountId}.</CardDescription>
        </div>
        <Badge variant="outline">Consulta sob demanda</Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div role="note" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
        A data de pagamento da Stone é uma previsão/indício de liquidação. O crédito no extrato do Banco Inter, na conta vinculada, é a evidência de que entrou.
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="text-sm font-medium">Liquidações desde<Input aria-label="Início da conciliação de recebimentos" type="date" value={from} onChange={event => { setFrom(event.target.value); setResult(null); }} /></label>
        <label className="text-sm font-medium">Liquidações até<Input aria-label="Fim da conciliação de recebimentos" type="date" value={through} onChange={event => { setThrough(event.target.value); setResult(null); }} /></label>
        <Button type="button" disabled={busy || invalidRange || !stoneCode} onClick={() => void run()}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Conferindo…" : "Conferir créditos"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Até 31 dias. A consulta usa somente arquivos Stone publicados e créditos de entrada sincronizados do extrato; não cria lançamentos.</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {result ? <>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Resumo da conciliação de recebimentos">
          <div className="rounded-xl border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Stone liquidado</p><p className="mt-1 text-lg font-semibold">{result.summary.totalStoneSettlements}</p><p className="text-xs text-muted-foreground">{money(result.summary.stoneNetAmount)}</p></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Recebido</p><p className="mt-1 text-lg font-semibold text-emerald-950">{result.summary.received + result.summary.receivedWithAdjustment}</p><p className="text-xs text-emerald-800">{money(result.summary.bankMatchedAmount)}</p></div>
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3"><p className="text-xs text-sky-800">Aguardando</p><p className="mt-1 text-lg font-semibold text-sky-950">{result.summary.awaitingBankCredit}</p></div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="text-xs text-rose-800">Pendência</p><p className="mt-1 text-lg font-semibold text-rose-950">{result.summary.missingBankCredit + result.summary.bankAmountMismatch + result.summary.ambiguousBankCredit + result.summary.stonePaymentReview}</p></div>
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3"><p className="text-xs text-violet-800">Crédito sem par</p><p className="mt-1 text-lg font-semibold text-violet-950">{result.summary.bankOnly}</p></div>
        </div>
        {result.stoneCoverage === "partial" ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">Arquivos Stone indisponíveis: {result.missingDates.map(dateLabel).join(", ")}. A consulta não transforma essa lacuna em “sem recebimento”.</p> : null}
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[900px] text-sm"><caption className="sr-only">Liquidações Stone e créditos bancários</caption><thead className="bg-muted/30"><tr><th className="p-3 text-left">Stone</th><th className="p-3 text-left">Data</th><th className="p-3 text-right">Líquido</th><th className="p-3 text-left">Banco</th><th className="p-3 text-left">Situação</th></tr></thead>
            <tbody>{result.matches.map(match => <tr key={match.id} className="border-t align-top">
              <td className="p-3"><span className="font-medium">{match.stone.transactionId}</span><span className="block text-xs text-muted-foreground">Parcela {match.stone.installment} · PaymentId {match.stone.paymentId || "não informado"}</span><span className="block text-xs text-muted-foreground">Venda {dateLabel(match.stone.saleDate)}</span></td>
              <td className="p-3">{dateLabel(match.stone.paymentDate)}<span className="block text-xs text-muted-foreground">Arquivo {match.stone.sourceFileId}</span></td>
              <td className="p-3 text-right font-medium">{money(match.stone.netAmount)}<span className="block text-xs font-normal text-muted-foreground">Bruto {money(match.stone.grossAmount)}</span></td>
              <td className="p-3">{match.bank ? <><span className="font-medium">{money(match.bank.amount)}</span><span className="block max-w-[260px] truncate text-xs text-muted-foreground" title={match.bank.description}>{match.bank.description}</span><span className="block text-xs text-muted-foreground">{dateLabel(match.bank.date)} · {match.bank.id}</span></> : <span className="text-muted-foreground">Não localizado</span>}</td>
              <td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${statusStyles[match.status]}`}>{statusIcon(match.status)}{statusLabels[match.status]}</span><span className="mt-1 block max-w-[300px] text-xs text-muted-foreground">{match.explanation}</span></td>
            </tr>)}
            {result.unmatchedBankCredits.map(item => <tr key={item.id} className="border-t align-top">
              <td className="p-3 text-muted-foreground">Sem liquidação Stone correspondente</td><td className="p-3">{dateLabel(item.bank.date)}</td><td className="p-3 text-right font-medium">—</td><td className="p-3"><span className="font-medium">{money(item.bank.amount)}</span><span className="block max-w-[260px] truncate text-xs text-muted-foreground" title={item.bank.description}>{item.bank.description}</span><span className="block text-xs text-muted-foreground">{item.bank.id}</span></td><td className="p-3"><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${statusStyles.bank_only}`}>{statusIcon("bank_only")}{statusLabels.bank_only}</span><span className="mt-1 block max-w-[300px] text-xs text-muted-foreground">{item.explanation}</span></td>
            </tr>)}
            {!result.matches.length && !result.unmatchedBankCredits.length ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Nenhuma liquidação Stone nem crédito bancário no período.</td></tr> : null}</tbody>
          </table>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
      </> : null}
    </CardContent>
  </Card>;
}
