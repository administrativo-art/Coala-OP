"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CatalogPage, MappingView } from "../agent/configuration";
import { formatStoneMoney } from "../agent/presentation";
import type { DailySalesResult } from "./query";
import type { SalesSourceIssue } from "./daily-review";
import type { SalesMatchFact, SalesReconciliationCaseKind, SalesReconciliationMatchBasis } from "./types";

const channels = { pix: "Pix", debit_card: "Débito", credit_card: "Crédito" };
const kinds: Record<SalesReconciliationCaseKind, string> = {
  matched: "Compatível — conferir", pdv_only: "Só no PDV deste recorte", stone_only: "Só na Stone deste recorte",
  amount_mismatch: "Valores diferentes", status_mismatch: "Estados diferentes", unit_mismatch: "Unidades diferentes",
  unit_unmapped: "Unidade não identificada", ambiguous: "Evidência insuficiente / ambígua",
};
const bases: Record<SalesReconciliationMatchBasis, string> = {
  provider_transaction_id: "ID do provedor", nsu_authorization_terminal: "NSU + autorização + terminal",
  merchant_order: "Referência explícita do pedido", unique_amount_time: "Valor e horário próximos (sugestão)",
  candidate_group: "Grupo de candidatos por horário", unmatched: "Sem par neste recorte",
};
const reasons: Record<SalesSourceIssue["reason"], string> = {
  invalid_coupon: "Cupom sem identificação válida", duplicate_coupon: "Cupom duplicado", invalid_payments: "Pagamentos incompletos ou total divergente",
  invalid_date: "Data inválida ou ausente", outside_day: "Registro fora do dia", unsupported_channel: "Meio de pagamento não comparável",
  invalid_amount: "Valor inválido ou com fração de centavo", non_capture_event: "Evento que não é nova venda",
  cancellation_event: "Cancelamento / estorno / chargeback: conferir histórico", unsupported_capture: "Captura incompleta ou não suportada",
};
const statuses = { approved: "Captura informada", pending: "Estado não comprovado", cancelled: "Cancelado", refunded: "Estornado", chargeback: "Chargeback" };
const money = (cents: number) => {
  const absolute = BigInt(Math.abs(cents));
  return formatStoneMoney(`${cents < 0 ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`);
};
function Evidence({ ids, facts }: { ids: string[]; facts: SalesMatchFact[] }) {
  const selected = facts.filter(fact => ids.includes(fact.id));
  return <details><summary>{ids.length} pagamento(s)</summary><ul className="space-y-2">
    {selected.map(fact => <li key={fact.id} className="break-all">{fact.couponId ? `Cupom ${fact.couponId}` : `Transação ${fact.id}`} · {money(fact.grossAmountCents)}<br />{fact.soldAt} · {statuses[fact.status]}<br />ID da evidência: {fact.id}</li>)}
  </ul></details>;
}

export function SalesReviewPage() {
  const { isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DailySalesResult | null>(null);
  const [channel, setChannel] = useState("all");
  const [page, setPage] = useState(0);
  const [issuePage, setIssuePage] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  if (!isDefaultAdmin) return <PageContainer><p role="alert">Consulta restrita à administração.</p></PageContainer>;
  const mapping = mappings.find(m => m.id === selected);
  const clear = () => { setResult(null); setError(""); setPage(0); setIssuePage(0); setChannel("all"); };
  const task = async (run: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); clear();
    try { await run(controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof AuthenticatedApiError ? e.message : "Não foi possível consultar. Tente novamente."); }
    finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  };
  const load = (next?: string) => task(async signal => {
    const data = await api<CatalogPage<MappingView>>(`/api/financial/stone-mappings?resource=mappings${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, { signal });
    if (signal.aborted) return;
    setMappings(current => next ? [...new Map([...current, ...data.items].map(item => [item.id, item])).values()] : data.items);
    if (!next) { setSelected(""); setCode(""); }
    setCursor(data.nextCursor); setLoaded(true);
  });
  const rows = result?.cases.filter(row => channel === "all" || row.channel === channel) ?? [];
  const selectClass = "w-full rounded-md border bg-background p-2";
  return <PageContainer variant="wide" className="space-y-6 py-6">
    <header><h1 className="text-2xl font-semibold">PDV × Stone · comparação de vendas</h1>
      <p className="text-muted-foreground">Sugestões por unidade, dia e meio de pagamento. Toda correspondência depende de conferência.</p></header>
    <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      Somente leitura. O recorte contém um StoneCode e pode não cobrir todas as vendas da unidade. Pix depende de arquivo processado e validado. Não há confirmação bancária, lançamento ou fechamento automático.
    </div>
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={busy} onClick={() => load()}>{loaded ? "Atualizar vínculos" : "Carregar vínculos"}</Button>
      {cursor && <Button variant="outline" disabled={busy} onClick={() => load(cursor)}>Mais vínculos</Button>}
      <Button variant="outline" asChild><Link href="/dashboard/financial/stone-anticipations">Antecipações e vínculos Stone</Link></Button></div>
    {loaded && !mappings.length && <p role="status">Cadastre o vínculo oficial entre unidade, StoneCode e conta antes de consultar.</p>}
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (!mapping) return; task(async signal => {
      const data = await api<DailySalesResult>("/api/financial/pdv-stone-review", { method: "POST", signal,
        json: { kioskId: mapping.kioskId, mappingId: mapping.id, stoneCode: code, referenceDate: date } });
      if (signal.aborted) return;
      if (data.mappingId !== mapping.id || data.accountId !== mapping.accountId || data.scope.kioskId !== mapping.kioskId || data.scope.stoneCode !== code || data.scope.referenceDate !== date) {
        throw new AuthenticatedApiError("A resposta não corresponde à seleção. Recarregue os vínculos e consulte novamente.", 409, null);
      }
      setResult(data);
    }); }}>
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3">
        <label>Unidade / conta<select required aria-label="Vínculo oficial" className={selectClass} value={selected} onChange={e => { setSelected(e.target.value); setCode(mappings.find(m => m.id === e.target.value)?.stoneCodes[0] ?? ""); clear(); }}>
          <option value="">Selecione</option>{mappings.map(m => <option key={m.id} value={m.id}>{m.kioskName} — {m.accountName}</option>)}</select></label>
        <label>StoneCode<select required aria-label="StoneCode" className={selectClass} value={code} onChange={e => { setCode(e.target.value); clear(); }}>
          <option value="">Selecione</option>{mapping?.stoneCodes.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Dia das vendas<Input required aria-label="Dia das vendas" type="date" value={date} onChange={e => { setDate(e.target.value); clear(); }} /></label>
      </fieldset>
      <p className="text-sm text-muted-foreground">Um dia por consulta, até 500 cupons/eventos por fonte. Arquivo Stone disponível após as 05h do dia seguinte. A unidade precisa ter filial PDV cadastrada.</p>
      {mapping && <p className="text-sm">Vigência do vínculo: {mapping.validFrom} a {mapping.validTo ?? "sem data final"}.</p>}
      <Button type="submit" disabled={busy || !mapping || !code || !date}>{busy ? "Consultando…" : "Comparar vendas"}</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {result && <section aria-label="Resultado da comparação" className="space-y-4">
      <h2 className="text-xl font-semibold">Sugestões pendentes de conferência</h2>
      <p>Dia {result.scope.referenceDate} · Filial PDV {result.pdvFilialId} · StoneCode {result.scope.stoneCode} · Arquivo {result.stoneFileId}</p>
      <p>Consulta: {new Date(result.collectedAt).toLocaleString("pt-BR")} · {result.pdvFacts.length} pagamentos digitais PDV · {result.stoneSales.length} capturas Stone comparáveis · {result.issues.length} apontamentos de fonte.</p>
      <label>Meio de pagamento<select aria-label="Filtrar meio de pagamento" className={selectClass} value={channel} onChange={e => { setChannel(e.target.value); setPage(0); }}>
        <option value="all">Todos os meios</option><option value="pix">Pix</option><option value="debit_card">Débito</option><option value="credit_card">Crédito</option></select></label>
      {!rows.length ? <p>Nenhuma sugestão neste filtro. Isso não comprova ausência de vendas ou divergências.</p> : <>
        <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Comparação de pagamentos e capturas — não conciliados</caption>
          <thead><tr>{["Meio", "PDV", "Stone", "Valor PDV", "Valor Stone", "Diferença Stone − PDV", "Situação / critério"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
          <tbody>{rows.slice(page * 50, (page + 1) * 50).map(row => <tr key={row.deterministicKey} className="border-t align-top">
            <td className="p-2">{channels[row.channel]}</td><td className="p-2"><Evidence ids={row.pdvFactIds} facts={result.pdvFacts} /></td><td className="p-2"><Evidence ids={row.stoneSaleIds} facts={result.stoneSales} /></td>
            <td className="p-2">{money(row.pdvGrossAmountCents)}</td><td className="p-2">{money(row.stoneGrossAmountCents)}</td><td className="p-2">{money(row.differenceAmountCents)}</td>
            <td className="p-2">{kinds[row.kind]}<p className="text-muted-foreground">{bases[row.matchBasis]}</p><p>Conferência pendente</p></td>
          </tr>)}</tbody></table></div>
        <div className="flex items-center gap-3"><Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Anterior</Button><span>Página {page + 1} de {Math.ceil(rows.length / 50)}</span><Button variant="outline" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>Próxima</Button></div>
      </>}
      <details><summary>Fonte Pix: {result.pix.status === "available" ? "disponível no recorte" : "pendente / indisponível"} · PDV não comparado ({result.uncomparedPdvFacts.length})</summary>
        <p>Arquivo: {result.pix.fileId ?? "não configurado"} · Registros excluídos: {result.pix.excludedCount}. Sem arquivo íntegro e vínculo por StoneCode, pagamentos Pix não são classificados como ausentes na Stone.</p>
        <Evidence ids={result.uncomparedPdvFacts.map(f => f.id)} facts={result.uncomparedPdvFacts} />
      </details>
      <details><summary>Apontamentos e eventos fora da comparação ({result.issues.length})</summary>
        <ul className="space-y-2 py-3">{result.issues.slice(issuePage * 50, (issuePage + 1) * 50).map((issue, index) => <li key={`${issuePage}:${index}`} className="break-all">{issue.source.toUpperCase()} · {issue.reference}: {reasons[issue.reason]}</li>)}</ul>
        {result.issues.length > 50 && <div className="flex items-center gap-3"><Button variant="outline" disabled={!issuePage} onClick={() => setIssuePage(issuePage - 1)}>Apontamentos anteriores</Button><span>{issuePage + 1} / {Math.ceil(result.issues.length / 50)}</span><Button variant="outline" disabled={(issuePage + 1) * 50 >= result.issues.length} onClick={() => setIssuePage(issuePage + 1)}>Mais apontamentos</Button></div>}
        <details><summary>Valores e contadores originais de eventos Stone</summary>
          <p>Decimais originais da fonte, sem arredondamento.</p>
          <ul className="space-y-2">{result.stoneEvents.map(event => <li key={`${event.sourceSection}:${event.transactionId}`} className="break-all">{event.sourceSection} · {event.transactionId} · Bruto original: {event.capturedAmount ?? "Não informado"} · Cancelado original: {event.canceledAmount ?? "Não informado"}<br />{Object.entries(event.events).map(([name, count]) => `${name}: ${count}`).join(" · ")}</li>)}</ul>
        </details>
      </details>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </section>}
  </PageContainer>;
}
