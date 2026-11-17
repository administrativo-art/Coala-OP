"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBRL } from "../money";
import { formatClosureMonthLabel } from "../date";
import type { CashClosure, CashClosureMonthlySummary } from "../types";
import {
  aggregateMonthlySummaries,
  monthDayStatuses,
  monthlySummarySalesCents,
  monthKey,
  trailingMonths,
  unitMonthStats,
  type MonthDayStatus,
} from "../analysis";
import { CashClosureDayStrip, DAY_STATUS_META, DayStatusLegend } from "./cash-closure-day-strip";

type Unit = { id: string; name: string; pdvFilialId: string | null };

function signedBRL(cents: number) {
  if (cents === 0) return formatBRL(0);
  return `${cents > 0 ? "+" : "−"}${formatBRL(Math.abs(cents))}`;
}

function percent(part: number, total: number) {
  return `${((part / total) * 100).toFixed(1).replace(".", ",")}%`;
}

/** Vendas da unidade no mês; "—" quando o resumo não tem a venda de todos os dias. */
function salesLabel(summary: CashClosureMonthlySummary | undefined) {
  if (!summary) return formatBRL(0);
  const sales = monthlySummarySalesCents(summary);
  return sales === null ? "—" : formatBRL(sales);
}

function shortMonth(year: number, month: number) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))).replace(".", "");
}

function Kpi({ label, value, sub, tone, children }: { label: string; value: string; sub?: ReactNode; tone?: string; children?: ReactNode }) {
  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted">{label}</p>
      <p className={cn("mt-1.5 font-ds-mono text-[21px] font-bold", tone)}>{value}</p>
      {children}
      {sub ? <p className="mt-0.5 text-[12px] text-ds-ink-muted">{sub}</p> : null}
    </div>
  );
}

export function CashClosuresAnalysisTab({
  units,
  summariesByUnit,
  summariesLoading,
  closuresByUnit,
  closuresLoading,
  canViewDays,
  sessionScopeKeys,
  year,
  month,
  today,
  onOpenSessions,
}: {
  units: Unit[];
  summariesByUnit: Array<{ kioskId: string; summaries: CashClosureMonthlySummary[] }>;
  summariesLoading: boolean;
  closuresByUnit: Record<string, CashClosure[]>;
  closuresLoading: boolean;
  canViewDays: boolean;
  sessionScopeKeys: Set<string>;
  year: number;
  month: number;
  today: string;
  onOpenSessions: () => void;
}) {
  const pdvUnits = units.filter((unit) => unit.pdvFilialId);
  const withoutPdv = units.length - pdvUnits.length;
  const scoped = summariesByUnit.filter((entry) => pdvUnits.some((unit) => unit.id === entry.kioskId));
  const months = trailingMonths(year, month, 6);
  const aggregates = aggregateMonthlySummaries(scoped, months, today);
  const current = aggregates[aggregates.length - 1];
  const key = monthKey(year, month);

  const rows = pdvUnits.map((unit) => {
    const summary = scoped.find((entry) => entry.kioskId === unit.id)?.summaries.find((item) => item.year === year && item.month === month);
    const days: MonthDayStatus[] | null = canViewDays ? monthDayStatuses(year, month, closuresByUnit[unit.id] ?? [], today) : null;
    const stats = days ? unitMonthStats(days) : null;
    const unitAggregate = aggregateMonthlySummaries([{ kioskId: unit.id, summaries: summary ? [summary] : [] }], [{ year, month }], today)[0];
    const pending = stats ? stats.pending : unitAggregate.pendingDays;
    const inSession = sessionScopeKeys.has(`${unit.id}:${key}`);
    return { unit, summary, days, stats, unitAggregate, pending, inSession };
  }).sort((a, b) => b.pending - a.pending || a.unit.name.localeCompare(b.unit.name, "pt-BR"));

  const sessionDays = rows.filter((row) => row.inSession).reduce((total, row) => total + row.pending, 0);
  const pendingList = rows.flatMap((row) => (row.days ?? [])
    .filter((day) => ["pending", "draft", "error", "missing"].includes(day.status))
    .map((day) => ({ ...day, unit: row.unit, inSession: row.inSession })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const olderPending = scoped.flatMap((entry) => aggregates.slice(0, -1).map((aggregate) => {
    const [single] = aggregateMonthlySummaries([entry], [{ year: aggregate.year, month: aggregate.month }], today);
    const hasSummary = entry.summaries.some((item) => item.year === aggregate.year && item.month === aggregate.month);
    return hasSummary && single.pendingDays > 0 ? { kioskId: entry.kioskId, year: aggregate.year, month: aggregate.month, days: single.pendingDays } : null;
  })).filter((item): item is NonNullable<typeof item> => item !== null);
  const unitName = (id: string) => units.find((unit) => unit.id === id)?.name ?? id;
  const maxDiff = Math.max(...aggregates.map((aggregate) => Math.abs(aggregate.differenceCents)), 1);
  const cash = current;
  const cashTotal = Math.max(cash.countedCashCents, 1);
  const cashSegments = [
    { label: "Pago", value: cash.paidCashCents, className: "bg-ds-ok" },
    { label: "Emitido", value: Math.max(cash.issuedCashCents - cash.paidCashCents, 0), className: "bg-ds-ok-bg ring-1 ring-inset ring-ds-ok" },
    { label: "Em bloco", value: Math.max(cash.allocatedCashCents - cash.issuedCashCents, 0), className: "bg-ds-border-input" },
    { label: "Sem bloco", value: Math.max(cash.countedCashCents - cash.allocatedCashCents, 0), className: "bg-ds-muted ring-1 ring-inset ring-ds-border" },
  ];

  if (summariesLoading) {
    return <div className="grid gap-3 sm:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-ds-card" />)}</div>;
  }
  if (pdvUnits.length === 0) {
    return <p className="rounded-ds-card border border-ds-border bg-ds-surface p-8 text-center text-[14px] text-ds-ink-muted">Nenhuma unidade com PDV neste recorte.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Vendas no PDV"
          value={formatBRL(current.salesCents)}
          sub={current.salesMissingUnits > 0
            ? `parcial · ${current.salesMissingUnits} ${current.salesMissingUnits === 1 ? "unidade" : "unidades"} sem venda apurada`
            : "cupons do mês, sem suprimentos e sangrias"}
        />
        <Kpi label="Conferido" value={formatBRL(current.countedCents)} sub={current.salesMissingUnits === 0 && current.salesCents > 0 ? `${percent(current.countedCents, current.salesCents)} das vendas` : undefined} />
        <Kpi label="Diferença final" value={signedBRL(current.differenceCents)} tone={current.differenceCents < 0 ? "text-ds-danger" : current.differenceCents > 0 ? "text-ds-ok" : undefined} sub="faltas e sobras dos dias aprovados" />
        <Kpi label="Dias fechados" value={`${current.approvedDays} de ${current.elapsedDays}`} sub={current.pendingDays > 0 ? <strong className="text-ds-alert-ink">{current.pendingDays} pendentes até ontem</strong> : "tudo fechado até ontem"}>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ds-muted"><div className="h-full rounded-full bg-ds-ok" style={{ width: `${current.elapsedDays ? (current.approvedDays / current.elapsedDays) * 100 : 0}%` }} /></div>
        </Kpi>
        <Kpi label="Dinheiro até o banco" value={formatBRL(current.paidCashCents)} sub={`pago de ${formatBRL(current.countedCashCents)} conferidos`} />
      </div>

      {sessionDays > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-ds-md border border-ds-accent-soft bg-ds-accent-soft/60 px-4 py-2.5">
          <span className="text-[13.5px] text-ds-accent-ink">Há sessão de contagem aberta com {sessionDays} {sessionDays === 1 ? "dia" : "dias"} deste recorte.</span>
          <button type="button" onClick={onOpenSessions} className="rounded-ds-btn border border-ds-border-input bg-ds-surface px-3.5 py-2 text-[13px] font-bold hover:bg-ds-muted">Ir para Sessões de contagem</button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface" aria-labelledby="units-title">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2.5 pt-4">
          <div>
            <h2 id="units-title" className="text-[18px] font-extrabold">{formatClosureMonthLabel(year, month)} por unidade</h2>
            <p className="text-[13px] text-ds-ink-muted">Clique numa unidade para ver o detalhe · ordenado por mais pendências</p>
          </div>
          {canViewDays ? <DayStatusLegend /> : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[14px]">
            <thead>
              <tr className="bg-ds-muted text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted">
                <th className="px-5 py-2 text-left">Unidade</th>
                {canViewDays ? <th className="w-[34%] px-3 py-2 text-left">Dias do mês</th> : null}
                <th className="px-3 py-2 text-right">Fechados</th>
                <th className="px-3 py-2 text-right">Vendas PDV</th>
                <th className="px-3 py-2 text-right">Diferença</th>
                <th className="px-3 py-2 text-left">Situação</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ unit, summary, days, stats, unitAggregate, pending, inSession }) => {
                const href = `/dashboard/financial/cash-closures/${encodeURIComponent(unit.id)}`;
                const difference = summary?.differenceTotalCents ?? 0;
                return (
                  <tr key={unit.id} className="group border-b border-ds-divider hover:bg-ds-warm">
                    <td className="px-5 py-2.5">
                      <Link href={href} className="block focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent-ink">
                        <strong className="block truncate">{unit.name}</strong>
                        <span className="text-[11.5px] text-ds-ink-muted">PDV {unit.pdvFilialId}</span>
                      </Link>
                    </td>
                    {canViewDays ? (
                      <td className="px-3 py-2.5">
                        {closuresLoading && !days?.some((day) => day.closure) ? <Skeleton className="h-4 w-full" /> : days ? <CashClosureDayStrip days={days} label={`${unit.name}: ${stats?.closed ?? 0} dias fechados, ${pending} pendentes`} /> : null}
                      </td>
                    ) : null}
                    <td className="px-3 py-2.5 text-right font-ds-mono text-[13px]">{stats ? `${stats.closed}/${stats.elapsed}` : `${unitAggregate.approvedDays}/${unitAggregate.elapsedDays}`}</td>
                    <td className="px-3 py-2.5 text-right font-ds-mono text-[13px]">{salesLabel(summary)}</td>
                    <td className={cn("px-3 py-2.5 text-right font-ds-mono text-[13px]", difference < 0 && "text-ds-danger", difference > 0 && "text-ds-ok")}>{signedBRL(difference)}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-bold",
                        pending === 0 ? "bg-ds-ok-bg text-ds-ok" : inSession ? "bg-ds-accent-soft text-ds-accent-ink" : "bg-ds-warn-bg text-ds-alert-ink")}>
                        {pending === 0 ? "Em dia" : inSession ? `${pending} ${pending === 1 ? "dia" : "dias"} · na sessão` : `Faltam ${pending} ${pending === 1 ? "dia" : "dias"}`}
                      </span>
                    </td>
                    <td className="pr-4 text-right"><Link href={href} aria-label={`Abrir ${unit.name}`} className="text-ds-ink-faint group-hover:text-ds-accent-ink"><ArrowRight className="h-4 w-4" /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {withoutPdv > 0 ? <p className="px-5 py-3 text-[12.5px] text-ds-ink-muted">+ {withoutPdv} {withoutPdv === 1 ? "unidade" : "unidades"} sem filial no PDV · não gera fechamento diário</p> : null}
      </section>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[999_1_620px] overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface" aria-labelledby="months-title">
          <div className="px-5 pb-2 pt-4">
            <h2 id="months-title" className="text-[18px] font-extrabold">Como anda cada mês</h2>
            <p className="text-[13px] text-ds-ink-muted">Unidades com PDV do recorte · um mês só está fechado quando todos os dias passados foram aprovados</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-[14px]">
              <thead>
                <tr className="bg-ds-muted text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted">
                  <th className="px-5 py-2 text-left">Competência</th>
                  <th className="px-3 py-2 text-left">Dias aprovados</th>
                  <th className="px-3 py-2 text-right">Vendas PDV</th>
                  <th className="px-3 py-2 text-right">Conferido</th>
                  <th className="px-3 py-2 text-right">Diferença</th>
                  <th className="px-3 py-2 text-left">Situação</th>
                </tr>
              </thead>
              <tbody>
                {[...aggregates].reverse().map((aggregate) => {
                  const isCurrent = aggregate.key === key;
                  const done = aggregate.elapsedDays > 0 && aggregate.pendingDays === 0;
                  const running = aggregate.key === today.slice(0, 7);
                  return (
                    <tr key={aggregate.key} className={cn("border-b border-ds-divider", isCurrent && "bg-ds-accent-soft/50")}>
                      <td className="px-5 py-2.5 font-semibold">{formatClosureMonthLabel(aggregate.year, aggregate.month)}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-ds-muted"><span className={cn("block h-full rounded-full", done ? "bg-ds-ok" : "bg-ds-warn")} style={{ width: `${aggregate.elapsedDays ? (aggregate.approvedDays / aggregate.elapsedDays) * 100 : 0}%` }} /></span>
                          <span className="min-w-14 font-ds-mono text-[12px] text-ds-ink-2">{aggregate.approvedDays}/{aggregate.elapsedDays}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-ds-mono text-[13px]" title={aggregate.salesMissingUnits > 0 ? "Parcial: há unidade sem venda apurada neste mês" : undefined}>{formatBRL(aggregate.salesCents)}{aggregate.salesMissingUnits > 0 ? <span className="ml-1 text-ds-alert-ink">*</span> : null}</td>
                      <td className="px-3 py-2.5 text-right font-ds-mono text-[13px]">{formatBRL(aggregate.countedCents)}</td>
                      <td className={cn("px-3 py-2.5 text-right font-ds-mono text-[13px]", aggregate.differenceCents < 0 && "text-ds-danger", aggregate.differenceCents > 0 && "text-ds-ok")}>{signedBRL(aggregate.differenceCents)}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-bold", done ? "bg-ds-ok-bg text-ds-ok" : running ? "bg-ds-warn-bg text-ds-alert-ink" : "bg-ds-danger-bg text-ds-confirm-ink")}>
                          {aggregate.elapsedDays === 0 ? "Sem dias" : done ? (running ? "Em dia" : "Fechado") : `Faltam ${aggregate.pendingDays} ${aggregate.pendingDays === 1 ? "dia" : "dias"}`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 pb-5 pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted">Diferença final por mês</p>
            <div className="grid grid-cols-6 gap-3" role="img" aria-label={aggregates.map((aggregate) => `${formatClosureMonthLabel(aggregate.year, aggregate.month)}: ${signedBRL(aggregate.differenceCents)}`).join("; ")}>
              {aggregates.map((aggregate) => {
                const height = Math.round((Math.abs(aggregate.differenceCents) / maxDiff) * 48);
                return (
                  <div key={aggregate.key} className="flex flex-col items-center">
                    <div className="flex h-12 w-full items-end justify-center">{aggregate.differenceCents > 0 ? <span className="w-7 rounded-t-[4px] bg-ds-ok" style={{ height }} /> : null}</div>
                    <div className="h-px w-full bg-ds-border-input" />
                    <div className="flex h-12 w-full items-start justify-center">{aggregate.differenceCents < 0 ? <span className="w-7 rounded-b-[4px] bg-ds-danger" style={{ height }} /> : null}</div>
                    <span className="text-[12px] text-ds-ink-2">{shortMonth(aggregate.year, aggregate.month)}</span>
                    <span className={cn("font-ds-mono text-[11.5px]", aggregate.differenceCents < 0 ? "text-ds-danger" : aggregate.differenceCents > 0 ? "text-ds-ok" : "text-ds-ink-muted")}>{signedBRL(aggregate.differenceCents)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="flex flex-[1_1_340px] flex-col gap-4">
          <section className="rounded-ds-card border border-ds-border bg-ds-warm p-5" aria-labelledby="pending-title">
            <h2 id="pending-title" className="text-[16px] font-extrabold">O que falta fechar</h2>
            <p className="mb-2 text-[12.5px] text-ds-ink-muted">Somente consulta · a contagem é feita em Sessões de contagem</p>
            {olderPending.length === 0 && pendingList.length === 0 ? <p className="py-3 text-[13px] text-ds-ok">Nada pendente no recorte até ontem.</p> : (
              <ul className="divide-y divide-ds-divider text-[13.5px]">
                {olderPending.map((item) => (
                  <li key={`${item.kioskId}-${item.year}-${item.month}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2.5">
                    <span><strong className="block">{formatClosureMonthLabel(item.year, item.month)}</strong><span className="text-[12px] text-ds-ink-muted">{unitName(item.kioskId)}</span></span>
                    <span className="self-center font-semibold text-ds-confirm-ink">{item.days} {item.days === 1 ? "dia" : "dias"}</span>
                  </li>
                ))}
                {pendingList.slice(0, 12).map((day) => (
                  <li key={`${day.unit.id}-${day.date}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2.5">
                    <span><strong className="block font-ds-mono text-[13px]">{day.date.split("-").reverse().join("/")}</strong><span className="text-[12px] text-ds-ink-muted">{day.unit.name}</span></span>
                    <span className={cn("self-center text-right font-semibold", day.inSession ? "text-ds-accent-ink" : DAY_STATUS_META[day.status].ink)}>{day.inSession ? "Na sessão" : DAY_STATUS_META[day.status].label}</span>
                  </li>
                ))}
              </ul>
            )}
            {pendingList.length > 12 ? <p className="mt-2 text-[12.5px] text-ds-ink-muted">e mais {pendingList.length - 12} dias</p> : null}
            <button type="button" onClick={onOpenSessions} className="mt-3 rounded-ds-btn border border-ds-border-input bg-ds-surface px-3.5 py-2 text-[13px] font-bold hover:bg-ds-muted">Ir para Sessões de contagem</button>
          </section>

          <section className="rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="cash-title">
            <h2 id="cash-title" className="text-[16px] font-extrabold">Dinheiro conferido até o banco</h2>
            <p className="mb-3 text-[12.5px] text-ds-ink-muted">{formatClosureMonthLabel(year, month)} · {formatBRL(cash.countedCashCents)} conferidos</p>
            <div className="flex h-3.5 overflow-hidden rounded-full bg-ds-muted">
              {cashSegments.map((segment) => segment.value > 0 ? <span key={segment.label} className={cn("h-full", segment.className)} style={{ width: `${(segment.value / cashTotal) * 100}%` }} /> : null)}
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] text-ds-ink-2">
              {cashSegments.map((segment) => (
                <span key={segment.label} className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-[3px]", segment.className)} />{segment.label}<span className="ml-auto font-ds-mono">{formatBRL(segment.value)}</span></span>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
