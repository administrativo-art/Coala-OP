"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FinancialAnalysisNavigation } from "./analysis-navigation";
import type { CatalogPage, MappingView } from "./configuration";
import type { ManagementResult } from "./management.server";
import type { ManagementRequest } from "./management";

type Routine = { id: string; request: ManagementRequest; enabled: boolean; cadence: "daily" | "weekly";
  revision: number; nextRunAt: string; lastErrorCode: string | null;
  lastRun: { id: string; at: string; alerts: Array<{ code: string; title: string; evidence: string; href: string; acknowledgedAt: string | null }> } | null };
const money = (value: number | null) => value === null ? "Não comprovado" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ManagementPage() {
  const { isDefaultAdmin } = useAuth(); const api = useAuthenticatedApi();
  const [mappings, setMappings] = useState<MappingView[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState(""); const [stoneCode, setStoneCode] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [budget, setBudget] = useState(""); const [materiality, setMateriality] = useState("10000");
  const [includeStone, setIncludeStone] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [result, setResult] = useState<ManagementResult | null>(null); const [routines, setRoutines] = useState<Routine[]>([]);
  const [routineLoaded, setRoutineLoaded] = useState(false); const [enabled, setEnabled] = useState(false);
  const [cadence, setCadence] = useState<"daily" | "weekly">("weekly"); const [feePage, setFeePage] = useState(0);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const mapping = mappings.find(row => row.id === selected);
  const routine = routines.find(row => row.request.kioskId === mapping?.kioskId && row.request.stoneCode === stoneCode);
  useEffect(() => {
    setEnabled(routine?.enabled ?? false);
    setCadence(routine?.cadence ?? "weekly");
    if (routine) {
      setBudget(routine.request.budgetExpenseCents === null ? "" : String(routine.request.budgetExpenseCents));
      setMateriality(String(routine.request.materialityCents));
      setResult(null);
    }
  }, [routine]);
  const reset = () => { setResult(null); setError(""); setNotice(""); setFeePage(0); };
  async function task(fn: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(""); setNotice("");
    try { await fn(controller.signal); } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof AuthenticatedApiError ? e.message : "Não foi possível concluir. Atualize a consulta.");
    } finally { if (!controller.signal.aborted) setBusy(false); if (active.current === controller) active.current = null; }
  }
  const parameters = (): ManagementRequest => ({ kioskId: mapping!.kioskId, mappingId: mapping!.id, stoneCode, month,
    includeStone, budgetExpenseCents: budget ? Number(budget) : null, materialityCents: Number(materiality) });
  async function loadRoutines(signal: AbortSignal) {
    const data = await api<{ items: Routine[] }>("/api/financial/analysis-routines", { signal });
    if (!signal.aborted) { setRoutines(data.items); setRoutineLoaded(true); }
  }
  if (!isDefaultAdmin) return <PageContainer><p role="alert">Análises restritas à administração.</p></PageContainer>;
  const selectClass = "w-full rounded-md border bg-background p-2";
  return <PageContainer variant="wide" className="space-y-6 py-6">
    <header><h1 className="text-2xl font-semibold">Coala Financeiro · análise integrada</h1><p>DRE, taxas, caixa, desvios e acompanhamento. Nenhuma decisão financeira automática.</p></header>
    <FinancialAnalysisNavigation topic="management" />
    <div role="note" className="rounded border p-4">Cobertura parcial e explícita. Recebível não é saldo bancário. Orçamento informado é cenário de análise, não aprovação.</div>
    <Button disabled={busy} variant="outline" onClick={() => task(async signal => {
      const data = await api<CatalogPage<MappingView>>(`/api/financial/stone-mappings?resource=mappings${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
      if (signal.aborted) return;
      setMappings(old => [...new Map([...old, ...data.items].map(row => [row.id, row])).values()]); setCursor(data.nextCursor);
    })}>{cursor ? "Mais vínculos" : "Carregar vínculos oficiais"}</Button>
    <form onSubmit={e => { e.preventDefault(); if (!mapping) return; reset(); task(async signal => {
      const data = await api<ManagementResult>("/api/financial/management-analysis", { method: "POST", json: parameters(), signal });
      if (!signal.aborted) {
        if (data.scope.mappingId !== selected || data.scope.kioskId !== mapping.kioskId || data.scope.stoneCode !== stoneCode || data.scope.month !== month) throw new Error("scope");
        setResult(data);
      }
    }); }} className="space-y-3">
      <fieldset disabled={busy} className="grid gap-3 md:grid-cols-3">
        <label>Unidade / conta<select required className={selectClass} value={selected} onChange={e => { setSelected(e.target.value); setStoneCode(mappings.find(row => row.id === e.target.value)?.stoneCodes[0] ?? ""); reset(); }}>
          <option value="">Selecione</option>{mappings.map(row => <option key={row.id} value={row.id}>{row.kioskName} — {row.accountName}</option>)}</select></label>
        <label>StoneCode<select required className={selectClass} value={stoneCode} onChange={e => { setStoneCode(e.target.value); reset(); }}><option value="">Selecione</option>{mapping?.stoneCodes.map(code => <option key={code}>{code}</option>)}</select></label>
        <label>Competência<Input required type="month" value={month} onChange={e => { setMonth(e.target.value); reset(); }} /></label>
        <label>Orçamento de despesas (centavos, opcional)<Input type="number" min="0" max="100000000000" step="1" value={budget} onChange={e => { setBudget(e.target.value); reset(); }} /></label>
        <label>Materialidade (centavos)<Input required type="number" min="1" max="100000000000" step="1" value={materiality} onChange={e => { setMateriality(e.target.value); reset(); }} /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={includeStone} onChange={e => { setIncludeStone(e.target.checked); reset(); }} />Consultar também taxas e recebíveis Stone (até 31 arquivos)</label>
      </fieldset>
      <p className="text-sm text-muted-foreground">Consulta manual de duas competências da DRE e até 500 movimentos/despesas diretas do mês. Sem atualização periódica da tela.</p>
      <Button disabled={busy || !mapping || !stoneCode} type="submit">{busy ? "Processando…" : "Analisar período"}</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}{notice && <p role="status">{notice}</p>}
    {result && <div className="space-y-6">
      <p>Consulta de {new Date(result.collectedAt).toLocaleString("pt-BR")} · cobertura parcial · conta {result.scope.accountId}</p>
      <section><h2 className="text-xl font-semibold">O que merece atenção?</h2><ul className="space-y-2">{result.alerts.map(alert => <li key={alert.code}><Link className="underline" href={alert.href}>{alert.title}</Link> — {alert.evidence}</li>)}</ul></section>
      <section className="overflow-x-auto"><h2 className="text-xl font-semibold">DRE e histórico</h2><table className="w-full text-sm"><thead><tr>{["Mês", "Receita", "CMV composição", "Despesas", "Resultado", "Pendências"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
        <tbody>{result.months.map(row => <tr key={row.month} className="border-t"><td>{row.month}</td><td>{money(row.revenue)} ({row.revenueBasis === "pdv" ? "PDV" : "fechamento"})</td><td>{money(row.cmv)}</td><td>{money(row.expenseTotal)}</td><td>{money(row.result)}</td><td>{row.issues.length}</td></tr>)}</tbody></table>
        <p>Desvio do orçamento: {money(result.budgetDifferenceCents === null ? null : result.budgetDifferenceCents / 100)} · variação de despesas: {money(result.expenseChangeCents === null ? null : result.expenseChangeCents / 100)}.</p>
        <details><summary>Maiores despesas e origem contábil</summary><ul>{result.months[1].topExpenses.map((row, i) => <li key={`${row.expenseId}:${i}`}>{row.accountName} · {money(row.amount)} · despesa {row.expenseId} · posição {row.position}</li>)}</ul></details>
      </section>
      <section><h2 className="text-xl font-semibold">Caixa: confirmado e previsto</h2>
        <p>Entradas bancárias no período: {money(result.cash.bankInCents / 100)} · saídas: {money(result.cash.bankOutCents / 100)}.</p>
        <p>Despesas diretas previstas: {money(result.cash.forecastOutCents / 100)} · recebíveis líquidos do recorte: {includeStone ? money(result.cash.forecastInCents / 100) : "não consultados"}.</p>
        <p>Posição confirmada: {money(result.cash.confirmedBalance ? result.cash.confirmedBalance.amountCents / 100 : null)} {result.cash.confirmedBalance && `em ${result.cash.confirmedBalance.confirmedAt}`} · saldo final projetado: não comprovado.</p>
        <p>Movimentos excluídos por pendência: {result.cash.excludedCount}.</p>
        <details><summary>Evidências do caixa ({result.cash.movements.length})</summary><ul>{result.cash.movements.map(row => <li key={`${row.status}:${row.id}`}>{row.date} · {row.direction === "in" ? "Entrada" : "Saída"} · {money(row.amountCents / 100)} · {row.status === "bank_confirmed" ? "Extrato bancário" : row.status === "forecast" ? "Previsto" : "Informado, não confirmado"} · {row.id}</li>)}</ul></details>
      </section>
      <section><h2 className="text-xl font-semibold">Taxas: preparar classificação</h2><p>{result.fees.length} evidências. Contas existentes, sem criar despesas. Confira lançamentos anteriores e a competência antes de aprovar.</p>
        <ul>{result.fees.slice(feePage * 50, (feePage + 1) * 50).map((row, i) => <li key={`${feePage}:${i}`}>{row.kind === "mdr" ? "MDR informado" : "Diferença na antecipação — natureza não comprovada"} · {money(row.amountCents / 100)} · {row.accountName ?? "Conta não encontrada — pendente"} · {row.competence} · transação {row.transactionId}, parcela {row.installment}{row.sourcePending ? " · origem pendente" : ""}<details><summary>Arquivos de origem</summary>{row.sourceFileIds.join(", ")}</details></li>)}</ul>
        {result.fees.length > 50 && <div className="flex gap-3"><Button disabled={feePage === 0} onClick={() => setFeePage(feePage - 1)}>Anterior</Button><span>{feePage + 1}</span><Button disabled={(feePage + 1) * 50 >= result.fees.length} onClick={() => setFeePage(feePage + 1)}>Próxima</Button></div>}
      </section>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </div>}
    <section className="space-y-3 border-t pt-4"><h2 className="text-xl font-semibold">Rotinas e acompanhamento</h2>
      <p>Rotinas analisam a competência corrente, sem consultar a Stone repetidamente. A execução automática exige agendador configurado na publicação; salvar uma rotina não publica nem ativa infraestrutura.</p>
      <Button variant="outline" disabled={busy} onClick={() => task(loadRoutines)}>Atualizar rotinas</Button>
      <fieldset disabled={busy} className="flex flex-wrap items-center gap-3"><label>Frequência<select className={selectClass} value={cadence} onChange={e => setCadence(e.target.value as "daily" | "weekly")}><option value="weekly">Semanal</option><option value="daily">Diária</option></select></label>
        <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Habilitada para o agendador</label>
        <Button disabled={!mapping || !stoneCode || !routineLoaded} onClick={() => task(async signal => {
          await api("/api/financial/analysis-routines", { method: "POST", signal, json: { action: "save", request: parameters(), cadence, enabled, revision: routine?.revision ?? 0 } });
          await loadRoutines(signal); if (!signal.aborted) setNotice("Configuração salva. Nenhum lançamento financeiro realizado.");
        })}>Salvar rotina da unidade selecionada</Button>
      </fieldset>
      {routines.map(row => <article key={row.id} className="space-y-2 rounded border p-3"><h3>{mappings.find(m => m.kioskId === row.request.kioskId)?.kioskName ?? row.request.kioskId} · {row.request.stoneCode}</h3>
        <p>{row.enabled ? "Habilitada" : "Desabilitada"} · {row.cadence === "daily" ? "Diária" : "Semanal"} · próxima: {row.nextRunAt}{row.lastErrorCode ? " · última execução falhou; revisar fonte/vínculo" : ""}</p>
        <Button variant="outline" disabled={busy} onClick={() => task(async signal => { await api("/api/financial/analysis-routines", { method: "POST", signal, json: { action: "run", id: row.id } }); await loadRoutines(signal); })}>Executar conferência agora</Button>
        {row.lastRun && <p>Última análise: {row.lastRun.at}. Alterar a configuração não recalcula este histórico.</p>}
        <ul>{row.lastRun?.alerts.map(alert => <li key={alert.code}><Link className="underline" href={alert.href}>{alert.title}</Link> — {alert.evidence} {alert.acknowledgedAt ? "· ciência registrada (não resolve a origem)" : <Button size="sm" variant="outline" disabled={busy} onClick={() => task(async signal => { await api("/api/financial/analysis-routines", { method: "POST", signal, json: { action: "acknowledge", id: row.id, runId: row.lastRun!.id, alertCode: alert.code } }); await loadRoutines(signal); })}>Registrar ciência</Button>}</li>)}</ul>
      </article>)}
    </section>
  </PageContainer>;
}
