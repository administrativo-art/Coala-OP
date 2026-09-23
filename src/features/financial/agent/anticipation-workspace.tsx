"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StoneAnticipationReview } from "@/lib/integrations/stone/anticipation-review";
import type { CatalogOption, CatalogPage, MappingSave, MappingView } from "./configuration";
import { anticipationAnswer, anticipationQuestions, type AnticipationQuestion, type FinancialAgentResult } from "./presentation";

const selectClass = "h-10 rounded-md border bg-background px-3 text-sm w-full";
const blank = (): MappingSave => ({ id: crypto.randomUUID(), revision: 0, kioskId: "", accountId: "", stoneCodes: [],
  status: "active", validFrom: "", validTo: null, reason: "" });
const safeError = (error: unknown) => error instanceof AuthenticatedApiError ? error.message : "Não foi possível concluir. Tente novamente.";

export function AnticipationWorkspace({ onResult }: { onResult: (review: StoneAnticipationReview | null) => void }) {
  const api = useAuthenticatedApi();
  const [mappings, setMappings] = useState<MappingView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState("");
  const [date, setDate] = useState("");
  const [question, setQuestion] = useState<AnticipationQuestion>("summary");
  const [prioritize, setPrioritize] = useState(false);
  const [result, setResult] = useState<FinancialAgentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const [units, setUnits] = useState<CatalogPage<CatalogOption>>({ items: [], nextCursor: null });
  const [accounts, setAccounts] = useState<CatalogPage<CatalogOption>>({ items: [], nextCursor: null });
  const [draft, setDraft] = useState<MappingSave | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState("");
  const [code, setCode] = useState("");
  const mapping = mappings.find(m => m.id === selected);
  const valid = !!mapping && !!date && mapping.validFrom <= date && (!mapping.validTo || mapping.validTo >= date) &&
    (mapping.status === "active" || !!mapping.validTo) && mapping.terminalIds.length === 0;
  const clearResult = () => { setResult(null); onResult(null); setError(""); };
  async function loadMappings(next?: string) {
    clearResult();
    const page = await api<CatalogPage<MappingView>>(`/api/financial/stone-mappings?resource=mappings${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
    setMappings(current => next ? [...current, ...page.items] : page.items); setCursor(page.nextCursor); setLoaded(true);
  }
  async function loadOptions(resource: "units" | "accounts", next?: string) {
    const page = await api<CatalogPage<CatalogOption>>(`/api/financial/stone-mappings?resource=${resource}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
    const setter = resource === "units" ? setUnits : setAccounts;
    setter(current => ({ ...page, items: next ? [...current.items, ...page.items] : page.items }));
  }
  async function task(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setSaved("");
    try { await work(); } catch (e) { setError(safeError(e)); } finally { setBusy(false); }
  }
  function edit(value?: MappingView) {
    setDraft(value ? { id: value.id, revision: value.revision, kioskId: value.kioskId, accountId: value.accountId,
      stoneCodes: value.stoneCodes, status: value.status, validFrom: value.validFrom, validTo: value.validTo ?? null, reason: "" } : blank());
    setConfirmed(false); setSaved("");
  }
  return <section className="space-y-4 rounded-lg border p-4" aria-label="Coala Financeiro — antecipações">
    <h2 className="text-xl font-semibold">Coala Financeiro · Antecipações</h2>
    <p className="text-sm text-muted-foreground">Conversa guiada sobre pagamentos e taxas Stone. Selecione vínculo, código e data; nenhuma ação altera caixa, agenda ou DRE.</p>
    <Link className="inline-block text-sm underline" href="/dashboard/financial/cash-flow/receivables">Conferir previsões de recebíveis por período (não é a carteira completa)</Link>
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" disabled={busy} onClick={() => task(async () => { clearResult(); await loadMappings(); })}>{loaded ? "Atualizar vínculos" : "Carregar vínculos"}</Button>
      {cursor && <Button variant="outline" disabled={busy} onClick={() => task(() => loadMappings(cursor))}>Mais vínculos</Button>}
      <Button variant="outline" disabled={busy} onClick={() => task(async () => {
        setSettings(!settings); if (!settings) { await Promise.all([loadMappings(), loadOptions("units"), loadOptions("accounts")]); }
      })}>{settings ? "Fechar cadastro" : "Configurar vínculos"}</Button>
    </div>
    {loaded && mappings.length === 0 && <p role="status">Nenhum vínculo cadastrado. Configure unidade, StoneCode, conta e vigência antes de consultar.</p>}
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!valid) return; task(async () => {
      clearResult();
      const response = await api<FinancialAgentResult>("/api/financial/agent", { method: "POST", json: {
        intent: "review_anticipations", kioskId: mapping!.kioskId, stoneCode: code, referenceDate: date, prioritizeWithAi: prioritize,
      } });
      if (response.scope.mappingId !== mapping!.id || response.scope.accountId !== mapping!.accountId || response.scope.kioskId !== mapping!.kioskId) {
        throw new AuthenticatedApiError("O vínculo mudou desde a seleção. Atualize os vínculos e consulte novamente.", 409, null);
      }
      setResult(response); onResult(response.review);
    }); }}>
      <div className="grid gap-3 md:grid-cols-3">
        <label>Unidade / conta<select aria-label="Vínculo da unidade" className={selectClass} required disabled={busy} value={selected} onChange={e => {
          setSelected(e.target.value); setCode(mappings.find(m => m.id === e.target.value)?.stoneCodes[0] ?? ""); clearResult();
        }}><option value="">Selecione o vínculo oficial</option>{mappings.map(m => <option key={m.id} value={m.id}>{m.kioskName} — {m.accountName} ({m.validFrom} a {m.validTo ?? "aberto"})</option>)}</select></label>
        <label>StoneCode<select aria-label="StoneCode vinculado" className={selectClass} required disabled={busy} value={code} onChange={e => { setCode(e.target.value); clearResult(); }}><option value="">Selecione</option>{mapping?.stoneCodes.map(c => <option key={c}>{c}</option>)}</select></label>
        <label>Dia do pagamento<Input aria-label="Dia do pagamento" type="date" required disabled={busy} value={date} onChange={e => { setDate(e.target.value); clearResult(); }} /></label>
      </div>
      {mapping && date && !valid && <p role="alert">Vínculo fora da vigência, desativado sem histórico ou restrito por terminal. Revise o cadastro.</p>}
      <label className="block">Sua pergunta<select className={selectClass} aria-label="Pergunta ao Coala Financeiro" value={question} disabled={busy} onChange={e => setQuestion(e.target.value as AnticipationQuestion)}>{Object.entries(anticipationQuestions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={prioritize} disabled={busy} onChange={e => setPrioritize(e.target.checked)} />Usar IA para priorizar as ações de conferência (opcional)</label>
      <Button type="submit" disabled={busy || !valid || !code}>{busy ? "Consultando…" : result ? "Atualizar consulta Stone" : "Consultar Coala Financeiro"}</Button>
    </form>
    {error && <p role="alert">{error}</p>}{saved && <p role="status">{saved}</p>}
    {result && <section className="space-y-3 rounded-md bg-muted p-4" aria-label="Resposta do Coala Financeiro" aria-live="polite">
      <p className="font-medium">Você: {anticipationQuestions[question]}</p><p>Coala Financeiro: {anticipationAnswer(result, question)}</p>
      <p className="text-sm">Unidade: {mapping?.kioskName} · Conta vinculada: {mapping?.accountName} · Data-base: {result.evidence.referenceDate} · Coleta: {new Date(result.evidence.collectedAt).toLocaleString("pt-BR")}</p>
      <p className="text-sm">Fonte: {result.evidence.source}. {result.reasoningMode === "ai_prioritized" ? "Ações priorizadas pela IA." : result.reasoningMode === "deterministic" ? "Análise por regras, sem modelo de IA." : "IA indisponível ou saída rejeitada; análise por regras preservada."}</p>
      <ul className="list-disc pl-5">{result.evidence.actions.map(a => <li key={a.id}>{a.action}</li>)}</ul>
      <p className="text-sm">Você pode trocar a pergunta acima usando a mesma evidência, sem nova chamada à Stone. Para dados atualizados, execute novamente a consulta.</p>
    </section>}
    {settings && <section className="space-y-4 border-t pt-4" aria-label="Cadastro de vínculos Stone">
      <h3 className="font-semibold">Vínculos oficiais — cadastro administrativo</h3>
      <p className="text-sm">Salvar altera somente o cadastro de vínculo e seu histórico de auditoria. Não executa antecipação nem lança taxas na DRE.</p>
      <Button variant="outline" disabled={busy} onClick={() => edit()}>Novo vínculo</Button>
      <ul className="space-y-2">{mappings.map(m => <li key={m.id} className="flex flex-wrap items-center gap-3"><span>{m.kioskName} · {m.stoneCodes.join(", ")} · {m.accountName} · {m.status === "active" ? "Ativo" : "Inativo"}</span><Button variant="outline" disabled={busy || m.terminalIds.length > 0} onClick={() => edit(m)}>Editar vínculo</Button></li>)}</ul>
      {draft && <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!confirmed) return; task(async () => {
        await api("/api/financial/stone-mappings", { method: "POST", json: draft });
        clearResult(); setDraft(null); setSelected(""); setCode("");
        setSaved("Vínculo salvo com justificativa e auditoria. Nenhum valor financeiro foi lançado.");
        await loadMappings();
      }); }}>
        <label className="block">Unidade<select required disabled={busy} className={selectClass} value={draft.kioskId} onChange={e => {setDraft({ ...draft, kioskId: e.target.value }); setConfirmed(false);}}><option value="">Selecione</option>{!units.items.some(u => u.id === draft.kioskId) && draft.kioskId && <option value={draft.kioskId}>{draft.kioskId} (vínculo atual)</option>}{units.items.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        {units.nextCursor && <Button type="button" disabled={busy} variant="outline" onClick={() => task(() => loadOptions("units", units.nextCursor!))}>Mais unidades</Button>}
        <label className="block">Conta financeira<select required disabled={busy} className={selectClass} value={draft.accountId} onChange={e => {setDraft({ ...draft, accountId: e.target.value }); setConfirmed(false);}}><option value="">Selecione</option>{!accounts.items.some(a => a.id === draft.accountId) && draft.accountId && <option value={draft.accountId}>{draft.accountId} (vínculo atual)</option>}{accounts.items.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        {accounts.nextCursor && <Button type="button" disabled={busy} variant="outline" onClick={() => task(() => loadOptions("accounts", accounts.nextCursor!))}>Mais contas</Button>}
        <p className="text-xs">Somente contas com workspace oficial aparecem. Conta ausente deve ser regularizada no cadastro financeiro, sem inferir o vínculo.</p>
        <label className="block">StoneCodes, separados por vírgula<Input required disabled={busy} value={draft.stoneCodes.join(",")} onChange={e => {setDraft({ ...draft, stoneCodes: e.target.value.split(",").map(v => v.trim()) }); setConfirmed(false);}} /></label>
        <div className="grid gap-3 sm:grid-cols-3"><label>Vigência inicial<Input required type="date" disabled={busy} value={draft.validFrom} onChange={e => {setDraft({ ...draft, validFrom: e.target.value }); setConfirmed(false);}} /></label><label>Vigência final (opcional)<Input type="date" disabled={busy} value={draft.validTo ?? ""} onChange={e => {setDraft({ ...draft, validTo: e.target.value || null }); setConfirmed(false);}} /></label><label>Situação<select className={selectClass} disabled={busy} value={draft.status} onChange={e => {setDraft({ ...draft, status: e.target.value as "active" | "inactive" }); setConfirmed(false);}}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label></div>
        <p className="text-xs">Inativo com vigência final preserva consultas históricas. Inativo sem vigência final bloqueia a associação. Não apague histórico para trocar a conta: encerre a vigência e crie outro vínculo.</p>
        <label className="block">Justificativa<Input required minLength={5} maxLength={1000} disabled={busy} value={draft.reason} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></label>
        <label className="flex gap-2"><input type="checkbox" required disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Conferi unidade, StoneCodes, conta e vigência em fonte oficial.</label>
        <div className="flex gap-3"><Button disabled={busy || !confirmed} type="submit">Salvar vínculo confirmado</Button><Button disabled={busy} variant="outline" type="button" onClick={() => setDraft(null)}>Cancelar</Button></div>
      </form>}
    </section>}
  </section>;
}
