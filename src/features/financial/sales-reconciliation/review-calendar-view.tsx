"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, CircleAlert, Clock3, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { money } from "./review-view";
import { salesReviewDayLabels, type SalesReviewCalendarDay, type SalesReviewDayState, type SalesReviewMonth } from "./review-calendar";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const statusStyles: Record<SalesReviewDayState, string> = {
  closed: "border-ds-border bg-ds-ok-bg text-ds-ok",
  attention_required: "border-ds-confirm-border bg-ds-danger-bg text-ds-confirm-ink",
  awaiting_source: "border-ds-alert-border bg-ds-warn-bg text-ds-alert-ink",
  reopened: "border-ds-border bg-ds-info-bg text-ds-info",
  not_reviewed: "border-ds-border bg-white text-ds-ink-muted",
  outside_scope: "border-transparent bg-ds-muted text-ds-ink-muted",
  not_available: "border border-dashed border-ds-border bg-ds-surface text-ds-ink-muted",
};

const dotStyles: Record<SalesReviewDayState, string> = {
  closed: "bg-ds-ok",
  attention_required: "bg-ds-danger",
  awaiting_source: "bg-ds-warn",
  reopened: "bg-ds-info",
  not_reviewed: "bg-ds-neutral",
  outside_scope: "bg-transparent",
  not_available: "bg-transparent",
};

function monthLabel(year: number, month: number) {
  const value = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function statusIcon(state: SalesReviewDayState) {
  if (state === "closed") return CheckCircle2;
  if (state === "reopened") return RotateCcw;
  if (state === "attention_required") return CircleAlert;
  return Clock3;
}

function isClickable(day: SalesReviewCalendarDay) {
  return !["outside_scope", "not_available"].includes(day.state);
}

function MiniDay({ day, href }: { day: SalesReviewCalendarDay; href: string }) {
  const label = `${day.day}: ${salesReviewDayLabels[day.state]}`;
  const className = cn("relative grid h-8 place-items-center rounded-md border text-xs font-semibold tabular-nums", statusStyles[day.state]);
  if (!isClickable(day)) return <span aria-label={label} title={salesReviewDayLabels[day.state]} className={className}>{day.day}</span>;
  return <Link href={href} aria-label={label} title={salesReviewDayLabels[day.state]}
    className={cn(className, "transition-colors hover:border-ds-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ds-accent")}>
    {day.day}
    <span aria-hidden="true" className={cn("absolute right-1 top-1 size-1 rounded-full", dotStyles[day.state])} />
  </Link>;
}

function MonthCard({ month, monthHref, dayHref }: { month: SalesReviewMonth; monthHref: string; dayHref: (date: string) => string }) {
  const pending = month.counts.attention_required + month.counts.awaiting_source + month.counts.reopened;
  const outsideScope = month.days.every(day => day.state === "outside_scope");
  const monthName = monthLabel(month.year, month.month);
  const badge = pending ? `${pending} pendente${pending === 1 ? "" : "s"}`
    : month.counts.not_reviewed ? `${month.counts.not_reviewed} a verificar`
      : !month.eligibleCount ? outsideScope ? "Fora da vigência" : "Aguardando dados"
        : "Mês fechado";
  return <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-ds-border bg-ds-surface p-3 shadow-xs">
    <header className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
      <div>
        <h3 className="text-sm font-extrabold text-ds-ink">{monthName}</h3>
        <p className="mt-0.5 text-xs text-ds-ink-muted">{month.reviewedCount} de {month.eligibleCount} dias verificados</p>
      </div>
      <StatusPill variant={pending ? "danger" : month.counts.not_reviewed || !month.eligibleCount ? "neutral" : "ok"}>
        {badge}
      </StatusPill>
    </header>
    <div role="progressbar" aria-label={`Dias elegíveis fechados em ${monthName}`} aria-valuenow={month.closedPercent}
      className="h-1 overflow-hidden rounded-full bg-ds-muted">
      <div className="h-full bg-ds-ok" style={{ width: `${month.closedPercent}%` }} />
    </div>
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map(day => <span key={day} className="text-center text-[10px] font-semibold text-ds-ink-muted">{day}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: month.offset }, (_, index) => <span key={`empty-${index}`} />)}
        {month.days.map(day => <MiniDay key={day.date} day={day} href={dayHref(day.date)} />)}
      </div>
    </div>
    <Button asChild variant="ds-ghost" size="xs" className="mt-auto w-full justify-between">
      <Link href={monthHref}>Abrir calendário do mês <ArrowRight aria-hidden="true" className="size-3.5" /></Link>
    </Button>
  </article>;
}

function Legend({ state }: { state: SalesReviewDayState }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-3.5 rounded-[3px] border", statusStyles[state])} />{salesReviewDayLabels[state]}</span>;
}

function MonthCalendar({ month, yearHref, previousHref, nextHref, dayHref }: {
  month: SalesReviewMonth;
  yearHref: string;
  previousHref: string | null;
  nextHref: string | null;
  dayHref: (date: string) => string;
}) {
  const difference = month.days.reduce((sum, day) => sum + (day.record?.summary.stoneAmountCents ?? 0) - (day.record?.summary.pdvAmountCents ?? 0), 0);
  const pending = month.counts.attention_required + month.counts.awaiting_source + month.counts.reopened;
  return <section className="space-y-4" aria-label={`Calendário de ${monthLabel(month.year, month.month)}`}>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href={yearHref} className="mb-2 inline-flex items-center gap-1.5 text-xs font-extrabold text-ds-ink-muted hover:text-ds-accent-ink"><ArrowLeft className="h-3.5 w-3.5" />Visão anual</Link>
        <h2 className="text-2xl font-black tracking-tight">{monthLabel(month.year, month.month)}</h2>
        <p className="mt-1 text-sm text-ds-ink-muted">Cada dia abre a conferência detalhada com as evidências do PDV e da Stone.</p>
      </div>
      <div className="flex items-center gap-2">
        {previousHref ? <Link href={previousHref} aria-label="Mês anterior" className="grid h-10 w-10 place-items-center rounded-xl border border-ds-border bg-white text-ds-ink-muted hover:border-ds-accent-soft hover:text-ds-accent-ink"><ArrowLeft className="h-4 w-4" /></Link> : null}
        {nextHref ? <Link href={nextHref} aria-label="Próximo mês" className="grid h-10 w-10 place-items-center rounded-xl border border-ds-border bg-white text-ds-ink-muted hover:border-ds-accent-soft hover:text-ds-accent-ink"><ArrowRight className="h-4 w-4" /></Link> : null}
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ["Dias fechados", String(month.counts.closed), `${month.closedPercent}% dos dias elegíveis`, "text-ds-ok"],
        ["Pendências", String(pending), pending ? "Priorize os dias destacados" : "Nenhuma pendência registrada", pending ? "text-ds-danger" : "text-ds-ok"],
        ["Não verificados", String(month.counts.not_reviewed), "Aguardando conferência automática", "text-ds-ink-2"],
        ["Diferença acumulada", money(difference), "Stone − PDV nos dias verificados", difference ? "text-ds-danger" : "text-ds-ok"],
      ].map(([title, value, detail, tone]) => <div key={title} className="rounded-2xl border border-ds-border bg-white px-4 py-3.5">
        <p className="text-[10px] font-black uppercase tracking-[.11em] text-ds-ink-faint">{title}</p>
        <p className={cn("mt-2 font-mono text-xl font-black tabular-nums", tone)}>{value}</p>
        <p className="mt-1 text-[11px] font-medium text-ds-ink-faint">{detail}</p>
      </div>)}
    </div>
    <div className="overflow-hidden rounded-[20px] border border-ds-border bg-ds-warm shadow-[0_2px_12px_rgba(15,23,42,.045)]">
      <div className="grid grid-cols-7 border-b border-ds-border bg-ds-muted px-2 py-2 sm:px-3">{WEEKDAYS.map(day => <span key={day} className="text-center text-[10px] font-black uppercase tracking-wide text-ds-ink-faint">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-px bg-ds-muted">
        {Array.from({ length: month.offset }, (_, index) => <div key={`empty-${index}`} className="min-h-24 bg-white/70 sm:min-h-28" />)}
        {month.days.map(day => {
          const Icon = statusIcon(day.state);
          const content = <>
            <div className="flex items-center justify-between gap-1"><strong className="text-sm">{day.day}</strong><Icon aria-hidden="true" className="h-3.5 w-3.5" /></div>
            <p className="mt-auto pt-3 text-[9.5px] font-black leading-3 sm:text-[10.5px]">{salesReviewDayLabels[day.state]}</p>
            {day.record ? <p className="mt-1 hidden font-mono text-[9px] opacity-70 lg:block">{money(day.record.summary.stoneAmountCents - day.record.summary.pdvAmountCents)}</p> : null}
          </>;
          const className = cn("flex min-h-24 flex-col border-0 p-2 text-left sm:min-h-28 sm:p-2.5", statusStyles[day.state]);
          if (!isClickable(day)) return <div key={day.date} aria-label={`${day.date}: ${salesReviewDayLabels[day.state]}`} className={className}>{content}</div>;
          return <Link key={day.date} href={dayHref(day.date)} aria-label={`${day.date}: ${salesReviewDayLabels[day.state]}`}
            className={cn(className, "transition hover:relative hover:z-10 hover:brightness-[.97] focus-visible:relative focus-visible:z-10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent")}>
            {content}
          </Link>;
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ds-border px-4 py-3 text-[10.5px] font-semibold text-ds-ink-muted">
        <Legend state="closed" /><Legend state="attention_required" /><Legend state="awaiting_source" /><Legend state="reopened" /><Legend state="not_reviewed" />
      </div>
    </div>
  </section>;
}

export function SalesReviewCalendarView({ months, selectedMonth, loading, error, ready, onRetry, yearHref, monthHref, dayHref }: {
  months: SalesReviewMonth[];
  selectedMonth: string | null;
  loading: boolean;
  error: string;
  ready: boolean;
  onRetry: () => void;
  yearHref: string;
  monthHref: (month: string) => string;
  dayHref: (date: string) => string;
}) {
  if (!ready) return <div className="rounded-[20px] border border-dashed border-ds-border bg-white/50 px-6 py-16 text-center">
    <CalendarDays className="mx-auto h-8 w-8 text-ds-ink-faint" />
    <p className="mt-3 text-sm font-black">Escolha a unidade e o StoneCode</p>
    <p className="mt-1 text-xs text-ds-ink-muted">O calendário será carregado automaticamente para o vínculo selecionado.</p>
  </div>;
  if (loading) return <div aria-live="polite" className="grid min-h-72 place-items-center rounded-[20px] border border-ds-border bg-white"><span className="inline-flex items-center gap-2 text-sm font-bold text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin text-ds-accent-ink" />Carregando calendário…</span></div>;
  if (error) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-ds-confirm-border bg-ds-danger-bg px-5 py-4 text-ds-confirm-ink"><div><p className="text-sm font-black">Não foi possível carregar o calendário</p><p className="mt-1 text-xs">{error}</p></div><button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-2 rounded-xl border border-ds-confirm-border bg-white px-3 text-xs font-black"><RefreshCw className="h-3.5 w-3.5" />Tentar novamente</button></div>;
  const month = selectedMonth ? months.find(item => item.key === selectedMonth) ?? null : null;
  if (selectedMonth && month) {
    const index = months.findIndex(item => item.key === selectedMonth);
    return <MonthCalendar month={month} yearHref={yearHref}
      previousHref={index > 0 ? monthHref(months[index - 1].key) : null}
      nextHref={index < months.length - 1 ? monthHref(months[index + 1].key) : null}
      dayHref={dayHref} />;
  }
  const totals = months.reduce((summary, monthItem) => ({
    closed: summary.closed + monthItem.counts.closed,
    pending: summary.pending + monthItem.counts.attention_required + monthItem.counts.awaiting_source + monthItem.counts.reopened,
    notReviewed: summary.notReviewed + monthItem.counts.not_reviewed,
  }), { closed: 0, pending: 0, notReviewed: 0 });
  return <section className="space-y-3" aria-label="Conciliação por mês">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-extrabold tracking-tight text-ds-ink">Visão anual</h2>
      <div className="flex flex-wrap gap-2">
        <StatusPill variant="ok">{totals.closed} {totals.closed === 1 ? "fechado" : "fechados"}</StatusPill>
        <StatusPill variant={totals.pending ? "danger" : "neutral"}>{totals.pending} {totals.pending === 1 ? "pendente" : "pendentes"}</StatusPill>
        <StatusPill>{totals.notReviewed} {totals.notReviewed === 1 ? "não verificado" : "não verificados"}</StatusPill>
      </div>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ds-ink-muted">
      <Legend state="closed" /><Legend state="attention_required" /><Legend state="awaiting_source" />
      <Legend state="reopened" /><Legend state="not_reviewed" /><Legend state="outside_scope" /><Legend state="not_available" />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {months.map(monthItem => <MonthCard key={monthItem.key} month={monthItem} monthHref={monthHref(monthItem.key)} dayHref={dayHref} />)}
    </div>
  </section>;
}
