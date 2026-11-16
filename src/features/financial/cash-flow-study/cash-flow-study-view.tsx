"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { HeroChip } from "@/components/patterns/hero-chip";
import { LiftRow } from "@/components/patterns/lift-row";
import { PanelSection, SidePanel } from "@/components/patterns/side-panel";
import { Segmented } from "@/components/patterns/segmented";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { addDays, buildWeeks, scaleEntry, type Scenario, type StudyEntry, type StudyResult, type StudyStage, type StudyWeek } from "./model";

export type CashFlowStudyPayload = StudyResult & { generatedAt: string; horizonWeeks: number };
export type CashFlowTab = "weeks" | "entries" | "money" | "health" | "movements";

export const CASH_FLOW_TABS: Array<{ value: CashFlowTab; label: string }> = [
  { value: "weeks", label: "Próximas semanas" },
  { value: "entries", label: "Entradas" },
  { value: "money", label: "Onde está o dinheiro" },
  { value: "health", label: "Saúde do negócio" },
  { value: "movements", label: "Movimentações" },
];

// ---------- formatação ----------
const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const thousands = (cents: number) => `${cents < 0 ? "−" : ""}R$ ${(Math.abs(cents) / 100_000).toFixed(1).replace(".", ",")} mil`;
const day = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const range = (start: string, end: string) => `${day(start)} a ${day(end)}`;
const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" }).replace(".", "");

const WEEK_STATUS: Record<StudyWeek["status"], { label: string; variant: StatusPillVariant }> = {
  comfortable: { label: "Folga", variant: "ok" },
  normal: { label: "Normal", variant: "neutral" },
  below_minimum: { label: "Abaixo do mínimo", variant: "warn" },
  negative: { label: "Negativo", variant: "danger" },
};
const CERTAINTY: Record<StudyEntry["certainty"], { label: string; variant: StatusPillVariant }> = {
  guaranteed: { label: "Garantido", variant: "info" },
  projected: { label: "Projetado", variant: "neutral" },
  payable: { label: "A pagar", variant: "warn" },
  provisioned: { label: "Provisionada", variant: "neutral" },
};

// ---------- dados ----------
export function useCashFlowStudy(enabled: boolean) {
  const api = useAuthenticatedApi();
  const [data, setData] = useState<CashFlowStudyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const version = useRef(0);
  const load = useCallback(async () => {
    if (!enabled) return;
    const current = ++version.current;
    setLoading(true);
    try {
      const result = await api<CashFlowStudyPayload>("/api/financial/cash-flow-study", { fallbackError: "Não foi possível calcular o fluxo de caixa." });
      if (current === version.current) { setData(result); setError(null); }
    } catch (cause) {
      if (current === version.current) setError(cause instanceof Error ? cause.message : "Não foi possível calcular o fluxo de caixa.");
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [api, enabled]);
  useEffect(() => { void load(); return () => { version.current += 1; }; }, [load]);
  return { data, error, loading, reload: load };
}

export function useStudyWeeks(data: CashFlowStudyPayload | null, scenario: Scenario) {
  return useMemo(() => (data ? buildWeeks(data, scenario) : []), [data, scenario]);
}

// ---------- faixa de abas e controles do painel escuro ----------
export function CashFlowTabStrip({ value, onChange }: { value: CashFlowTab; onChange: (tab: CashFlowTab) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const next = CASH_FLOW_TABS[(index + CASH_FLOW_TABS.length) % CASH_FLOW_TABS.length];
    onChange(next.value);
    refs.current[(index + CASH_FLOW_TABS.length) % CASH_FLOW_TABS.length]?.focus();
  };
  return (
    <div role="tablist" aria-label="Seções do fluxo de caixa" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-ds-btn-lg bg-ds-seg p-1">
      {CASH_FLOW_TABS.map((tab, index) => (
        <button
          key={tab.value}
          ref={element => { refs.current[index] = element; }}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          onKeyDown={event => {
            if (event.key === "ArrowRight") { event.preventDefault(); move(index + 1); }
            if (event.key === "ArrowLeft") { event.preventDefault(); move(index - 1); }
            if (event.key === "Home") { event.preventDefault(); move(0); }
            if (event.key === "End") { event.preventDefault(); move(CASH_FLOW_TABS.length - 1); }
          }}
          className={cn(
            "h-9 shrink-0 rounded-ds-md px-4 text-[13.5px] font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink",
            value === tab.value ? "bg-ds-surface text-ds-ink shadow-sm" : "text-ds-ink-muted hover:text-ds-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function StudyHeroChips({ data, weeks }: { data: CashFlowStudyPayload | null; weeks: StudyWeek[] }) {
  if (!data) return <HeroChip value="…" label="Calculando o fluxo de caixa" />;
  const onTheWay = data.stages.filter(stage => stage.key !== "inter").reduce((sum, stage) => sum + (stage.cents ?? 0), 0);
  const critical = weeks.find(week => week.status === "below_minimum" || week.status === "negative");
  const last = weeks.at(-1);
  return (
    <>
      <HeroChip value={data.startBalanceCents === null ? "indisponível" : thousands(data.startBalanceCents)} label="No Inter hoje" />
      <HeroChip value={thousands(onTheWay)} label="A caminho" tone="info" />
      <HeroChip value={critical ? day(critical.start) : "nenhuma"} label="Primeira semana abaixo do mínimo" tone={critical ? "warning" : "neutral"} />
      {last ? <HeroChip value={thousands(last.closingCents)} label={`Saldo em ${day(last.end)}`} tone={last.closingCents < 0 ? "danger" : "neutral"} /> : null}
    </>
  );
}

export function StudyHeroControls({ data, scenario, onScenario, loading, onReload }: {
  data: CashFlowStudyPayload | null; scenario: Scenario; onScenario: (value: Scenario) => void; loading: boolean; onReload: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<Scenario> aria-label="Cenário de vendas" value={scenario} onChange={onScenario}
        options={[{ value: "pessimistic", label: "Pessimista" }, { value: "expected", label: "Esperado" }, { value: "optimistic", label: "Otimista" }]} />
      <Button variant="on-dark-secondary" size="md" onClick={onReload} disabled={loading}>{loading ? "Calculando…" : "Recalcular"}</Button>
      <span className="text-[12.5px] text-ds-on-dark-muted">
        {data?.minimumCents != null ? `Mínimo de caixa: ${thousands(data.minimumCents)} (2 semanas de saídas médias)` : "Mínimo de caixa indisponível"}
        {data ? ` · calculado às ${new Date(data.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}
      </span>
    </div>
  );
}

// ---------- blocos comuns ----------
function Card({ title, description, aside, children, className }: { title?: string; description?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-ds-card border border-ds-border bg-ds-surface", className)}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-3 pt-[18px]">
          <div>
            <h2 className="text-[15.5px] font-extrabold text-ds-ink">{title}</h2>
            {description ? <p className="mt-1 text-[12.5px] text-ds-ink-muted">{description}</p> : null}
          </div>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}
const Kicker = ({ children, className }: { children: React.ReactNode; className?: string }) =>
  <p className={cn("text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint", className)}>{children}</p>;
const HeadRow = ({ className, children }: { className: string; children: React.ReactNode }) =>
  <div className={cn("grid gap-3 bg-ds-muted px-[18px] py-2.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint", className)}>{children}</div>;

export function StudyGaps({ data }: { data: CashFlowStudyPayload }) {
  if (!data.gaps.length) return null;
  return (
    <div role="note" className="rounded-ds-btn-lg border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-[13px] text-ds-alert-ink">
      <p className="font-bold">Limites deste cálculo</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">{data.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
    </div>
  );
}

export function StudyLoading({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) return (
    <div role="alert" className="rounded-ds-card border border-ds-confirm-border bg-ds-confirm-bg px-5 py-4 text-sm text-ds-confirm-ink">
      {error} <Button variant="ds-link" className="ml-2 h-auto p-0" onClick={onRetry}>Tentar de novo</Button>
    </div>
  );
  return <div className="space-y-4"><Skeleton className="h-16 w-full rounded-ds-card" /><Skeleton className="h-72 w-full rounded-ds-card" /><Skeleton className="h-96 w-full rounded-ds-card" /></div>;
}

// ---------- 1. Próximas semanas ----------
const WEEK_GRID = "grid-cols-[150px_minmax(0,1fr)_120px_120px_130px_150px]";

export function WeeksTab({ data, weeks, scenario }: { data: CashFlowStudyPayload; weeks: StudyWeek[]; scenario: Scenario }) {
  const [selected, setSelected] = useState<number | null>(null);
  const critical = weeks.find(week => week.status === "below_minimum" || week.status === "negative");
  const negative = weeks.find(week => week.status === "negative");
  const lastSafe = critical ? weeks[critical.index - 1] : null;
  const chart = weeks.map(week => ({ label: day(week.start), closing: week.closingCents / 100, status: week.status }));
  return (
    <div className="space-y-[18px]">
      <div role="status" className={cn("flex items-start gap-3 rounded-ds-btn-lg border px-[18px] py-3.5 text-[13.5px]",
        critical ? "border-ds-alert-border bg-ds-alert-bg text-ds-alert-ink" : "border-ds-border bg-ds-ok-bg text-ds-ok")}>
        <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        <span>
          {critical ? <>
            <strong>{lastSafe ? `O caixa cobre as contas até ${day(lastSafe.end)}.` : "O caixa já começa abaixo do mínimo."}</strong>{" "}
            Na semana de {day(critical.start)}{critical.heaviest ? `, com "${critical.heaviest}",` : ""} o saldo fica em {thousands(critical.closingCents)}
            {data.minimumCents != null && critical.status === "below_minimum" ? `, ${thousands(data.minimumCents - critical.closingCents)} abaixo do mínimo` : ""}
            {negative ? ` e em ${day(negative.start)} fica negativo se nada mudar.` : "."}
          </> : <strong>O caixa cobre as contas das próximas 13 semanas no cenário escolhido.</strong>}
        </span>
      </div>
      <Card title="Saldo no fim de cada semana" description="Saldo de hoje no Inter + o que já está garantido + vendas pela média de 3 meses − contas a pagar e provisionadas.">
        <div className="h-[240px] px-3 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 16, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--ds-divider)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} fontFamily="var(--font-ds-mono)" />
              <YAxis tickLine={false} axisLine={false} fontSize={10} tickFormatter={value => `${Math.round(value / 1000)} mil`} width={52} />
              <Tooltip formatter={(value: number) => [brl(Math.round(value * 100)), "Saldo previsto"]} cursor={{ fill: "var(--ds-accent-row)" }} />
              <ReferenceLine y={0} stroke="var(--ds-border-input)" />
              {data.minimumCents != null ? <ReferenceLine y={data.minimumCents / 100} stroke="var(--ds-warn)" strokeDasharray="5 4"
                label={{ value: `Mínimo ${thousands(data.minimumCents)}`, position: "insideTopRight", fill: "var(--ds-warn)", fontSize: 11, fontWeight: 700 }} /> : null}
              <Bar dataKey="closing" radius={[4, 4, 4, 4]} maxBarSize={46} onClick={(_, index) => setSelected(index)} className="cursor-pointer">
                {chart.map(point => <Cell key={point.label} fill={point.status === "negative" ? "var(--ds-danger)" : point.status === "below_minimum" ? "var(--ds-warn)" : "var(--ds-ink-2)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <section className="rounded-ds-card border border-ds-border bg-ds-surface" aria-label="Semanas">
        <HeadRow className={cn(WEEK_GRID, "rounded-t-ds-card")}><span>Semana</span><span>O que mais pesa</span><span className="text-right">Entra</span><span className="text-right">Sai</span><span className="text-right">Saldo final</span><span>Situação</span></HeadRow>
        {weeks.map(week => (
          <LiftRow key={week.start} table selected={selected === week.index} onClick={() => setSelected(week.index)} aria-label={`Abrir a semana de ${range(week.start, week.end)}`}
            className={cn("grid items-center gap-3", WEEK_GRID)}>
            <span className="font-ds-mono text-[12.5px] font-bold">{range(week.start, week.end)}</span>
            <span className="truncate text-[12.5px] text-ds-ink-muted">{week.heaviest ?? "—"}</span>
            <span className="text-right font-ds-mono text-[13px]">+{thousands(week.inCents)}</span>
            <span className="text-right font-ds-mono text-[13px] text-ds-ink-2">−{thousands(week.outCents)}</span>
            <span className="text-right font-ds-mono text-[14px] font-bold">{thousands(week.closingCents)}</span>
            <span><StatusPill variant={WEEK_STATUS[week.status].variant}>{WEEK_STATUS[week.status].label}</StatusPill></span>
          </LiftRow>
        ))}
      </section>
      <WeekPanel data={data} weeks={weeks} scenario={scenario} index={selected} onIndex={setSelected} />
    </div>
  );
}

function WeekPanel({ data, weeks, scenario, index, onIndex }: { data: CashFlowStudyPayload; weeks: StudyWeek[]; scenario: Scenario; index: number | null; onIndex: (index: number | null) => void }) {
  const week = index === null ? null : weeks[index];
  const entries = week ? data.entries.filter(entry => entry.date >= week.start && entry.date <= week.end) : [];
  const grouped = groupProjected(entries, scenario);
  const shortfall = week && data.minimumCents != null && week.closingCents < data.minimumCents ? data.minimumCents - week.closingCents : 0;
  return (
    <SidePanel open={week !== null} onOpenChange={open => { if (!open) onIndex(null); }} kicker={week ? `Semana ${week.index + 1} de ${weeks.length}` : ""}
      title={week ? range(week.start, week.end) : ""} subtitle={week ? `Termina com ${thousands(week.closingCents)}` : undefined} className="w-[560px]">
      {week ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill variant={WEEK_STATUS[week.status].variant}>{WEEK_STATUS[week.status].label}</StatusPill>
            {shortfall > 0 ? <span className="text-[12.5px] text-ds-ink-muted">faltam {thousands(shortfall)} para o mínimo</span> : null}
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {[["Começa com", thousands(week.openingCents)], ["Entra", `+${thousands(week.inCents)}`], ["Sai", `−${thousands(week.outCents)}`]].map(([label, value]) => (
              <div key={label} className="rounded-ds-btn-lg border border-ds-border bg-ds-surface px-3.5 py-3"><Kicker>{label}</Kicker><p className="mt-1 font-ds-mono text-[17px] font-bold">{value}</p></div>
            ))}
          </div>
          <PanelSection title="Lançamentos da semana" aside={`${grouped.length} linha(s)`}>
            {grouped.length ? grouped.map(entry => (
              <div key={entry.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-bold">{entry.label}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ds-ink-muted">
                    <span className="font-ds-mono">{entry.dateLabel}</span>
                    <StatusPill variant={CERTAINTY[entry.certainty].variant}>{entry.overdue ? "Vencida" : CERTAINTY[entry.certainty].label}</StatusPill>
                  </p>
                </div>
                <span className={cn("shrink-0 font-ds-mono text-[14px] font-bold", entry.direction === "in" ? "text-ds-ok" : "text-ds-ink")}>
                  {entry.direction === "in" ? "+" : "−"}{brl(entry.amountCents)}
                </span>
              </div>
            )) : <p className="text-[13px] text-ds-ink-muted">Nada previsto para esta semana.</p>}
          </PanelSection>
          <div className="flex justify-between gap-2">
            <Button variant="ds-secondary" size="md" disabled={week.index === 0} onClick={() => onIndex(week.index - 1)}>‹ {week.index > 0 ? day(weeks[week.index - 1].start) : ""}</Button>
            <Button variant="ds-secondary" size="md" disabled={week.index === weeks.length - 1} onClick={() => onIndex(week.index + 1)}>{week.index < weeks.length - 1 ? day(weeks[week.index + 1].start) : ""} ›</Button>
          </div>
        </div>
      ) : null}
    </SidePanel>
  );
}

/** Junta as vendas projetadas da semana numa linha por forma de pagamento. */
function groupProjected(entries: StudyEntry[], scenario: Scenario) {
  const rows: Array<StudyEntry & { dateLabel: string }> = [];
  const projected = new Map<string, StudyEntry & { dateLabel: string; first: string; last: string }>();
  for (const entry of entries) {
    const amount = scaleEntry(entry, scenario);
    if (entry.certainty !== "projected") { rows.push({ ...entry, amountCents: amount, dateLabel: day(entry.date) }); continue; }
    const current = projected.get(entry.label);
    if (current) { current.amountCents += amount; current.last = entry.date > current.last ? entry.date : current.last; current.first = entry.date < current.first ? entry.date : current.first; }
    else projected.set(entry.label, { ...entry, id: `${entry.label}:${entry.date}`, amountCents: amount, dateLabel: "", first: entry.date, last: entry.date });
  }
  const merged = [...projected.values()].map(({ first, last, ...entry }) => ({ ...entry, date: first, dateLabel: first === last ? day(first) : `${day(first)}–${day(last)}` }));
  return [...rows, ...merged].sort((a, b) => a.direction.localeCompare(b.direction) || b.amountCents - a.amountCents);
}

// ---------- 2. Entradas ----------
type EntryFilter = "all" | "guaranteed" | "projected";
const SOURCE_GROUPS: Array<{ key: string; label: string; match: (entry: StudyEntry) => boolean; tone: string }> = [
  { key: "deposit", label: "Depósitos em espécie (boletos e lotes)", match: e => e.source === "deposit_boleto" || e.source === "deposit_counted" || e.source === "cash_open", tone: "bg-ds-ink-2" },
  { key: "stone", label: "Stone · cartão", match: e => e.source === "stone", tone: "bg-ds-info" },
  { key: "projected", label: "Vendas projetadas", match: e => e.source === "sales_projected", tone: "bg-ds-disabled" },
];

export function EntriesTab({ data, scenario }: { data: CashFlowStudyPayload; scenario: Scenario }) {
  const [filter, setFilter] = useState<EntryFilter>("all");
  const [visibleWeeks, setVisibleWeeks] = useState(4);
  const incoming = data.entries.filter(entry => entry.direction === "in");
  const fourWeeksEnd = addDays(data.weekStarts[0], 27);
  const near = incoming.filter(entry => entry.date <= fourWeeksEnd);
  const nearTotal = near.reduce((sum, entry) => sum + scaleEntry(entry, scenario), 0);
  const nearGuaranteed = near.filter(entry => entry.certainty === "guaranteed").reduce((sum, entry) => sum + entry.amountCents, 0);
  const shown = incoming.filter(entry => filter === "all" || entry.certainty === filter);
  const groups = data.weekStarts.slice(0, visibleWeeks).map(start => {
    const end = addDays(start, 6);
    const rows = groupProjected(shown.filter(entry => entry.date >= start && entry.date <= end), scenario).sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);
    return { start, end, rows, total: rows.reduce((sum, row) => sum + row.amountCents, 0) };
  });
  return (
    <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Tudo o que entra, na data em que cai" description="Garantido = já existe (boleto, lote, parcela Stone). Projetado = vendas pela média dos últimos 3 meses."
        aside={<Segmented<EntryFilter> aria-label="Tipo de entrada" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "Todas" }, { value: "guaranteed", label: "Garantidas" }, { value: "projected", label: "Projetadas" }]} />}>
        {groups.map(group => (
          <div key={group.start}>
            <div className="flex items-baseline justify-between px-5 pb-1 pt-4">
              <h3 className="text-[19px] font-extrabold uppercase tracking-[-0.01em]">Semana de {day(group.start)}</h3>
              <span className="font-ds-mono text-[15px] font-bold text-ds-accent-ink">{thousands(group.total)}</span>
            </div>
            {group.rows.length ? group.rows.map(row => (
              <div key={row.id} className="grid grid-cols-[96px_minmax(0,1fr)_110px_140px] items-center gap-3 border-b border-ds-divider px-5 py-2.5">
                <span className="font-ds-mono text-[12.5px] font-bold">{row.dateLabel}</span>
                <span className="min-w-0"><span className="block truncate text-[13.5px] font-bold">{row.label}</span><span className="block truncate text-[12px] text-ds-ink-muted">{row.detail}</span></span>
                <span><StatusPill variant={CERTAINTY[row.certainty].variant}>{CERTAINTY[row.certainty].label}</StatusPill></span>
                <span className="text-right font-ds-mono text-[13.5px] font-bold">{brl(row.amountCents)}</span>
              </div>
            )) : <p className="border-b border-ds-divider px-5 py-3 text-[13px] text-ds-ink-muted">Nenhuma entrada nesta semana.</p>}
          </div>
        ))}
        {visibleWeeks < data.weekStarts.length ? (
          <div className="px-5 py-3"><Button variant="ds-link" className="h-auto p-0" onClick={() => setVisibleWeeks(data.weekStarts.length)}>Mostrar as outras {data.weekStarts.length - visibleWeeks} semanas</Button></div>
        ) : null}
      </Card>
      <div className="space-y-[18px]">
        <Card>
          <div className="px-5 py-[18px]">
            <Kicker>Próximas 4 semanas</Kicker>
            <p className="mt-1.5 font-ds-mono text-[30px] font-bold tracking-[-0.03em]">{thousands(nearTotal)}</p>
            <p className="text-[12.5px] text-ds-ink-muted">{thousands(nearGuaranteed)} garantidos · {thousands(nearTotal - nearGuaranteed)} projetados</p>
            <div className="mb-3.5 mt-2 flex h-3.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
              {SOURCE_GROUPS.map(group => {
                const value = near.filter(group.match).reduce((sum, entry) => sum + scaleEntry(entry, scenario), 0);
                return value > 0 ? <span key={group.key} className={group.tone} style={{ flex: `${value} 1 0` }} /> : null;
              })}
            </div>
            {SOURCE_GROUPS.map(group => (
              <div key={group.key} className="flex items-center gap-2.5 border-t border-ds-divider py-2 text-[13px]">
                <span className={cn("h-2.5 w-2.5 rounded-[3px]", group.tone)} aria-hidden="true" />
                <span className="flex-1">{group.label}</span>
                <span className="font-ds-mono font-bold">{thousands(near.filter(group.match).reduce((sum, entry) => sum + scaleEntry(entry, scenario), 0))}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="space-y-1 px-5 py-[18px]">
            <Kicker>Quando o dinheiro cai</Kicker>
            {[["Pix", "na hora", "D+0"], ["Débito", "1 dia", "D+1"], ["Crédito à vista", "30 dias", "D+30"],
              ["Espécie", "fechamento + boleto + 3 dias", (() => { const ind = data.indicators.find(item => item.key === "cash_lag"); return ind ? `~${ind.value}` : "~24 dias"; })()]].map(([label, text, value]) => (
              <div key={label} className="flex justify-between border-t border-ds-divider py-1.5 text-[13px]"><span className="font-bold">{label}</span><span className="text-ds-ink-muted">{text}</span><span className="font-ds-mono font-bold">{value}</span></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------- 3. Onde está o dinheiro ----------
const STAGE_TEXT: Record<StudyStage["key"], { kicker: string; title: string; empty: string }> = {
  cash_open: { kicker: "Espécie", title: "Vendido, não fechado", empty: "nenhum dia em aberto" },
  counted: { kicker: "Espécie", title: "Contado, sem boleto", empty: "nenhum lote aguardando boleto" },
  boleto: { kicker: "Espécie", title: "Boleto emitido", empty: "nenhum boleto em aberto" },
  stone: { kicker: "Cartão", title: "Stone a receber", empty: "nenhuma parcela aberta" },
  inter: { kicker: "Disponível", title: "No Inter", empty: "saldo indisponível" },
};
const UNIT_GRID = "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_90px_130px]";

export function MoneyTab({ data }: { data: CashFlowStudyPayload }) {
  const onTheWay = data.stages.filter(stage => stage.key !== "inter").reduce((sum, stage) => sum + (stage.cents ?? 0), 0);
  const boleto = data.stages.find(stage => stage.key === "boleto");
  const today = data.asOf;
  const lagTone = (days: number | null) => days === null ? "neutral" : days > 30 ? "danger" : days > 14 ? "warn" : "ok";
  return (
    <div className="space-y-[18px]">
      <div className="grid gap-2.5 md:grid-cols-5">
        {data.stages.map((stage, index) => {
          const text = STAGE_TEXT[stage.key];
          const dark = stage.key === "inter";
          const overdue = stage.key === "boleto" && stage.nextDate && stage.nextDate <= today && (stage.cents ?? 0) > 0;
          return (
            <article key={stage.key} className={cn("relative flex flex-col gap-1 rounded-ds-card px-[18px] py-4",
              dark ? "bg-ds-dark text-ds-on-dark" : overdue ? "border border-ds-alert-border bg-ds-alert-bg" : "border border-ds-border bg-ds-surface")}>
              <Kicker className={dark ? "text-ds-on-dark-muted" : undefined}>{text.kicker}</Kicker>
              <span className="text-[14px] font-extrabold">{text.title}</span>
              <span className={cn("mt-1.5 font-ds-mono text-[24px] font-bold tracking-[-0.03em]", !dark && !stage.cents && "text-ds-indicator-zero")}>
                {stage.cents === null ? "—" : thousands(stage.cents)}
              </span>
              <span className={cn("text-[12px]", dark ? "text-ds-on-dark-2" : "text-ds-ink-muted")}>
                {dark ? (data.balanceAt ? `saldo pela API do Inter às ${new Date(data.balanceAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : text.empty)
                  : stage.count ? `${stage.count} ${stage.key === "stone" ? "parcela(s)" : stage.key === "cash_open" ? "dia(s) de venda" : "lote(s)"}${stage.nextDate ? ` · próximo em ${day(stage.nextDate)}` : ""}` : text.empty}
              </span>
              {index < data.stages.length - 1 ? <ArrowRight className="absolute -right-[13px] top-1/2 hidden h-4 w-4 -translate-y-1/2 text-ds-ink-faint md:block" aria-hidden="true" /> : null}
            </article>
          );
        })}
      </div>
      <p className="text-[12.5px] text-ds-ink-muted">
        {thousands(onTheWay)} já vendidos e ainda a caminho{data.startBalanceCents !== null ? `, além de ${thousands(data.startBalanceCents)} no Inter` : ""}. Cada etapa sai dos fechamentos do PDV, dos lotes e boletos de depósito e da carteira Stone.
      </p>
      <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Dinheiro em espécie por unidade" description="Prazo = da venda (meio do período do lote) até o boleto cair no Inter. Sem 4 lotes pagos, usa 24 dias.">
          <HeadRow className={UNIT_GRID}><span>Unidade</span><span className="text-right">Não fechado</span><span className="text-right">Contado</span><span className="text-right">Em boleto</span><span>Vendas do lote</span><span className="text-right">Cai em</span><span>Prazo</span></HeadRow>
          {data.units.length ? data.units.map(unit => (
            <div key={unit.kioskId} className={cn("grid items-center gap-3 border-b border-ds-divider px-[18px] py-3 text-[13px]", UNIT_GRID)}>
              <span className="truncate text-[14px] font-extrabold">{unit.kioskName}</span>
              <span className="text-right font-ds-mono">{thousands(unit.openCents)}</span>
              <span className="text-right font-ds-mono">{thousands(unit.countedCents)}</span>
              <span className="text-right font-ds-mono font-bold">{thousands(unit.boletoCents)}</span>
              <span className="font-ds-mono text-ds-ink-2">{unit.batchPeriod ? unit.batchPeriod.split("|").map(day).join(" a ") : "—"}</span>
              <span className="text-right font-ds-mono">{unit.eta ? day(unit.eta) : "—"}</span>
              <span><StatusPill variant={lagTone(unit.lagDays)}>{unit.lagDays === null ? "sem histórico" : `${unit.lagDays} dias${unit.lagFromHistory ? "" : " (padrão)"}`}</StatusPill></span>
            </div>
          )) : <p className="px-5 py-6 text-[13px] text-ds-ink-muted">Nenhum espécie a caminho nas unidades.</p>}
        </Card>
        <Card>
          <div className="space-y-2.5 px-5 py-[18px]">
            <Kicker>Pede atenção</Kicker>
            {boleto && boleto.cents ? (
              <AttentionRow variant={boleto.nextDate && boleto.nextDate <= today ? "warn" : "info"} label="Boletos">
                {boleto.count} boleto(s) de depósito somando {thousands(boleto.cents)}{boleto.nextDate ? `, o primeiro previsto para ${day(boleto.nextDate)}` : ""}. <a className="font-bold text-ds-accent-ink hover:text-ds-accent-ink-hover" href="/dashboard/financial/cash-deposits">Ver depósitos</a>
              </AttentionRow>
            ) : null}
            {data.units.filter(unit => unit.lagFromHistory && (unit.lagDays ?? 0) > 30).map(unit => (
              <AttentionRow key={unit.kioskId} variant="danger" label="Prazo">O espécie leva {unit.lagDays} dias para chegar ao Inter em {unit.kioskName}.</AttentionRow>
            ))}
            {!boleto?.cents && !data.units.some(unit => unit.lagFromHistory && (unit.lagDays ?? 0) > 30) ? <p className="text-[13px] text-ds-ink-muted">Nada fora do normal agora.</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
function AttentionRow({ variant, label, children }: { variant: StatusPillVariant; label: string; children: React.ReactNode }) {
  return <div className="flex items-start gap-2.5 text-[13px]"><span className="mt-px shrink-0"><StatusPill variant={variant}>{label}</StatusPill></span><span>{children}</span></div>;
}

// ---------- 4. Saúde do negócio ----------
export function HealthTab({ data }: { data: CashFlowStudyPayload }) {
  const chart = data.months.map(month => ({ label: `${monthName(month.month)}${month.partial ? "*" : ""}`, entrou: month.inCents / 100, saiu: month.outCents / 100 }));
  const full = data.months.filter(month => !month.partial && (month.inCents || month.outCents));
  const surplus = full.length ? full.reduce((sum, month) => sum + month.inCents - month.outCents, 0) / full.length : null;
  const negativeMonths = full.filter(month => month.inCents < month.outCents).map(month => monthName(month.month));
  const lag = data.indicators.find(item => item.key === "cash_lag");
  const runway = data.indicators.find(item => item.key === "runway");
  return (
    <div className="space-y-[18px]">
      <div className="grid gap-[18px] xl:grid-cols-[minmax(0,600px)_minmax(0,1fr)]">
        <Card title="O negócio gera mais caixa do que consome?" description="Entrou e saiu da conta Inter, mês a mês. *Mês atual até hoje.">
          <div className="h-[240px] px-3 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--ds-divider)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickLine={false} axisLine={false} fontSize={10} tickFormatter={value => `${Math.round(value / 1000)} mil`} width={52} />
                <Tooltip formatter={(value: number, name: string) => [brl(Math.round(value * 100)), name === "entrou" ? "Entrou" : "Saiu"]} cursor={{ fill: "var(--ds-surface-muted)" }} />
                <Bar dataKey="entrou" fill="var(--ds-ink-2)" radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="saiu" fill="var(--ds-disabled)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 px-5 pb-4 text-[12px] text-ds-ink-2">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-ds-ink-2" aria-hidden="true" />Entrou</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-ds-disabled" aria-hidden="true" />Saiu</span>
          </div>
        </Card>
        <Card>
          <div className="flex h-full flex-col gap-2.5 px-[22px] py-5">
            <Kicker>Diagnóstico</Kicker>
            <p className="text-[20px] font-extrabold leading-snug tracking-[-0.02em]">{diagnosis(surplus, runway?.tone, lag?.tone)}</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-[18px] text-[13.5px] text-ds-ink-2">
              {surplus !== null ? <li>Sobra média de {thousands(Math.round(surplus))} por mês nos últimos {full.length} meses fechados{negativeMonths.length ? ` (${negativeMonths.join(", ")} no vermelho)` : ""}.</li> : <li>Ainda não há meses fechados com movimentação no Inter.</li>}
              {runway ? <li>O saldo de hoje paga {runway.value} de saídas médias sem nenhuma entrada.</li> : null}
              {lag ? <li>O espécie leva {lag.value} da venda até o Inter.</li> : null}
            </ul>
          </div>
        </Card>
      </div>
      <Card title="Indicadores" description="Cada indicador mostra o valor, o que ele mede e se está bom.">
        <HeadRow className="grid-cols-[200px_130px_minmax(0,1fr)_170px]"><span>Indicador</span><span>Valor</span><span>O que mede</span><span>Situação</span></HeadRow>
        {data.indicators.length ? data.indicators.map(indicator => (
          <div key={indicator.key} className="grid grid-cols-[200px_130px_minmax(0,1fr)_170px] items-center gap-3 border-b border-ds-divider px-[18px] py-3">
            <span className="text-[14px] font-extrabold">{indicator.label}</span>
            <span className="font-ds-mono text-[17px] font-bold">{indicator.value}</span>
            <span className="text-[12.5px] text-ds-ink-muted">{indicator.detail}</span>
            <span className="flex flex-col items-start gap-1"><StatusPill variant={indicator.tone}>{indicator.status}</StatusPill><span className="text-[11.5px] text-ds-ink-faint">{indicator.basis}</span></span>
          </div>
        )) : <p className="px-5 py-6 text-[13px] text-ds-ink-muted">Sem dados suficientes para os indicadores.</p>}
        <p className="px-5 py-3 text-[12px] text-ds-ink-muted">O acerto da previsão (previsto × realizado) entra quando o sistema guardar as projeções diárias.</p>
      </Card>
    </div>
  );
}

function diagnosis(surplus: number | null, runway?: string, lag?: string) {
  if (surplus === null) return "Ainda não há histórico suficiente para um diagnóstico.";
  const base = surplus > 0 ? "O negócio gera caixa" : "O negócio está consumindo caixa";
  const notes = [runway === "danger" || runway === "warn" ? "a folga é curta" : null, lag === "danger" || lag === "warn" ? "o espécie demora para virar saldo" : null].filter(Boolean);
  return notes.length ? `${base}, mas ${notes.join(" e ")}.` : `${base} e a folga está confortável.`;
}
