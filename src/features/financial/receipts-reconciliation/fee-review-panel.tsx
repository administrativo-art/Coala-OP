"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Segmented } from "@/components/patterns/segmented";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { MappingView } from "../agent/configuration";
import { StoneFeeMonthExpensePanel } from "./fee-month-expense-panel";
import { FeeReferenceComparisonPanel } from "./fee-reference-comparison-panel";
import { ContactSheet, CloseSheet, ContestSheet, NewRateSheet } from "./fee-occurrence-sheets";
import { FeeHistoryCharts, type FeeHistorySeries } from "./fee-history-charts";
import {
  OCCURRENCE_CATEGORY, OCCURRENCE_OUTCOMES, OCCURRENCE_REASONS, type FeeOccurrence, type FeeOccurrenceKind, type FeeOccurrenceStatus,
} from "./fee-occurrence";
import type { FeeDecisionInput, FeeHistoryPeriod } from "./fee-review";
import type { FeeReviewView } from "./fee-review.server";
import { MonthSelect } from "./month-select";
import { centsLabel, dayLabel, fullDateLabel, rateLabel } from "./stone-account-format";

const th = "whitespace-nowrap border-y border-ds-divider bg-ds-muted px-[18px] py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint";
const td = "border-b border-ds-divider px-[18px] py-2.5 align-middle text-[13.5px]";
const PAGE_ROWS = 50;

export type FeeTarget = { mapping: MappingView; stoneCode: string };
export type FeeSummary = { totalFeesCents: number; feeRate: number | null; overchargeCents: number; pending: number; withStone: number; ready: boolean };
type Entry = { target: FeeTarget; view: FeeReviewView | null; error: string };
type Tab = "decide" | "occurrences" | "history" | "units" | "accounting";
type Category = "all" | FeeOccurrenceKind;

const targetKey = (target: FeeTarget) => `${target.mapping.id}:${target.stoneCode}`;
const errorText = (caught: unknown, fallback: string) => caught instanceof AuthenticatedApiError ? caught.message : fallback;
const CATEGORY_VARIANT: Record<FeeOccurrenceKind, StatusPillVariant> = { rate_change: "warn", sale_fee: "danger", other_charge: "neutral" };
const STATUS_VIEW: Record<FeeOccurrenceStatus, { label: string; variant: StatusPillVariant }> = {
  open: { label: "Aberta", variant: "warn" }, in_progress: { label: "Em andamento", variant: "info" }, closed: { label: "Finalizada", variant: "ok" },
};
const percent = (rate: number) => rateLabel(rate);

/** Busca a conferência de cada vínculo (até 3 em paralelo) e permite recarregar um só depois de uma decisão. */
function useFeeEntries(targets: FeeTarget[], month: string) {
  const api = useAuthenticatedApi();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [busy, setBusy] = useState(false);
  const fetchOne = useCallback(async (target: FeeTarget, signal?: AbortSignal): Promise<Entry> => {
    const query = new URLSearchParams({ kioskId: target.mapping.kioskId, stoneCode: target.stoneCode, month });
    try { return { target, view: await api<FeeReviewView>(`/api/financial/stone-fees?${query}`, { signal }), error: "" }; }
    catch (caught) { if (signal?.aborted) throw caught; return { target, view: null, error: errorText(caught, "Não foi possível abrir as taxas.") }; }
  }, [api, month]);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      setBusy(true); setEntries({});
      const queue = [...targets];
      const worker = async () => {
        for (let target = queue.shift(); target; target = queue.shift()) {
          const entry = await fetchOne(target, controller.signal);
          if (alive) setEntries(current => ({ ...current, [targetKey(target)]: entry }));
        }
      };
      try { await Promise.all([worker(), worker(), worker()]); } catch { /* cancelado */ } finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; controller.abort(); };
  }, [targets, fetchOne]);
  const reload = useCallback(async (target: FeeTarget) => {
    const entry = await fetchOne(target);
    setEntries(current => ({ ...current, [targetKey(target)]: entry }));
  }, [fetchOne]);
  return { entries, busy, reload };
}

type DecideRow = {
  id: string; target: FeeTarget; kind: FeeOccurrenceKind; key: string; fingerprint: string; label: string; sub: string; date: string; dateLabel: string;
  detail: ReactNode; impactCents: number; reopened: boolean; reason?: string; since?: string;
};

function decideRows(entry: Entry): DecideRow[] {
  const view = entry.view;
  if (!view) return [];
  const id = targetKey(entry.target);
  return [
    ...view.changes.map((change): DecideRow => ({ id: `${id}:rate_change:${change.key}`, target: entry.target, kind: "rate_change", key: change.key, fingerprint: change.fingerprint, label: change.label, sub: `${change.saleCount} vendas`,
      date: change.since, dateLabel: `desde ${fullDateLabel(change.since)}`, impactCents: change.impactCents, reopened: change.reopened, since: change.since,
      detail: <>{percent(change.from)} → <b className={change.to > change.from ? "text-ds-danger" : "text-ds-ok"}>{percent(change.to)} {change.to > change.from ? "▲" : "▼"}</b></> })),
    ...view.exceptions.map((item): DecideRow => ({ id: `${id}:sale_fee:${item.key}`, target: entry.target, kind: "sale_fee", key: item.key, fingerprint: item.fingerprint, label: item.label, sub: `venda ${item.saleId}`,
      date: item.date, dateLabel: fullDateLabel(item.date), impactCents: item.differenceCents, reopened: item.reopened,
      reason: item.reason === "above" ? "acima da taxa atual" : item.reason === "below" ? "abaixo da taxa atual" : "sem MDR no arquivo, diferente",
      detail: <>{percent(item.expectedCents / item.grossCents)} → <b className={item.differenceCents > 0 ? "text-ds-danger" : "text-ds-ok"}>{percent(item.chargedCents / item.grossCents)}</b> · {centsLabel(item.grossCents)}</> })),
    ...view.charges.map((item): DecideRow => ({ id: `${id}:other_charge:${item.key}`, target: entry.target, kind: "other_charge", key: item.key, fingerprint: item.fingerprint, label: "Chargeback", sub: `venda ${item.saleId}`,
      date: item.date, dateLabel: fullDateLabel(item.date), impactCents: item.amountCents, reopened: item.reopened, detail: item.label })),
  ];
}

type Sheet =
  | { type: "new_rate"; row: DecideRow } | { type: "contest"; row: DecideRow }
  | { type: "contact"; occurrence: FeeOccurrence; target: FeeTarget } | { type: "close"; occurrence: FeeOccurrence; target: FeeTarget };

const unitName = (target: FeeTarget) => target.mapping.kioskName;

function Card({ kick, title, sub, aside, children }: { kick: string; title: string; sub?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return <section className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
    <div className="flex flex-wrap items-end gap-3 px-[18px] pb-3 pt-4">
      <div className="min-w-0 max-w-3xl">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">{kick}</p>
        <h2 className="mt-0.5 text-[15.5px] font-extrabold text-ds-ink">{title}</h2>
        {sub ? <p className="text-[12.5px] text-ds-ink-muted">{sub}</p> : null}
      </div>
      {aside ? <div className="ml-auto">{aside}</div> : null}
    </div>
    {children}
  </section>;
}

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">{options.map(option => <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}
    className={cn("h-8 rounded-full border px-3 text-[12.5px] font-bold", option.value === value ? "border-ds-accent bg-ds-accent text-white" : "border-ds-border-input bg-ds-surface text-ds-ink-2 hover:bg-ds-muted")}>{option.label}</button>)}</div>;
}

/**
 * Taxas: três visões (A decidir, Ocorrências, Histórico) sobre a conferência do mês. Com vários vínculos (`targets`),
 * soma a leitura de cada um e mostra a coluna Unidade; histórico e referências só existem na visão individual.
 * A referência é a taxa que mais se repete (60 dias, mínimo de 5 vendas), confirmada pelo operador; não é o contrato.
 */
export function StoneFeeReviewPanel({ targets, initialMonth, onSummary, onMonthChange, onOpenUnit, onPendingChange }: {
  targets: FeeTarget[]; initialMonth?: string; onSummary?: (summary: FeeSummary | null) => void; onMonthChange?: (month: string) => void;
  onOpenUnit?: (target: FeeTarget) => void; onPendingChange?: (count: number | null) => void;
}) {
  const api = useAuthenticatedApi();
  const currentMonth = () => new Date(Date.now() - 8 * 3_600_000 - 86_400_000).toISOString().slice(0, 7);
  const [month, setMonth] = useState(() => initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : currentMonth());
  const [pickedTab, setTab] = useState<Tab>("decide");
  const [category, setCategory] = useState<Category>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | FeeOccurrenceStatus>("all");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [shown, setShown] = useState(PAGE_ROWS);
  const [version, setVersion] = useState(0);
  const { entries, busy, reload } = useFeeEntries(targets, month);
  const all = targets.length > 1;
  // Histórico e contabilização só existem na visão individual; "Por unidade", só na consolidada.
  const tab: Tab = all ? (pickedTab === "history" || pickedTab === "accounting" ? "units" : pickedTab) : (pickedTab === "units" ? "decide" : pickedTab);
  const single = targets.length === 1 ? targets[0] : null;
  const loaded = targets.map(target => entries[targetKey(target)]).filter((entry): entry is Entry => Boolean(entry));
  const failures = loaded.filter(entry => entry.error);
  const views = loaded.flatMap(entry => entry.view ? [{ entry, view: entry.view }] : []);
  const ready = views.filter(item => item.view.ready);
  const rows = loaded.flatMap(decideRows);
  const occurrences = views.flatMap(({ entry, view }) => view.occurrences.map(occurrence => ({ occurrence, target: entry.target })))
    .sort((a, b) => b.occurrence.openedAt.localeCompare(a.occurrence.openedAt));
  const withStone = occurrences.filter(item => item.occurrence.status !== "closed").length;
  const totals = ready.reduce((sum, { view }) => ({
    fees: sum.fees + view.totals.cardFeeCents + view.totals.pixFeeCents + view.totals.anticipationCents, salesFees: sum.salesFees + view.totals.cardFeeCents + view.totals.pixFeeCents, gross: sum.gross + view.totals.grossCents,
    card: sum.card + view.totals.cardFeeCents, pix: sum.pix + view.totals.pixFeeCents, anticipation: sum.anticipation + view.totals.anticipationCents, over: sum.over + view.overchargeCents,
  }), { fees: 0, salesFees: 0, gross: 0, card: 0, pix: 0, anticipation: 0, over: 0 });
  const complete = targets.length > 0 && loaded.length === targets.length && !busy;
  const pending = rows.length;

  useEffect(() => { onMonthChange?.(month); }, [month, onMonthChange]);
  useEffect(() => {
    onSummary?.(complete && ready.length ? { totalFeesCents: totals.fees, feeRate: totals.gross ? totals.salesFees / totals.gross : null, overchargeCents: totals.over, pending, withStone, ready: true } : null);
    onPendingChange?.(complete && ready.length ? pending : null);
  }, [complete, ready.length, totals.fees, totals.salesFees, totals.gross, totals.over, pending, withStone, onSummary, onPendingChange]);

  const post = async (target: FeeTarget, json: Record<string, unknown>) => {
    await api("/api/financial/stone-fees", { method: "POST", json: { kioskId: target.mapping.kioskId, stoneCode: target.stoneCode, month, ...json } });
    await reload(target); setVersion(value => value + 1);
  };
  const decide = async (row: DecideRow, input: Pick<FeeDecisionInput, "decision"> & Partial<FeeDecisionInput>) => {
    await post(row.target, { kind: row.kind, itemKey: row.key, fingerprint: row.fingerprint, ...input });
  };
  const accept = async (row: DecideRow) => {
    if (saving) return;
    setSaving(row.id); setMessage("");
    try { await decide(row, { decision: "accepted" }); } catch (caught) { setMessage(errorText(caught, "Não foi possível gravar a decisão.")); } finally { setSaving(null); }
  };
  const failure = (caught: unknown, fallback: string) => errorText(caught, fallback);
  const summaryOf = (row: DecideRow) => <><span className="mb-1 flex flex-wrap items-center gap-2"><StatusPill variant={CATEGORY_VARIANT[row.kind]}>{OCCURRENCE_CATEGORY[row.kind]}</StatusPill>{all ? <span className="text-xs text-ds-ink-muted">{unitName(row.target)}</span> : null}</span>
    <b>{row.label}</b> · {row.sub}<br />{row.dateLabel} · {row.detail} · <b className={row.impactCents > 0 ? "text-ds-danger" : "text-ds-ok"}>{centsLabel(row.impactCents)}</b></>;
  const occurrenceSummary = (occurrence: FeeOccurrence, target: FeeTarget) => <><span className="mb-1 flex flex-wrap items-center gap-2"><StatusPill variant={STATUS_VIEW[occurrence.status].variant}>{STATUS_VIEW[occurrence.status].label}</StatusPill>{all ? <span className="text-xs text-ds-ink-muted">{unitName(target)}</span> : null}</span>
    <b>{occurrence.label}</b> · <b className="text-ds-danger">{centsLabel(occurrence.amountCents)}</b><br />Aberta em {fullDateLabel(occurrence.openedAt.slice(0, 10))}{occurrence.protocol ? ` · protocolo ${occurrence.protocol}` : " · sem protocolo"}{occurrence.contacts.length ? ` · ${occurrence.contacts.length} contato(s)` : ""}</>;

  const filtered = rows.filter(row => category === "all" || row.kind === category);
  const countOf = (kind: Category) => kind === "all" ? rows.length : rows.filter(row => row.kind === kind).length;
  const filteredOccurrences = occurrences.filter(item => statusFilter === "all" || item.occurrence.status === statusFilter);
  const countStatus = (status: "all" | FeeOccurrenceStatus) => status === "all" ? occurrences.length : occurrences.filter(item => item.occurrence.status === status).length;
  const overcharge = rows.filter(row => row.impactCents > 0).reduce((sum, row) => sum + row.impactCents, 0);
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "decide", label: `A decidir · ${pending}` }, { value: "occurrences", label: `Ocorrências · ${withStone}` },
    ...(all ? [{ value: "units" as const, label: "Por unidade" }] : [{ value: "history" as const, label: "Histórico" }, { value: "accounting" as const, label: "Contabilização" }]),
  ];
  const first = views[0]?.view;
  const unresolved = views.some(({ view }) => view.referenceSource.unresolved);

  return <div className="space-y-[18px]">
    <section className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 px-[18px] py-3.5">
        <label className="grid gap-1.5 text-xs font-bold text-ds-ink-2">Competência<MonthSelect label="Mês das taxas" value={month} onChange={value => { setMonth(value); setShown(PAGE_ROWS); }} /></label>
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Taxas do mês</p><p className="tabular-nums text-[22px] font-extrabold tracking-tight">{complete && ready.length ? centsLabel(totals.fees) : "—"}</p></div>
        <div className="ml-auto flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ds-ink-muted">
          <span>Cartão <b className="tabular-nums text-ds-ink">{ready.length ? centsLabel(totals.card) : "—"}</b></span>
          <span>Pix <b className="tabular-nums text-ds-ink">{ready.length ? centsLabel(totals.pix) : "—"}</b></span>
          <span>Antecipação <b className="tabular-nums text-ds-ink">{ready.length ? centsLabel(totals.anticipation) : "—"}</b></span>
        </div>
      </div>
      {single && first ? <div className="border-t border-ds-divider px-[18px] pb-3.5 pt-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3"><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Taxa de referência</p><p className="text-xs text-ds-ink-muted">Taxa que mais se repete nos últimos 60 dias (mínimo de 5 vendas), confirmada por você. Não é o contrato.</p></div>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{first.groups.map(group => <ReferenceCard key={group.key} group={group} busy={saving !== null}
          onConfirm={async effectiveFrom => { setSaving(`group:${group.key}`); setMessage(""); try { await post(single, { kind: "group_rate", itemKey: group.key, decision: "confirmed", fingerprint: `group:${group.reference!.rate}`, effectiveFrom }); } catch (caught) { setMessage(failure(caught, "Não foi possível confirmar a referência.")); } finally { setSaving(null); } }} />)}
          {!first.groups.length ? <p className="text-sm text-ds-ink-muted">Ainda não há vendas para sugerir referências.</p> : null}</div>
      </div> : null}
      {first && !first.ready && single ? <p className="border-t border-ds-divider px-[18px] py-2.5 text-xs text-ds-alert-ink">Este mês ainda não foi conferido automaticamente. As taxas aparecem depois da conferência diária (ou use Reconferir agora na aba Recebido).</p> : null}
      {unresolved ? <p role="status" className="border-t border-ds-divider px-[18px] py-2.5 text-xs text-ds-alert-ink">Há referências sem escopo ou vigência comprovados. Confira o histórico; elas não foram aplicadas automaticamente.</p> : null}
      {message ? <p role="alert" className="border-t border-ds-divider px-[18px] py-2.5 text-sm font-semibold text-ds-danger">{message}</p> : null}
      {failures.map(entry => <p key={targetKey(entry.target)} role="alert" className="border-t border-ds-divider px-[18px] py-2.5 text-sm font-semibold text-ds-danger">{all ? `${unitName(entry.target)}: ` : ""}{entry.error}</p>)}
      {busy ? <p role="status" className="border-t border-ds-divider px-[18px] py-2.5 text-sm text-ds-ink-muted">{all ? `Carregando taxas… ${loaded.length} de ${targets.length} vínculos` : "Carregando taxas…"}</p> : null}
    </section>

    <div className="flex max-w-full overflow-x-auto"><div role="tablist" aria-label="Visões das taxas" className="inline-flex rounded-ds-md bg-ds-seg p-[3px]">{tabs.map(item => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} onClick={() => setTab(item.value)}
      className={cn("h-9 whitespace-nowrap rounded-ds-sm px-4 text-[13px] font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink", tab === item.value ? "bg-ds-surface text-ds-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]" : "text-ds-ink-muted hover:text-ds-ink")}>{item.label}</button>)}</div></div>

    {tab === "decide" ? <Card kick="A decidir" title={pending ? `${pending} ${pending === 1 ? "item" : "itens"} · ${centsLabel(overcharge)} acima do esperado` : "Nada a decidir neste mês"}
      sub="Taxas e cobranças que você precisa aceitar ou contestar. Contestar abre uma ocorrência com a Stone."
      aside={<Chips label="Categoria" value={category} onChange={value => { setCategory(value); setShown(PAGE_ROWS); }} options={[{ value: "all", label: `Todas · ${countOf("all")}` }, { value: "rate_change", label: `Nova taxa · ${countOf("rate_change")}` }, { value: "sale_fee", label: `Fora do padrão · ${countOf("sale_fee")}` }, { value: "other_charge", label: `Cobrança extra · ${countOf("other_charge")}` }]} />}>
      {filtered.length ? <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
        <thead><tr>{all ? <th className={th}>Unidade</th> : null}<th className={th}>Categoria</th><th className={th}>Item</th><th className={th}>Data</th><th className={th}>Detalhe</th><th className={`${th} text-right`}>Impacto</th><th className={th} /></tr></thead>
        <tbody>{filtered.slice(0, shown).map(row => <tr key={row.id}>
          {all ? <td className={`${td} font-bold`}>{unitName(row.target)}</td> : null}
          <td className={td}><span className="flex items-center gap-1.5"><StatusPill variant={CATEGORY_VARIANT[row.kind]}>{OCCURRENCE_CATEGORY[row.kind]}</StatusPill>{row.reopened ? <StatusPill variant="warn">Reaberto</StatusPill> : null}</span></td>
          <td className={td}><b>{row.label}</b><span className="block text-xs text-ds-ink-muted">{row.sub}</span></td>
          <td className={`${td} whitespace-nowrap tabular-nums`}>{row.dateLabel}</td>
          <td className={`${td} tabular-nums`}>{row.detail}{row.reason ? <span className="block text-xs text-ds-ink-muted">{row.reason}</span> : null}</td>
          <td className={`${td} whitespace-nowrap text-right tabular-nums font-bold ${row.impactCents > 0 ? "text-ds-danger" : "text-ds-ok"}`}>{row.impactCents > 0 ? "+" : ""}{centsLabel(row.impactCents)}</td>
          <td className={`${td} whitespace-nowrap text-right`}><span className="inline-flex items-center gap-1">
            {row.kind === "rate_change" ? <Button type="button" size="xs" variant="ds-secondary" disabled={saving !== null} onClick={() => setSheet({ type: "new_rate", row })}>É a nova taxa</Button>
              : <Button type="button" size="xs" variant="ds-secondary" disabled={saving !== null} onClick={() => void accept(row)}>{saving === row.id ? "Gravando…" : "Aceitar"}</Button>}
            <Button type="button" size="xs" variant="danger-link" disabled={saving !== null} onClick={() => setSheet({ type: "contest", row })}>Contestar</Button></span></td>
        </tr>)}</tbody>
      </table>{filtered.length > shown ? <div className="flex justify-center border-t border-ds-divider py-3"><Button type="button" size="sm" variant="ds-secondary" onClick={() => setShown(value => value + PAGE_ROWS)}>Mostrar mais ({filtered.length - shown})</Button></div> : null}</div>
        : <p className="flex items-center gap-2 px-[18px] pb-4 text-sm text-ds-ink-muted">{complete ? <><StatusPill variant="ok">Em dia</StatusPill>Nenhuma taxa fora da referência neste mês. O que estiver com a Stone continua em Ocorrências.</> : "Carregando…"}</p>}
    </Card> : null}

    {tab === "occurrences" ? <Card kick="Ocorrências" title={`${occurrences.length} ${occurrences.length === 1 ? "ocorrência" : "ocorrências"} · ${withStone} com a Stone`}
      sub="Itens contestados. Aberta: sem contato ainda. Em andamento: contato feito, aguardando a Stone. Finalizada: com resultado. Abertas e em andamento não entram no selo de pendências."
      aside={<Chips label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: `Todas · ${countStatus("all")}` }, { value: "open", label: `Abertas · ${countStatus("open")}` }, { value: "in_progress", label: `Em andamento · ${countStatus("in_progress")}` }, { value: "closed", label: `Finalizadas · ${countStatus("closed")}` }]} />}>
      {filteredOccurrences.length ? <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
        <thead><tr>{all ? <th className={th}>Unidade</th> : null}<th className={th}>Status</th><th className={th}>Categoria</th><th className={th}>Item</th><th className={`${th} text-right`}>Valor</th><th className={th}>Aberta em</th><th className={th}>Protocolo</th><th className={th}>Último contato / resultado</th><th className={th} /></tr></thead>
        <tbody>{filteredOccurrences.map(({ occurrence, target }) => {
          const last = occurrence.contacts.at(-1);
          return <tr key={occurrence.id}>
            {all ? <td className={`${td} font-bold`}>{unitName(target)}</td> : null}
            <td className={td}><StatusPill variant={STATUS_VIEW[occurrence.status].variant}>{STATUS_VIEW[occurrence.status].label}</StatusPill></td>
            <td className={td}><StatusPill variant={CATEGORY_VARIANT[occurrence.kind]}>{OCCURRENCE_CATEGORY[occurrence.kind]}</StatusPill></td>
            <td className={td}><b>{occurrence.label}</b>{occurrence.reason ? <span className="block text-xs text-ds-ink-muted">{OCCURRENCE_REASONS[occurrence.reason]}</span> : null}</td>
            <td className={`${td} whitespace-nowrap text-right tabular-nums`}>{centsLabel(occurrence.amountCents)}</td>
            <td className={`${td} whitespace-nowrap tabular-nums`}>{fullDateLabel(occurrence.openedAt.slice(0, 10))}</td>
            <td className={`${td} whitespace-nowrap`}>{occurrence.protocol ?? <span className="text-ds-ink-muted">Sem protocolo</span>}</td>
            <td className={td}>{occurrence.outcome ? <>{OCCURRENCE_OUTCOMES[occurrence.outcome]}{occurrence.refundedCents ? ` · ${centsLabel(occurrence.refundedCents)}` : ""} · {fullDateLabel(occurrence.resolvedOn)}</>
              : last ? `${fullDateLabel(last.contactDate)}` : <span className="text-ds-ink-muted">Sem contato</span>}</td>
            <td className={`${td} whitespace-nowrap text-right`}>{occurrence.status !== "closed" ? <Button type="button" size="xs" variant="ds-secondary" onClick={() => setSheet({ type: "contact", occurrence, target })}>Registrar contato</Button> : null}</td>
          </tr>;
        })}</tbody></table></div>
        : <p className="px-[18px] pb-4 text-sm text-ds-ink-muted">{occurrences.length ? "Nenhuma ocorrência neste status." : "Nenhuma ocorrência. Ao contestar um item, ele aparece aqui como Aberta."}</p>}
    </Card> : null}

    {tab === "units" ? <Card kick="Por unidade" title={`Visão consolidada · ${targets.length} vínculos`} sub="Cada unidade tem a própria referência de taxa; por isso a taxa não é somada, só comparada. Abra uma unidade para ver o histórico e confirmar referências.">
      <div className="overflow-x-auto"><table className="w-full border-separate border-spacing-0">
        <thead><tr><th className={th}>Unidade</th><th className={th}>StoneCode</th><th className={`${th} text-right`}>Taxas do mês</th><th className={`${th} text-right`}>Sobre as vendas</th><th className={`${th} text-right`}>Acima da taxa</th><th className={`${th} text-right`}>A decidir</th><th className={`${th} text-right`}>Com a Stone</th><th className={th} /></tr></thead>
        <tbody>{targets.map(target => {
          const entry = entries[targetKey(target)];
          const view = entry?.view;
          const done = Boolean(view?.ready);
          const fees = view ? view.totals.cardFeeCents + view.totals.pixFeeCents + view.totals.anticipationCents : 0;
          return <tr key={targetKey(target)}>
            <td className={`${td} font-bold`}>{unitName(target)}</td><td className={`${td} tabular-nums`}>{target.stoneCode}</td>
            {!entry ? <td colSpan={5} className={`${td} text-ds-ink-muted`}>Carregando…</td> : entry.error ? <td colSpan={5} className={`${td} text-ds-danger`}>{entry.error}</td> : !done ? <td colSpan={5} className={`${td} text-ds-ink-muted`}>Mês ainda não conferido</td> : <>
              <td className={`${td} text-right tabular-nums`}>{centsLabel(fees)}</td>
              <td className={`${td} text-right tabular-nums`}>{view!.totals.grossCents ? rateLabel((view!.totals.cardFeeCents + view!.totals.pixFeeCents) / view!.totals.grossCents) : "—"}</td>
              <td className={`${td} text-right tabular-nums ${view!.overchargeCents > 0 ? "font-bold text-ds-danger" : ""}`}>{centsLabel(view!.overchargeCents)}</td>
              <td className={`${td} text-right`}>{view!.pendingCount ? <StatusPill variant="danger">{view!.pendingCount}</StatusPill> : 0}</td>
              <td className={`${td} text-right tabular-nums`}>{view!.occurrences.filter(item => item.status !== "closed").length}</td></>}
            <td className={`${td} text-right`}><Button type="button" size="xs" variant="ds-secondary" onClick={() => onOpenUnit?.(target)}>Abrir</Button></td>
          </tr>;
        })}
        {complete && ready.length ? <tr><td colSpan={2} className={`${td} bg-ds-muted font-extrabold`}>Total · {ready.length} {ready.length === 1 ? "vínculo conferido" : "vínculos conferidos"}</td>
          <td className={`${td} bg-ds-muted text-right font-extrabold tabular-nums`}>{centsLabel(totals.fees)}</td><td className={`${td} bg-ds-muted text-right font-extrabold tabular-nums`}>{totals.gross ? rateLabel(totals.salesFees / totals.gross) : "—"}</td>
          <td className={`${td} bg-ds-muted text-right tabular-nums text-ds-danger`}>{centsLabel(totals.over)}</td><td className={`${td} bg-ds-muted text-right font-extrabold`}>{pending}</td><td className={`${td} bg-ds-muted text-right font-extrabold`}>{withStone}</td><td className={`${td} bg-ds-muted`} /></tr> : null}</tbody>
      </table></div>
    </Card> : null}

    {tab === "history" && single && first ? <FeeHistoryCard target={single} month={month} defaultSeries={first.history} version={version} /> : null}

    {tab === "accounting" && single ? <div className="space-y-[18px]">
      <p className="text-[12.5px] text-ds-ink-muted">Contabilização das taxas: apuração por venda conciliada, lançamento do mês e comparação das taxas confirmadas entre unidades.</p>
      <FeeReferenceComparisonPanel key={`rates:${single.mapping.id}:${single.stoneCode}`} mapping={single.mapping} stoneCode={single.stoneCode} month={month} version={version} />
      <StoneFeeMonthExpensePanel key={`fee-expense:${single.mapping.id}:${single.stoneCode}`} mappingId={single.mapping.id} kioskId={single.mapping.kioskId} stoneCode={single.stoneCode} month={month} refreshKey={version} />
    </div> : null}

    {sheet?.type === "new_rate" ? <NewRateSheet key={sheet.row.id} summary={summaryOf(sheet.row)} defaultDate={sheet.row.since ?? sheet.row.date} onClose={() => setSheet(null)}
      onSubmit={async input => { try { await decide(sheet.row, { decision: "new_rate", effectiveFrom: input.effectiveFrom, note: input.note }); setSheet(null); return null; } catch (caught) { return failure(caught, "Não foi possível confirmar a nova taxa."); } }} /> : null}
    {sheet?.type === "contest" ? <ContestSheet key={sheet.row.id} summary={summaryOf(sheet.row)} onClose={() => setSheet(null)}
      onSubmit={async input => { try { await decide(sheet.row, { decision: "contested", reason: input.reason, note: input.note, ...(input.protocol ? { protocol: input.protocol } : {}) }); setSheet(null); setTab("occurrences"); return null; } catch (caught) { return failure(caught, "Não foi possível abrir a ocorrência."); } }} /> : null}
    {sheet?.type === "contact" ? <ContactSheet key={sheet.occurrence.id} summary={occurrenceSummary(sheet.occurrence, sheet.target)} defaultProtocol={sheet.occurrence.protocol} onClose={() => setSheet(null)} onFinish={() => setSheet({ type: "close", occurrence: sheet.occurrence, target: sheet.target })}
      onSubmit={async input => { try { await post(sheet.target, { action: "contact", occurrenceId: sheet.occurrence.id, contactDate: input.contactDate, channel: input.channel, note: input.note, ...(input.protocol ? { protocol: input.protocol } : {}) }); setSheet(null); return null; } catch (caught) { return failure(caught, "Não foi possível registrar o contato."); } }} /> : null}
    {sheet?.type === "close" ? <CloseSheet key={sheet.occurrence.id} summary={occurrenceSummary(sheet.occurrence, sheet.target)} defaultProtocol={sheet.occurrence.protocol} defaultRefundCents={sheet.occurrence.amountCents} onClose={() => setSheet(null)}
      onSubmit={async input => { try { await post(sheet.target, { action: "close", occurrenceId: sheet.occurrence.id, outcome: input.outcome, resolvedOn: input.resolvedOn, note: input.note, ...(input.refundedCents ? { refundedCents: input.refundedCents } : {}), ...(input.protocol ? { protocol: input.protocol } : {}) }); setSheet(null); return null; } catch (caught) { return failure(caught, "Não foi possível finalizar a ocorrência."); } }} /> : null}
  </div>;
}

function ReferenceCard({ group, busy, onConfirm }: { group: FeeReviewView["groups"][number]; busy: boolean; onConfirm: (effectiveFrom: string) => Promise<void> }) {
  const [date, setDate] = useState("");
  const reference = group.reference;
  return <div className="rounded-ds-btn-lg border border-ds-border bg-ds-input px-3.5 py-2.5">
    <p className="text-xs font-bold text-ds-ink-2">{group.label}</p>
    <p className="tabular-nums text-xl font-extrabold tracking-tight">{reference ? rateLabel(reference.rate) : "—"}</p>
    {!reference ? <StatusPill variant="neutral">Sem referência (poucas vendas)</StatusPill>
      : reference.status === "confirmed" ? <p className="flex flex-wrap items-center gap-2"><StatusPill variant="ok">Confirmada</StatusPill><span className="text-xs text-ds-ink-muted">desde {fullDateLabel(reference.since)}</span></p>
        : <div className="space-y-1.5"><StatusPill variant="warn">Sugerida · não aplicada</StatusPill>
          <div className="flex flex-wrap items-center gap-1.5"><input aria-label={`Início da taxa ${group.label}`} type="date" value={date} onChange={event => setDate(event.target.value)} className="h-8 rounded-ds-sm border border-ds-border-input bg-ds-surface px-2 text-xs" />
            <Button type="button" size="xs" variant="ds-secondary" disabled={busy || !date} onClick={() => void onConfirm(date)}>Confirmar</Button></div></div>}
    <p className="mt-1 text-[11px] text-ds-ink-faint">{group.saleCount} vendas em 60 dias · {dayLabel(reference?.since)}</p>
  </div>;
}

const PERIODS: Array<{ value: FeeHistoryPeriod; label: string; pad: number }> = [
  { value: "month", label: "Mês", pad: 1 }, { value: "quarter", label: "Trimestre", pad: 3 }, { value: "semester", label: "Semestre", pad: 6 }, { value: "year", label: "Ano", pad: 12 }, { value: "all", label: "Desde o início", pad: 0 },
];

/** Histórico de taxas por período. O semestre já vem na conferência; os demais períodos são buscados quando escolhidos. */
function FeeHistoryCard({ target, month, defaultSeries, version }: { target: FeeTarget; month: string; defaultSeries: FeeHistorySeries[]; version: number }) {
  const api = useAuthenticatedApi();
  const [period, setPeriod] = useState<FeeHistoryPeriod>("semester");
  const [fetched, setFetched] = useState<{ key: string; series: FeeHistorySeries[] } | null>(null);
  const [error, setError] = useState("");
  const key = `${targetKey(target)}:${month}:${period}:${version}`;
  useEffect(() => {
    if (period === "semester") return;
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) setError(""); })
      .then(() => api<{ series: FeeHistorySeries[] }>(`/api/financial/stone-fees?${new URLSearchParams({ view: "history", period, kioskId: target.mapping.kioskId, stoneCode: target.stoneCode, month })}`, { signal: controller.signal }))
      .then(result => { if (!controller.signal.aborted) setFetched({ key, series: result.series }); })
      .catch(caught => { if (!controller.signal.aborted) setError(errorText(caught, "Não foi possível abrir o histórico.")); });
    return () => controller.abort();
  }, [api, period, target, month, key]);
  const series = period === "semester" ? defaultSeries : fetched?.key === key ? fetched.series : null;
  const pad = PERIODS.find(item => item.value === period)!.pad;
  return <Card kick="Histórico de taxas" title="Taxa praticada por grupo" sub="Só a taxa (%), a que mais se repetiu em cada mês. No período Mês, a taxa de cada dia com venda. Passe o cursor para comparar."
    aside={<Segmented aria-label="Período" value={period} onChange={setPeriod} options={PERIODS.map(item => ({ value: item.value, label: item.label }))} />}>
    <div className="pb-4">{error ? <p role="alert" className="px-[18px] text-sm font-semibold text-ds-danger">{error}</p> : series ? <FeeHistoryCharts key={period} series={series} padTo={pad} /> : <p role="status" className="px-[18px] text-sm text-ds-ink-muted">Carregando histórico…</p>}</div>
  </Card>;
}
