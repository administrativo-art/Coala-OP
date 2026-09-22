"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatStoneMoney } from "@/features/financial/agent/presentation";
import type { CatalogPage, MappingView } from "@/features/financial/agent/configuration";
import type { PeriodRow, ReceivablePeriodResult } from "@/features/financial/receivables/period-review";
import { FinancialAnalysisNavigation } from "../agent/analysis-navigation";
import { ReceivableAnalysisPanel } from "./analysis-panel";
import { receivableRowMatches, type ReceivableEvidenceFilter } from "./analysis";

const labels: Record<PeriodRow["status"], string> = { projected: "Previsão no recorte",
  paid_early: "Antecipada — fora da previsão", paid: "Pagamento informado — fora da previsão",
  overdue_unconfirmed: "Vencida sem pagamento identificado", needs_review: "Pendente de conferência" };
const date = (value: string | null) => value ? value.split("-").reverse().join("/") : "Não informado";

export function ReceivablesPage({ agentEntry = false }: { agentEntry?: boolean }) {
  const { isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [result, setResult] = useState<ReceivablePeriodResult | null>(null);
  const [filter, setFilter] = useState<ReceivableEvidenceFilter>("all");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const evidence = useRef<HTMLDivElement>(null);
  if (!isDefaultAdmin) return <PageContainer><p role="alert">Consulta restrita à administração.</p></PageContainer>;
  const mapping = mappings.find(value => value.id === selected);
  const clear = () => { setResult(null); setError(""); setPage(0); setFilter("all"); };
  const task = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); clear();
    try { await work(); } catch (e) { setError(e instanceof AuthenticatedApiError ? e.message : "Não foi possível consultar. Tente novamente."); }
    finally { setBusy(false); }
  };
  const load = (next?: string) => task(async () => {
    const data = await api<CatalogPage<MappingView>>(`/api/financial/stone-mappings?resource=mappings${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
    setMappings(current => next ? [...current, ...data.items] : data.items); setCursor(data.nextCursor); setLoaded(true);
  });
  const rows = result?.rows.filter(row => receivableRowMatches(row, filter)) ?? [];
  const selectClass = "w-full rounded-md border bg-background p-2";
  return <PageContainer variant="wide" className="space-y-6 py-6">
    <header><h1 className="text-2xl font-semibold">{agentEntry ? "Coala Financeiro · Recebíveis" : "Recebíveis · conferência por período"}</h1>
      <p className="text-muted-foreground">Previsões das vendas capturadas no intervalo, confrontadas com pagamentos informados até o último dia consultado.</p></header>
    {agentEntry && <FinancialAnalysisNavigation topic="receivables" />}
    <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      Esta consulta não é a carteira completa nem saldo disponível. Não inclui vendas anteriores ao período, posição da registradora ou confirmação bancária. Nenhum valor será lançado no caixa.
    </div>
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => load()}>{loaded ? "Atualizar vínculos" : "Carregar vínculos"}</Button>
      {cursor && <Button variant="outline" disabled={busy} onClick={() => load(cursor)}>Mais vínculos</Button>}
      <Button variant="outline" asChild><Link href="/dashboard/financial/stone-anticipations">Antecipações e configuração dos vínculos</Link></Button></div>
    {loaded && !mappings.length && <p role="status">Nenhum vínculo disponível. Configure a unidade e a conta antes da consulta.</p>}
    <form onSubmit={event => { event.preventDefault(); if (!mapping) return; task(async () => {
      const data = await api<ReceivablePeriodResult>("/api/financial/stone-future-receivables", { method: "POST", json: { kioskId: mapping.kioskId, stoneCode: code, from, through } });
      if (data.scope.mappingId !== mapping.id || data.scope.accountId !== mapping.accountId || data.scope.kioskId !== mapping.kioskId || data.scope.stoneCode !== code || data.period.from !== from || data.period.through !== through) {
        throw new AuthenticatedApiError("O vínculo ou período mudou. Recarregue e consulte novamente.", 409, null);
      }
      setResult(data);
    }); }} className="space-y-3">
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-4">
        <label>Unidade / conta<select aria-label="Vínculo oficial" required className={selectClass} value={selected} onChange={e => { setSelected(e.target.value); setCode(mappings.find(m => m.id === e.target.value)?.stoneCodes[0] ?? ""); clear(); }}>
          <option value="">Selecione</option>{mappings.map(m => <option key={m.id} value={m.id}>{m.kioskName} — {m.accountName}</option>)}</select></label>
        <label>StoneCode<select aria-label="StoneCode" required className={selectClass} value={code} onChange={e => { setCode(e.target.value); clear(); }}><option value="">Selecione</option>{mapping?.stoneCodes.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Vendas capturadas desde<Input aria-label="Início do período" type="date" required value={from} onChange={e => { setFrom(e.target.value); clear(); }} /></label>
        <label>Eventos conferidos até<Input aria-label="Último dia do período" type="date" required value={through} onChange={e => { setThrough(e.target.value); clear(); }} /></label>
      </fieldset>
      {mapping && <p className="text-sm">Vigência do vínculo: {date(mapping.validFrom)} a {mapping.validTo ? date(mapping.validTo) : "sem data final"}. O servidor confere a associação em todos os dias consultados.</p>}
      <p className="text-sm text-muted-foreground">Até 31 dias por consulta; o vínculo deve cobrir todo o período. Arquivos disponíveis após as 05h do dia seguinte, horário de Brasília.</p>
      <Button type="submit" disabled={busy || !mapping || !code || !from || !through}>{busy ? "Consultando eventos…" : "Conferir previsões"}</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {result && mapping && <ReceivableAnalysisPanel result={result} unitName={mapping.kioskName} accountName={mapping.accountName}
      onInspect={value => { setFilter(value); setPage(0); evidence.current?.focus(); evidence.current?.scrollIntoView({ block: "start" }); }} />}
    {result && <section className="space-y-4" aria-label="Conferência dos recebíveis">
      <p>Fonte: Stone XML 2.2 · {date(result.period.from)} a {date(result.period.through)} · Consulta: {new Date(result.collectedAt).toLocaleString("pt-BR")}</p>
      <p className="text-lg font-semibold">Previsão líquida do recorte: {result.summary.projectedNet === null ? "Não apurada — cobertura vazia ou pendente" : formatStoneMoney(result.summary.projectedNet)}</p>
      <p>{result.summary.projectedCount} parcelas previstas · {result.summary.paidEarlyCount} antecipadas excluídas · {result.summary.paidCount} outros pagamentos excluídos · {result.summary.pendingCount} pendentes · {result.summary.overdueUnconfirmedCount} vencidas sem pagamento identificado.</p>
      <p>{result.summary.paymentsOutsideCaptureCohort} parcelas de pagamento sem captura no recorte; não são somadas nem subtraídas desta previsão.</p>
      {!!result.summary.unsupportedCaptureCount && <p role="alert">{result.summary.unsupportedCaptureCount} capturas sem parcelas utilizáveis. Total não apurado.</p>}
      {!!result.missingDates.length && <p role="alert">Arquivos indisponíveis: {result.missingDates.map(date).join(", ")}. A ausência não significa saldo zero.</p>}
      <div ref={evidence} tabIndex={-1} aria-label="Evidências da análise" className="space-y-3 scroll-mt-4">
      <h2 className="text-lg font-semibold">Parcelas e evidências</h2>
      <label>Situação<select aria-label="Filtrar situação" className={selectClass} value={filter} onChange={e => { setFilter(e.target.value as ReceivableEvidenceFilter); setPage(0); }}><option value="all">Todas</option><option value="paid_records">Pagamentos excluídos da previsão</option><option value="attention">Pendentes e vencidas sem confirmação</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {!rows.length ? <p>Nenhuma parcela para exibir neste recorte/filtro. Isso não comprova ausência de recebíveis.</p> : <>
        <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Previsões e pagamentos por parcela</caption><thead><tr>{["Transação / parcela", "Venda", "Vencimento", "Bruto", "Líquido original", "MDR informado", "Pagamento Stone", "Líquido pago", "Situação / evidências"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
          <tbody>{rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={`${row.transactionId}:${row.installment}`} className="border-t">
            <td className="p-2">{row.transactionId} / {row.installment}</td><td>{date(row.saleDate)}</td><td>{date(row.dueDate)}</td><td>{formatStoneMoney(row.gross)}</td><td>{formatStoneMoney(row.originalNet)}</td><td>{formatStoneMoney(row.mdr)}</td><td>{date(row.paymentDate)}</td><td>{formatStoneMoney(row.paidNet)}</td>
            <td className="p-2">{labels[row.status]}{row.reason && <p>{row.reason}</p>}<p className="text-xs text-muted-foreground">Arquivos: {row.sourceFileIds.join(", ")} · Pagamento: {row.paymentId ?? "não identificado"}</p></td>
          </tr>)}</tbody></table></div>
        <div className="flex items-center gap-3"><Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Anterior</Button><span>Página {page + 1} de {Math.ceil(rows.length / 50)}</span><Button variant="outline" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>Próxima</Button></div>
      </>}
      </div>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </section>}
  </PageContainer>;
}
