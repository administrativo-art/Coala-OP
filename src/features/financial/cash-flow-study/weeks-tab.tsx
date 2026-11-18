"use client";

import { useMemo } from "react";
import { AlertTriangle, CircleCheck, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { CashFlowStudyPayload, StudyControls } from "./cash-flow-study-view";
import { isProjection, buildPeriodRows, lowestBalance, type Granularity, type PeriodRow, type PeriodStatus } from "./periods";
import {
  type ChartClickState, type ChartTipProps, scrollToGroup, useGroupToggle, axisThousands, brl, Card, DueHint, entryOrigin, EntryStatusPill, GranularityToggle, GroupHeader, LedgerHead, MoneyIn, MoneyOut, ProjectionBar,
  dm, dmy, monthName, signedBrl, thousands,
} from "./study-ui";

export const PERIOD_STATUS: Record<PeriodStatus, { label: string; variant: StatusPillVariant }> = {
  comfortable: { label: "Folga", variant: "ok" },
  normal: { label: "Normal", variant: "neutral" },
  below_minimum: { label: "Abaixo do mínimo", variant: "warn" },
  negative: { label: "Negativo", variant: "danger" },
};

const LEDGER = "lg:grid-cols-[minmax(0,2fr)_minmax(90px,.8fr)_96px_120px_120px_120px]";
const PERIOD_SUMMARY = "md:grid-cols-[minmax(0,1fr)_120px_120px_120px_120px]";
const SUMMARY_AMOUNT = "flex min-w-0 flex-col items-start gap-y-0.5 text-[12.5px] md:block md:text-right";
const SUMMARY_LABEL = "text-[11px] font-semibold text-ds-ink-muted md:sr-only";
const SUMMARY_VALUE = "ml-auto whitespace-nowrap font-ds-mono font-extrabold tabular-nums";


function axisLabel(row: PeriodRow, granularity: Granularity, today: string) {
  if (granularity === "day") return row.start === today ? "hoje" : dm(row.start);
  if (granularity === "month") return monthName(row.month!).slice(0, 3);
  return dm(row.weekStart ?? row.start);
}

function BalanceTooltip({ active, payload, granularity }: ChartTipProps & { granularity: Granularity }) {
  const row = active ? (payload?.[0]?.payload as (PeriodRow & { title: string }) | undefined) : undefined;
  if (!row) return null;
  return (
    <div className="grid min-w-[220px] gap-1 rounded-xl bg-ds-dark px-3.5 py-3 text-[12.5px] text-ds-on-dark shadow-xl">
      <p className="text-[13px] font-bold">{row.title}</p>
      <p className="flex justify-between gap-4 text-ds-on-dark-muted"><span>Começa com</span><span className="font-ds-mono">{brl(row.openingCents)}</span></p>
      <p className="flex justify-between gap-4"><span>Entra</span><span className="font-ds-mono">+{brl(row.inCents)}</span></p>
      <p className="flex justify-between gap-4"><span>Sai</span><span className="font-ds-mono">−{brl(row.outCents)}</span></p>
      <p className="mt-1 flex justify-between gap-4 border-t border-white/10 pt-1.5 font-bold"><span>Termina com</span><span className="font-ds-mono">{brl(row.closingCents)}</span></p>
      <span className="sr-only">{granularity}</span>
    </div>
  );
}

function BalanceChart({ rows, granularity, today, minimum, onPick }: { rows: PeriodRow[]; granularity: Granularity; today: string; minimum: number | null; onPick: (key: string) => void }) {
  const data = useMemo(() => rows.map(row => ({
    ...row, axis: axisLabel(row, granularity, today),
    title: granularity === "day" ? `${row.start === today ? "Hoje · " : ""}${dmy(row.start)}` : granularity === "month" ? `${monthName(row.month!)}/${row.month!.slice(0, 4)}` : `Semana ${dm(row.start)} a ${dm(row.end)}`,
  })), [rows, granularity, today]);
  return (
    <div className="h-[280px] w-full px-3 pb-4" role="img" aria-label="Saldo previsto no fim de cada período">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 14, right: 12, left: 0, bottom: 0 }} style={{ cursor: "pointer" }} onClick={(state: ChartClickState) => { const key = state.activePayload?.[0]?.payload?.key; if (key) onPick(key); }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
          <XAxis dataKey="axis" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={18} />
          <YAxis tickLine={false} axisLine={false} fontSize={10} width={52} tickFormatter={value => axisThousands(Number(value))} />
          <Tooltip cursor={{ opacity: 0.08 }} content={props => <BalanceTooltip {...props} granularity={granularity} />} />
          {minimum !== null ? <ReferenceLine y={minimum} stroke="var(--ds-danger)" strokeDasharray="6 4" strokeWidth={1.5} label={{ value: `Mínimo ${thousands(minimum)}`, position: "insideTopRight", fill: "var(--ds-danger)", fontSize: 11 }} /> : null}
          <ReferenceLine y={0} stroke="var(--ds-ink-faint)" />
          <Bar dataKey="closingCents" radius={[4, 4, 0, 0]} maxBarSize={46}>
            {data.map(row => <Cell key={row.key} fill={row.status === "negative" || row.status === "below_minimum" ? "var(--ds-danger)" : "var(--ds-ink-2)"} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeeksTab({ data, controls }: { data: CashFlowStudyPayload; controls: StudyControls }) {
  const { range, projection, includeReserve, granularity, today } = controls;
  const rows = useMemo(() => buildPeriodRows(data, { range, granularity, projection, includeReserve }), [data, range, granularity, projection, includeReserve]);
  const low = useMemo(() => lowestBalance(data, { range, projection, includeReserve }), [data, range, projection, includeReserve]);
  const { isOpen, toggle, open: openGroup } = useGroupToggle(`${granularity}|${range.from}|${range.to}|${projection}|${includeReserve}`, granularity);

  const entryCount = rows.reduce((sum, row) => sum + row.entries.length, 0);
  return (
    <div className="space-y-[18px]">
      <ProjectionBar projection={projection} onChange={controls.setProjection} />
      {low.daysBelowMinimum > 0 ? (
        <div role="status" className="flex items-start gap-2.5 rounded-ds-btn-lg border border-ds-alert-border bg-ds-alert-bg px-4 py-3 text-ds-alert-ink">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-[13.5px]">
            <b>O caixa fica abaixo do mínimo em {low.daysBelowMinimum} {low.daysBelowMinimum === 1 ? "dia" : "dias"} até {dmy(range.to)}, entre {dm(low.firstBelow!)} e {dm(low.lastBelow!)}.</b>
            {low.lowest ? <span className="block text-[12.5px]">O pior dia é {low.lowest.date === today ? "hoje" : dm(low.lowest.date)}, com {thousands(low.lowest.cents)}.{projection ? "" : " Sem projeção, não entra nenhuma venda nova: é o pior caso para as entradas."}</span> : null}
          </p>
        </div>
      ) : (
        <div role="status" className="flex items-start gap-2.5 rounded-ds-btn-lg bg-ds-ok-bg px-4 py-3 text-ds-ok">
          <CircleCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-[13.5px] font-semibold">O caixa cobre as contas até {dmy(range.to)}{projection ? ", já contando as saídas recorrentes" : " com o que já foi vendido"}.{low.lowest ? <span className="block text-[12.5px] font-normal">Menor saldo previsto: {thousands(low.lowest.cents)} em {dm(low.lowest.date)}.</span> : null}</p>
        </div>
      )}

      <Card
        title="Quanto vai ter nas contas"
        description={`${granularity === "day" ? "Saldo no fim de cada dia" : granularity === "week" ? "Saldo no domingo, fim de cada semana" : "Saldo no último dia de cada mês"}, de ${dmy(range.from)} até ${dmy(range.to)}. Passe o mouse para ver o que entrou e saiu.`}
        aside={<GranularityToggle value={granularity} onChange={controls.setGranularity} />}
      >
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-1 text-[12px] text-ds-ink-muted">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-ds-ink-2" />Saldo no fim do {granularity === "day" ? "dia" : granularity === "week" ? "semana" : "mês"}</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-ds-danger" />Abaixo do mínimo</span>
        </div>
        <BalanceChart rows={rows} granularity={granularity} today={today} minimum={data.minimumCents} onPick={key => { openGroup(key); scrollToGroup(key); }} />
      </Card>

      <Card title="Entradas e saídas" description="Um lançamento por linha, na data em que cai ou vence. Clique no cabeçalho do grupo para recolher ou abrir." aside={<span className="text-[12.5px] text-ds-ink-muted">{entryCount} lançamentos · {projection ? "com projeção" : "sem projeção"}</span>}>
        <LedgerHead columns={PERIOD_SUMMARY} labels={[{ text: "Período" }, { text: "Entradas", right: true }, { text: "Saídas", right: true }, { text: "Saldo final", right: true }, { text: "Status" }]} />
        {rows.map(row => {
          const open = isOpen(row.key);
          let balance = row.openingCents;
          return (
            <div key={row.key}>
              <GroupHeader row={row} granularity={granularity} today={today} open={open} onToggle={() => toggle(row.key)} count={row.entries.length} summaryColumns={PERIOD_SUMMARY}>
                <span className={SUMMARY_AMOUNT}>
                  <span className={SUMMARY_LABEL}>Entradas</span>
                  <span className={SUMMARY_VALUE}><MoneyIn>+{brl(row.inCents)}</MoneyIn></span>
                </span>
                <span className={SUMMARY_AMOUNT}>
                  <span className={SUMMARY_LABEL}>Saídas</span>
                  <span className={SUMMARY_VALUE}><MoneyOut>−{brl(row.outCents)}</MoneyOut></span>
                </span>
                <span className={SUMMARY_AMOUNT}>
                  <span className={SUMMARY_LABEL}>Saldo final</span>
                  <span className={cn(SUMMARY_VALUE, "text-ds-ink")}>{brl(row.closingCents)}</span>
                </span>
                <span className="self-center justify-self-end md:justify-self-start">
                  <StatusPill variant={PERIOD_STATUS[row.status].variant}>{PERIOD_STATUS[row.status].label}</StatusPill>
                </span>
              </GroupHeader>
              {open ? (row.entries.length ? <>
                <LedgerHead columns={LEDGER} visibility="lg:grid" labels={[{ text: "Descrição" }, { text: "Origem" }, { text: "Data" }, { text: "Valor", right: true }, { text: "Saldo depois", right: true }, { text: "Status" }]} />
                {row.entries.map(entry => {
                  balance += entry.direction === "in" ? entry.amountCents : -entry.amountCents;
                  const projected = isProjection(entry);
                  return (
                    <div key={entry.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-ds-divider px-[18px] py-2.5", LEDGER, entry.lateFrom && "bg-ds-alert-bg")}>
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[11px]", projected ? "border border-dashed border-ds-ink-faint text-ds-ink-faint" : entry.direction === "in" ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-danger-bg text-ds-danger")}>
                          {entry.direction === "in" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-[13.5px] font-bold leading-5">{entry.label}</p>
                          {entry.detail ? <p className="truncate text-xs text-ds-ink-muted">{entry.detail}</p> : null}
                        </div>
                      </div>
                      <span className={cn("text-right font-ds-mono text-[13.5px] font-bold lg:hidden", entry.direction === "in" ? "text-ds-ok" : "text-ds-danger")}>{signedBrl(entry)}</span>
                      <span className="col-span-2 truncate text-[13px] font-semibold lg:col-span-1">{entryOrigin(entry)}</span>
                      <div className="col-span-2 lg:col-span-1"><p className="font-ds-mono text-[12.5px]">{dm(entry.date)}</p><DueHint entry={entry} today={today} /></div>
                      <span className={cn("hidden text-right font-ds-mono text-[13.5px] font-extrabold lg:block", entry.direction === "in" ? "text-ds-ok" : "text-ds-danger")}>{signedBrl(entry)}</span>
                      <span className={cn("col-span-2 font-ds-mono text-[12.5px] lg:col-span-1 lg:text-right lg:text-[13.5px] lg:font-bold", balance < 0 ? "text-ds-danger" : data.minimumCents !== null && balance < data.minimumCents ? "text-ds-alert-ink" : "")}><span className="lg:hidden">saldo depois: </span>{brl(balance)}</span>
                      <div className="col-span-2 lg:col-span-1"><EntryStatusPill entry={entry} /></div>
                    </div>
                  );
                })}
              </> : <p className="border-b border-ds-divider px-[18px] py-3 text-[13px] text-ds-ink-muted">Nada neste período.</p>) : null}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
