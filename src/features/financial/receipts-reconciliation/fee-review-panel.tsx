"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonthSelect } from "./month-select";
import { StatusPill } from "@/components/ui/status-pill";
import type { MappingView } from "../agent/configuration";
import type { FeeDecisionInput } from "./fee-review";
import type { FeeReviewView } from "./fee-review.server";
import { FeeHistoryCharts } from "./fee-history-charts";
import { centsLabel, dayLabel, rateLabel } from "./stone-account-format";

const th = "whitespace-nowrap border-y border-ds-divider bg-ds-muted px-[18px] py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint";
const td = "whitespace-nowrap border-b border-ds-divider px-[18px] py-2.5 align-middle text-[13.5px]";
const currentMonth = () => new Date(Date.now() - 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 7);
const REASON = { above: "acima da taxa atual", below: "abaixo da taxa atual", derived: "sem MDR no arquivo, diferente" } as const;
const DECISION = { accepted: "aceita", contested: "contestada", new_rate: "nova taxa", confirmed: "confirmada" } as const;

function Card({ kick, title, sub, aside, children, open, onToggle }: { kick: string; title: string; sub?: string; aside?: React.ReactNode; children?: React.ReactNode; open?: boolean; onToggle?: () => void }) {
  const head = <div className="flex flex-wrap items-end gap-3 px-[18px] pb-3 pt-4">
    <div>
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{kick}</p>
      <h2 className="mt-0.5 flex items-center gap-1 text-[15.5px] font-extrabold text-ds-ink">{onToggle ? open ? <ChevronDown aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 text-ds-ink-faint" /> : null}{title}</h2>
      {sub ? <p className="text-[12.5px] text-ds-ink-muted">{sub}</p> : null}
    </div>
    {aside ? <div className="ml-auto">{aside}</div> : null}
  </div>;
  return <section className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
    {onToggle ? <button type="button" className="block w-full text-left transition-colors hover:bg-ds-input focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent-ink" aria-expanded={open} onClick={onToggle}>{head}</button> : head}
    {children}
  </section>;
}

/**
 * Taxas (layout E1): mudanças de taxa a confirmar, vendas a corrigir, outras cobranças, histórico,
 * taxas atuais e decisões. Referência = taxa atual por recorrência confirmada pelo operador, não o contrato.
 */
export function StoneFeeReviewPanel({ mapping, stoneCode, onPending, onMonthChange, initialMonth }: { initialMonth?:string; mapping: MappingView; stoneCode: string; onPending?: (count: number | null) => void; onMonthChange?: (month: string) => void }) {
  const api = useAuthenticatedApi();
  const [month, setMonth] = useState(()=>initialMonth && /^\d{4}-\d{2}$/.test(initialMonth)?initialMonth:currentMonth());
  const [view, setView] = useState<FeeReviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [salesOpen, setSalesOpen] = useState(true);
  const [effectiveDates,setEffectiveDates]=useState<Record<string,string>>({});
  const [chargesOpen, setChargesOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ kioskId: mapping.kioskId, stoneCode, month });
    return api<FeeReviewView>(`/api/financial/stone-fees?${query}`, { signal });
  }, [api, mapping.kioskId, stoneCode, month]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const controller = new AbortController();
    let alive = true;
    void Promise.resolve().then(() => { if (alive) { setBusy(true); setError(""); } })
      .then(() => load(controller.signal))
      .then(next => { if (alive) setView(next); })
      .catch(caught => { if (alive && !controller.signal.aborted) setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível abrir as taxas."); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; controller.abort(); };
  }, [load, month]);
  useEffect(() => { onPending?.(view?.ready ? view.pendingCount : null); }, [view, onPending]);
  useEffect(() => { onMonthChange?.(month); }, [month, onMonthChange]);

  const decide = async (input: Omit<FeeDecisionInput, "kioskId" | "stoneCode" | "month">) => {
    if (saving) return;
    setSaving(`${input.kind}:${input.itemKey}`); setError("");
    try {
      if (["confirmed","new_rate"].includes(input.decision) && !effectiveDates[input.itemKey]) { setError("Informe a data de início da taxa para confirmar a vigência."); return; }
      await api("/api/financial/stone-fees", { method: "POST", json: { kioskId: mapping.kioskId, stoneCode, month, ...input, ...(["confirmed","new_rate"].includes(input.decision)?{effectiveFrom:effectiveDates[input.itemKey]}:{}) } });
      setView(await load());
    } catch (caught) { setError(caught instanceof AuthenticatedApiError ? caught.message : "Não foi possível gravar a decisão."); }
    finally { setSaving(null); }
  };
  const act = (key: string, label: string, input: Omit<FeeDecisionInput, "kioskId" | "stoneCode" | "month">, danger = false) =>
    <Button key={label} type="button" size="xs" variant={danger ? "danger-link" : "ds-secondary"} disabled={saving !== null} onClick={() => void decide(input)}>{saving === key ? "Gravando…" : label}</Button>;
  const toggleGroup = (key: string) => setOpenGroups(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const exceptionsByGroup = view ? [...new Set(view.exceptions.map(item => item.groupKey))].map(key => ({ key, items: view.exceptions.filter(item => item.groupKey === key) })) : [];
  const effectiveDate=(key:string)=><label className="grid gap-1 text-xs">Início confirmado<Input aria-label={`Início da taxa ${key}`} type="date" value={effectiveDates[key]??""} onChange={e=>setEffectiveDates(p=>({...p,[key]:e.target.value}))} /></label>;
  const totalFees = view ? view.totals.cardFeeCents + view.totals.pixFeeCents + view.totals.anticipationCents : 0;

  return <div className="space-y-[18px]">
    <section className="flex flex-wrap items-end gap-3 rounded-ds-card border border-ds-border bg-ds-surface px-[18px] py-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        {[["Cobrado acima da taxa atual", view ? centsLabel(view.overchargeCents) : "—", "text-ds-danger"], ["Pendências", view ? String(view.pendingCount) : "—", ""],
          ["Taxas do mês", view ? centsLabel(totalFees) : "—", ""], ["Sobre as vendas", view && view.totals.grossCents ? rateLabel((view.totals.cardFeeCents + view.totals.pixFeeCents) / view.totals.grossCents) : "—", ""]].map(([label, value, tone]) =>
          <div key={label}><p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">{label}</p><p className={`tabular-nums text-[19px] font-bold ${tone || "text-ds-ink"}`}>{value}</p></div>)}
      </div>
      <label className="ml-auto grid gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Mês
        <MonthSelect label="Mês das taxas" value={month} onChange={value => { setMonth(value); setView(null); }} />
      </label>
      {view && !view.ready ? <p className="w-full text-xs text-ds-alert-ink">Este mês ainda não foi conferido automaticamente. As taxas aparecem depois da conferência diária (ou use Reconferir agora na aba Recebido).</p> : null}
      {error ? <p role="alert" className="w-full text-sm font-semibold text-ds-danger">{error}</p> : null}
      {busy && !view ? <p role="status" className="w-full text-sm text-ds-ink-muted">Carregando taxas…</p> : null}
    </section>

    {view ? <>
      <p className="text-sm font-semibold">{mapping.kioskName} · {mapping.accountName} · StoneCode {stoneCode}</p>
      {view.referenceSource.unresolved ? <p role="status">Há referências sem escopo/vigência comprovados. Confira o histórico; não foram aplicadas automaticamente.</p> : null}
      {view.changes.length ? <Card kick="Mudanças a confirmar" title={`${view.changes.length} grupo(s) mudaram de taxa`} sub="A taxa nova se repetiu em várias vendas. Confirme se é a nova taxa ou conteste.">
        <ul className="divide-y divide-ds-divider border-t border-ds-divider">{view.changes.map(change => <li key={change.key} className="flex flex-wrap items-center gap-3 px-[18px] py-3">
          <span className="min-w-0 flex-1 text-[13.5px]"><b>{change.label}</b> passou de <b className="tabular-nums">{rateLabel(change.from)}</b> para <b className={`tabular-nums ${change.to > change.from ? "text-ds-danger" : "text-ds-ok"}`}>{rateLabel(change.to)} {change.to > change.from ? "▲" : "▼"}</b> desde {dayLabel(change.since)}
            <span className="block text-xs text-ds-ink-muted">{change.saleCount} vendas com a taxa nova · {change.impactCents >= 0 ? `custo extra ${centsLabel(change.impactCents)}` : `economia ${centsLabel(-change.impactCents)}`}{change.reopened ? " · reaberto: a Stone mudou o dado depois da decisão" : ""}</span></span>
          <span className="flex flex-wrap gap-2">{effectiveDate(change.key)}{act(`rate_change:${change.key}`, "É a nova taxa", { kind: "rate_change", itemKey: change.key, decision: "new_rate", fingerprint: change.fingerprint })}{act(`rate_change:${change.key}`, "Não, contestar", { kind: "rate_change", itemKey: change.key, decision: "contested", fingerprint: change.fingerprint }, true)}</span>
        </li>)}</ul>
      </Card> : null}

      <Card kick="Vendas a corrigir" title={`${view.exceptions.length} venda(s) · ${centsLabel(view.exceptions.filter(item => item.differenceCents > 0).reduce((sum, item) => sum + item.differenceCents, 0))} acima`}
        sub="Taxa vigente na data da venda × cobrada. Cartão respeita arredondamento por parcela; PIX usa corte de centavos. Antecipação não integra o MDR." open={salesOpen} onToggle={() => setSalesOpen(value => !value)}
        aside={view.exceptions.length ? <StatusPill variant="danger">{view.exceptions.length} pendente(s)</StatusPill> : <StatusPill variant="ok">Nada a corrigir</StatusPill>}>
        {salesOpen ? exceptionsByGroup.length ? <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
          <thead><tr><th className={th}>Venda</th><th className={`${th} text-right`}>Bruto</th><th className={`${th} text-right`}>Taxa atual</th><th className={`${th} text-right`}>Cobrada</th><th className={`${th} text-right`}>Diferença</th><th className={th}>Motivo</th><th className={th} /></tr></thead>
          <tbody>{exceptionsByGroup.map(group => {
            const open = openGroups.has(group.key);
            const sum = group.items.reduce((total, item) => total + item.differenceCents, 0);
            return <Fragment key={group.key}>
              <tr className="hover:[&>td]:bg-ds-muted">
                <td colSpan={4} className={`${td} whitespace-nowrap font-extrabold`}><span className="inline-flex items-center gap-1">{open ? <ChevronDown aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}{group.items[0].label} <span className="font-normal text-ds-ink-muted">· {group.items.length} venda(s) · vigente {rateLabel(group.items[0].expectedCents/group.items[0].grossCents)} · cobrada {rateLabel(Math.min(...group.items.map(item=>item.chargedCents/item.grossCents)))} a {rateLabel(Math.max(...group.items.map(item=>item.chargedCents/item.grossCents)))}</span><Button type="button" size="xs" variant="ds-secondary" aria-expanded={open} onClick={()=>toggleGroup(group.key)}>Investigar</Button></span></td>
                <td className={`${td} text-right tabular-nums font-bold ${sum > 0 ? "text-ds-danger" : "text-ds-ok"}`}>{sum > 0 ? "+" : ""}{centsLabel(sum)}</td><td colSpan={2} className={td} />
              </tr>
              {open ? group.items.map(item => <tr key={item.key}>
                <td className={`${td} pl-11 tabular-nums`}>{dayLabel(item.date)} · {item.saleId}{item.reopened ? <span className="ml-2"><StatusPill variant="warn">Reaberto</StatusPill></span> : null}</td>
                <td className={`${td} text-right tabular-nums`}>{centsLabel(item.grossCents)}</td>
                <td className={`${td} text-right tabular-nums`}>{centsLabel(item.expectedCents)}</td>
                <td className={`${td} text-right tabular-nums`}>{centsLabel(item.chargedCents)} <span className="text-ds-ink-faint">({rateLabel(item.chargedCents / item.grossCents)})</span></td>
                <td className={`${td} text-right tabular-nums font-bold ${item.differenceCents > 0 ? "text-ds-danger" : "text-ds-ok"}`}>{item.differenceCents > 0 ? "+" : ""}{centsLabel(item.differenceCents)}</td>
                <td className={`${td} text-xs`}>{REASON[item.reason]}</td>
                <td className={td}><span className="flex flex-wrap gap-1">
                  {act(`sale_fee:${item.key}`, "Aceitar", { kind: "sale_fee", itemKey: item.key, decision: "accepted", fingerprint: item.fingerprint })}
                  {act(`sale_fee:${item.key}`, "Contestar", { kind: "sale_fee", itemKey: item.key, decision: "contested", fingerprint: item.fingerprint }, true)}
                </span></td>
              </tr>) : null}
            </Fragment>;
          })}</tbody>
        </table></div> : <p className="px-[18px] pb-4 text-sm text-ds-ink-muted">Nenhuma venda fora da taxa atual.</p> : null}
      </Card>

      {view.charges.length ? <Card kick="Outras cobranças da Stone" title={`${view.charges.length} cobrança(s) · ${centsLabel(view.charges.reduce((sum, item) => sum + item.amountCents, 0))} fora da taxa da venda`}
        sub="Valores descontados além da taxa da venda (chargeback)." open={chargesOpen} onToggle={() => setChargesOpen(value => !value)} aside={<StatusPill variant="danger">{view.charges.length} pendente(s)</StatusPill>}>
        {chargesOpen ? <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
          <thead><tr><th className={th}>Data</th><th className={th}>Cobrança</th><th className={th}>Venda</th><th className={`${th} text-right`}>Valor</th><th className={th} /></tr></thead>
          <tbody>{view.charges.map(item => <tr key={item.key}>
            <td className={`${td} tabular-nums`}>{dayLabel(item.date)}</td><td className={td}><b>Chargeback</b> · {item.label}{item.reopened ? <span className="ml-2"><StatusPill variant="warn">Reaberto</StatusPill></span> : null}</td>
            <td className={`${td} tabular-nums`}>{item.saleId}</td><td className={`${td} text-right tabular-nums font-bold text-ds-danger`}>{centsLabel(item.amountCents)}</td>
            <td className={td}><span className="flex gap-1">{act(`other_charge:${item.key}`, "Aceitar", { kind: "other_charge", itemKey: item.key, decision: "accepted", fingerprint: item.fingerprint })}{act(`other_charge:${item.key}`, "Contestar", { kind: "other_charge", itemKey: item.key, decision: "contested", fingerprint: item.fingerprint }, true)}</span></td>
          </tr>)}</tbody>
        </table></div> : null}
      </Card> : null}

      <Card kick="Histórico de taxas" title="Evolução da taxa praticada" sub="Taxa que mais se repetiu em cada mês. Passe o cursor para comparar com o mês anterior e o seguinte.">
        <div className="pb-4"><FeeHistoryCharts series={view.history} /></div>
      </Card>

      <Card kick="Sugestões e referências da unidade" title="Referências por grupo" sub="Referência = taxa que mais se repete nos últimos 60 dias (mínimo de 5 vendas), confirmada pelo operador. Não é o contrato.">
        <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
          <thead><tr><th className={th}>Grupo</th><th className={`${th} text-right`}>Taxa atual</th><th className={th}>Desde</th><th className={`${th} text-right`}>Vendas (60 dias)</th><th className={th}>Situação</th></tr></thead>
          <tbody>{view.groups.map(group => <tr key={group.key}>
            <td className={`${td} font-bold`}>{group.label}</td>
            <td className={`${td} text-right tabular-nums`}>{rateLabel(group.reference?.rate ?? null)}</td>
            <td className={`${td} tabular-nums`}>{group.reference ? dayLabel(group.reference.since) : "—"}</td>
            <td className={`${td} text-right tabular-nums`}>{group.saleCount}</td>
            <td className={td}>{!group.reference ? <StatusPill variant="neutral">Sem referência (poucas vendas)</StatusPill>
              : group.reference.status === "confirmed" ? <StatusPill variant="ok">Confirmada</StatusPill>
                : <span className="flex flex-wrap items-center gap-2"><StatusPill variant="warn">Sugerida · não aplicada</StatusPill>{effectiveDate(group.key)}{act(`group_rate:${group.key}`, "Confirmar", { kind: "group_rate", itemKey: group.key, decision: "confirmed", fingerprint: `group:${group.reference.rate}` })}</span>}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>

      {view.recentDecisions.length ? <Card kick="Decisões" title={`${view.recentDecisions.length} decisão(ões) recente(s)`}>
        <ul className="divide-y divide-ds-divider border-t border-ds-divider">{view.recentDecisions.map(item => <li key={`${item.kind}:${item.itemKey}:${item.decidedAt}`} className="flex justify-between gap-3 px-[18px] py-2.5 text-[13px]">
          <span><b>{item.itemKey.replace(/\|/g, " · ")}</b> <span className="text-ds-ink-muted">— {DECISION[item.decision]}</span></span>
          <span className="text-xs text-ds-ink-faint">{new Date(item.decidedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></li>)}</ul>
      </Card> : null}
    </> : null}
  </div>;
}
