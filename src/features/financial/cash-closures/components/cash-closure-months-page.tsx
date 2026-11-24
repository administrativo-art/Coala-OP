"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useKiosks } from "@/hooks/use-kiosks";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/patterns/page-hero";
import { PageContainer } from "@/components/layout/page-container";
import { resolvePdvFilialId } from "@/lib/kiosk-identifiers";
import { CashControlNavigation } from "./cash-control-navigation";
import { formatBRL } from "../money";
import { formatClosureMonthLabel, shiftClosureDate, todayInClosureTimezone } from "../date";
import { CASH_CLOSURE_CHANNELS, type CashClosure, type CashClosureChannel, type CashClosureMonthlySummary } from "../types";
import { aggregateMonthlySummaries, monthDayStatuses, monthlySummarySalesCents, trailingMonths, unitMonthStats } from "../analysis";
import { pdvSalesCents } from "../../../../../functions/src/cash-closure-dre";
import { DAY_STATUS_META, DayStatusLegend } from "./cash-closure-day-strip";

const CHANNEL_LABELS: Record<CashClosureChannel, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  debit_card: "Cartão débito",
  credit_card: "Cartão crédito",
  voucher: "Voucher",
  signed_account: "Conta assinada",
  other: "Outros",
};

export function CashClosureMonthsPage({ kioskId }: { kioskId: string }) {
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { kiosks } = useKiosks();
  const { toast } = useToast();
  const [summaries, setSummaries] = useState<CashClosureMonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const canBrowseCatalog = permissions.financial?.view === true;
  const canOpenCalendar = permissions.financial?.cashClosures?.view === true;

  const load = useCallback(async () => {
    if (!firebaseUser || !canBrowseCatalog) return;
    setLoading(true);
    try {
      const payload = await api<{ summaries?: CashClosureMonthlySummary[] }>(`/api/financial/cash-closures/months?kioskId=${encodeURIComponent(kioskId)}`, {
        fallbackError: "Falha ao carregar competências.",
      });
      setSummaries(payload.summaries ?? []);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally { setLoading(false); }
  }, [api, canBrowseCatalog, firebaseUser, kioskId, toast]);

  useEffect(() => { void load(); }, [load]);

  const [monthClosures, setMonthClosures] = useState<CashClosure[]>([]);
  useEffect(() => {
    if (!firebaseUser || !canOpenCalendar) return;
    let cancelled = false;
    const [year, month] = todayInClosureTimezone().split("-").map(Number);
    const params = new URLSearchParams({ kioskId, year: String(year), month: String(month) });
    void api<{ closures?: CashClosure[] }>(`/api/financial/cash-closures?${params}`, { fallbackError: "Falha ao carregar os dias do mês." })
      .then((payload) => { if (!cancelled) setMonthClosures(payload.closures ?? []); })
      .catch(() => { if (!cancelled) setMonthClosures([]); });
    return () => { cancelled = true; };
  }, [api, canOpenCalendar, firebaseUser, kioskId, summaries]);

  const kiosk = kiosks.find((item) => item.id === kioskId);
  const kioskName = kiosk?.name
    ?? summaries[0]?.kioskName
    ?? kioskId;
  const pdvFilialId = resolvePdvFilialId({ id: kioskId, pdvFilialId: kiosk?.pdvFilialId });

  async function syncYesterday() {
    setSyncing(true);
    try {
      const date = shiftClosureDate(todayInClosureTimezone(), -1);
      await api("/api/financial/cash-closures/sync", {
        method: "POST",
        json: { kioskId, date },
        fallbackError: "Falha ao sincronizar o fechamento de ontem.",
      });
      toast({ title: `${kioskName}: fechamento de ontem sincronizado.` });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao sincronizar." });
    } finally {
      setSyncing(false);
    }
  }

  if (!canBrowseCatalog) return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Seu perfil não possui acesso ao módulo financeiro.</div>;

  const today = todayInClosureTimezone();
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const currentSummary = summaries.find((summary) => summary.year === todayYear && summary.month === todayMonth);
  const [currentAggregate] = aggregateMonthlySummaries([{ kioskId, summaries }], [{ year: todayYear, month: todayMonth }], today);
  const days = monthDayStatuses(todayYear, todayMonth, monthClosures, today);
  const dayStats = canOpenCalendar ? unitMonthStats(days) : null;
  const pendingNow = dayStats ? dayStats.pending : currentAggregate.pendingDays;
  const olderPending = aggregateMonthlySummaries([{ kioskId, summaries }], trailingMonths(todayYear, todayMonth, 6).slice(0, -1), today)
    .filter((aggregate) => summaries.some((summary) => summary.year === aggregate.year && summary.month === aggregate.month) && aggregate.pendingDays > 0)
    .reduce((total, aggregate) => total + aggregate.pendingDays, 0);
  const monthsRow = trailingMonths(todayYear, todayMonth, 6).map(({ year, month }) => {
    const summary = summaries.find((item) => item.year === year && item.month === month);
    const [aggregate] = aggregateMonthlySummaries([{ kioskId, summaries: summary ? [summary] : [] }], [{ year, month }], today);
    return { year, month, summary, aggregate };
  }).filter((item) => item.summary || (item.year === todayYear && item.month === todayMonth));
  const difference = currentSummary?.differenceTotalCents ?? 0;
  const currentSales = currentSummary ? monthlySummarySalesCents(currentSummary) : 0;
  const approved = monthClosures.filter((closure) => closure.status === "approved");
  const channels = CASH_CLOSURE_CHANNELS.map((channel) => ({
    channel,
    label: CHANNEL_LABELS[channel],
    expected: approved.reduce((total, closure) => total + (closure.expectedByChannelCents?.[channel] ?? 0), 0),
    difference: approved.reduce((total, closure) => total + (closure.differenceByChannelCents?.[channel] ?? 0), 0),
  })).filter((item) => item.expected !== 0 || item.difference !== 0);
  const channelTotal = Math.max(channels.reduce((total, item) => total + Math.max(item.expected, 0), 0), 1);
  const firstWeekday = new Date(Date.UTC(todayYear, todayMonth - 1, 1)).getUTCDay();
  const signed = (cents: number) => (cents === 0 ? formatBRL(0) : `${cents > 0 ? "+" : "−"}${formatBRL(Math.abs(cents))}`);
  const lastApproved = currentSummary?.lastApprovedDate ?? summaries.find((summary) => summary.lastApprovedDate)?.lastApprovedDate ?? null;

  return <PageContainer variant="wide" surface className="space-y-5 pb-10">
    <CashControlNavigation crumbs={[{ label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures?aba=analise" }, { label: kioskName }]} />
    <PageHero
      kicker="Financeiro · Análise do fechamento"
      title={kioskName}
      subtitle={`Filial PDV ${pdvFilialId ?? "não configurada"}${lastApproved ? ` · último dia aprovado: ${lastApproved.split("-").reverse().join("/")}` : ""}`}
      actions={<>{canOpenCalendar && permissions.financial.cashClosures.resync && pdvFilialId && <Button variant="on-dark-secondary" size="md" onClick={() => void syncYesterday()} disabled={syncing || loading}>{syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar ontem</Button>}</>}
    >{!canOpenCalendar && <p className="text-xs font-semibold text-ds-accent-kicker">Seu perfil pode consultar as competências, mas não abrir o calendário e a auditoria.</p>}</PageHero>

    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Vendas no PDV", value: currentSales === null ? "—" : formatBRL(currentSales), sub: currentSales === null ? "venda incompleta no resumo do mês" : `${formatClosureMonthLabel(todayYear, todayMonth).toLocaleLowerCase("pt-BR")} · sem suprimentos e sangrias` },
          { label: "Conferido", value: formatBRL(currentSummary?.countedTotalCents ?? 0), sub: `${currentAggregate.approvedDays} dias aprovados` },
          { label: "Diferença final", value: signed(difference), sub: dayStats ? (dayStats.differenceDays ? `${dayStats.differenceDays} ${dayStats.differenceDays === 1 ? "dia" : "dias"} com diferença` : "sem diferença") : "dias aprovados", tone: difference < 0 ? "text-ds-danger" : difference > 0 ? "text-ds-ok" : "" },
          { label: "Falta fechar", value: olderPending ? `${pendingNow} + ${olderPending}` : String(pendingNow), sub: olderPending ? "este mês + meses anteriores" : pendingNow ? "dias até ontem" : "tudo fechado até ontem", tone: pendingNow + olderPending > 0 ? "text-ds-alert-ink" : "text-ds-ok" },
          { label: "Por vir no mês", value: `${dayStats ? dayStats.future : Math.max(new Date(Date.UTC(todayYear, todayMonth, 0)).getUTCDate() - currentAggregate.elapsedDays, 0)} dias`, sub: "inclui hoje" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-ds-card border border-ds-border bg-ds-surface p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted">{tile.label}</p>
            <p className={cn("mt-1.5 font-ds-mono text-[21px] font-bold", tile.tone)}>{tile.value}</p>
            <p className="mt-0.5 text-[12px] text-ds-ink-muted">{tile.sub}</p>
          </div>
        ))}
      </div>

      <section className="space-y-2.5" aria-labelledby="kiosk-months-title">
        <h2 id="kiosk-months-title" className="text-[18px] font-extrabold">Meses</h2>
        <div className="grid gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          {monthsRow.map(({ year, month, aggregate }) => {
            const isCurrent = year === todayYear && month === todayMonth;
            const done = aggregate.elapsedDays > 0 && aggregate.pendingDays === 0;
            const diff = summaries.find((item) => item.year === year && item.month === month)?.differenceTotalCents ?? 0;
            const content = <>
              <span className="flex items-center justify-between gap-2"><strong className="text-[14px]">{new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1))).replace(". de ", "/").replace(" de ", "/")}</strong><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", done ? "bg-ds-ok-bg text-ds-ok" : isCurrent ? "bg-ds-warn-bg text-ds-alert-ink" : "bg-ds-danger-bg text-ds-confirm-ink")}>{done ? (isCurrent ? "Em dia" : "Fechado") : `Faltam ${aggregate.pendingDays}`}</span></span>
              <span className="mt-2 block h-2 overflow-hidden rounded-full bg-ds-muted"><span className={cn("block h-full rounded-full", done ? "bg-ds-ok" : "bg-ds-warn")} style={{ width: `${aggregate.elapsedDays ? (aggregate.approvedDays / aggregate.elapsedDays) * 100 : 0}%` }} /></span>
              <span className="mt-1.5 flex justify-between font-ds-mono text-[12px] text-ds-ink-muted"><span>{aggregate.approvedDays}/{aggregate.elapsedDays}</span><span className={cn(diff < 0 && "text-ds-danger", diff > 0 && "text-ds-ok")}>{signed(diff)}</span></span>
            </>;
            const className = cn("block rounded-ds-card border bg-ds-surface p-3.5", isCurrent ? "border-2 border-ds-accent" : "border-ds-border", canOpenCalendar && "hover:bg-ds-warm");
            return canOpenCalendar
              ? <Link key={`${year}-${month}`} href={`/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${year}/${String(month).padStart(2, "0")}`} className={className}>{content}</Link>
              : <div key={`${year}-${month}`} className={className}>{content}</div>;
          })}
        </div>
      </section>

      {canOpenCalendar ? <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[999_1_620px] rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="kiosk-calendar-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div><h2 id="kiosk-calendar-title" className="text-[18px] font-extrabold">{formatClosureMonthLabel(todayYear, todayMonth).toLocaleLowerCase("pt-BR")}</h2><p className="text-[13px] text-ds-ink-muted">Vendas do PDV e situação de cada dia · somente consulta, a contagem é feita em Sessões de contagem</p></div>
            <DayStatusLegend />
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted">{["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
          <div className="mt-1.5 grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstWeekday }).map((_, index) => <span key={`blank-${index}`} />)}
            {days.map((day) => {
              const meta = DAY_STATUS_META[day.status];
              const label = day.status === "difference" && day.closure ? `Diferença ${signed(day.closure.differenceTotalCents)}` : day.status === "future" ? "" : meta.label;
              const content = <>
                <span className="flex justify-between text-[13px] font-bold"><span>{day.day}</span>{day.status === "today" ? <span className="text-[10px] font-extrabold text-ds-accent-ink">HOJE</span> : null}</span>
                <span>{day.closure && pdvSalesCents(day.closure.pdvSales) !== null ? <span className="block font-ds-mono text-[11.5px] font-bold">{formatBRL(pdvSalesCents(day.closure.pdvSales)!)}</span> : null}<span className={cn("block truncate text-[11px] font-bold", meta.ink)}>{label}</span></span>
              </>;
              const className = cn("flex min-h-20 flex-col justify-between rounded-ds-md p-2 text-left", meta.soft);
              return day.status === "future"
                ? <div key={day.date} className={className}>{content}</div>
                : <Link key={day.date} href={`/dashboard/financial/cash-closures/${encodeURIComponent(kioskId)}/${todayYear}/${String(todayMonth).padStart(2, "0")}/${String(day.day).padStart(2, "0")}`} className={cn(className, "hover:brightness-[.97]")}>{content}</Link>;
            })}
          </div>
        </section>
        <aside className="flex-[1_1_320px] rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="kiosk-channels-title">
          <h2 id="kiosk-channels-title" className="text-[16px] font-extrabold">Por forma de pagamento</h2>
          <p className="mb-3 text-[12.5px] text-ds-ink-muted">Dias aprovados de {formatClosureMonthLabel(todayYear, todayMonth).toLocaleLowerCase("pt-BR")}</p>
          {channels.length === 0 ? <p className="text-[13px] text-ds-ink-muted">Nenhum dia aprovado no mês.</p> : <>
            <div className="flex h-3.5 overflow-hidden rounded-full bg-ds-muted">{channels.filter((item) => item.expected > 0).map((item, index) => <span key={item.channel} className={cn("h-full", ["bg-ds-ink", "bg-ds-accent", "bg-ds-accent-ink", "bg-ds-ink-faint", "bg-ds-border-input", "bg-ds-seg", "bg-ds-neutral"][index % 7])} style={{ width: `${(item.expected / channelTotal) * 100}%` }} />)}</div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 text-[11px] font-semibold uppercase tracking-wider text-ds-ink-muted"><span>Forma</span><span className="text-right">Vendas</span><span className="text-right">Diferença</span></div>
            <ul className="divide-y divide-ds-divider text-[13.5px]">{channels.map((item) => <li key={item.channel} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 py-2"><span className={cn(item.channel === "cash" && "font-semibold")}>{item.label}</span><span className="text-right font-ds-mono text-[13px]">{formatBRL(item.expected)}</span><span className={cn("text-right font-ds-mono text-[13px]", item.difference < 0 && "text-ds-danger", item.difference > 0 && "text-ds-ok")}>{signed(item.difference)}</span></li>)}</ul>
          </>}
        </aside>
      </div> : null}
    </>}
  </PageContainer>;
}
