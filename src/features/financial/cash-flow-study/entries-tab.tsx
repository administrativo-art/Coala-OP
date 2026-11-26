"use client";

import { CashOperationsPanel } from "./cash-operations-panel";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type { CashFlowStudyPayload, StudyControls } from "./cash-flow-study-view";
import type { EntryStage, StudyEntry } from "./model";
import {
  incomingItems, isProjection, periodBounds, stuckDays, STAGE_LABEL, STAGE_ORDER, summarizeStages,
} from "./periods";
import {
  type ChartClickState, type ChartTipProps, scrollToGroup, useGroupToggle, useKeyedState, axisThousands, brl, Card, DueHint, entryOrigin, FilterTile, GranularityToggle, GroupHeader, LedgerHead, MoneyIn, ProjectionBar, TileRow,
  dm, dmy, monthName, thousands,
} from "./study-ui";

const CLOSURES_HREF = "/dashboard/financial/cash-closures";
const DEPOSITS_HREF = "/dashboard/financial/cash-deposits";
const LEDGER = "md:grid-cols-[minmax(0,2fr)_minmax(80px,.8fr)_minmax(140px,1fr)_96px_110px_minmax(130px,1fr)]";

type StageFilter = "all" | "action" | EntryStage;
const STAGE_KICKER: Record<EntryStage, string> = { cash_open: "Espécie", counted: "Espécie", boleto: "Espécie", stone: "Cartão", projected: "Projeção" };
const STAGE_WHO: Record<EntryStage, string> = {
  cash_open: "Financeiro conta na sessão", counted: "Financeiro gera o boleto", boleto: "Pago e compensado na conta", stone: "Automático, ninguém precisa agir", projected: "Média de 3 meses",
};

function nextStep(entry: StudyEntry): { label: string; href: string } {
  if (entry.stage === "cash_open") return { label: "Abrir sessão de contagem", href: CLOSURES_HREF };
  return { label: entry.stage === "counted" ? "Ir para Depósitos" : "Ver depósito", href: DEPOSITS_HREF };
}

function entryTitle(entry: StudyEntry) {
  if (entry.stage === "stone") return "Parcelas de cartão";
  if (entry.stage === "projected") return entry.label;
  if (entry.stage === "boleto") return "Boleto de depósito";
  return entry.label.split(" · ")[0];
}

type ChartRow = { key: string; axis: string; title: string; sold: number; late: number; future: number; total: number; count: number };

function EntriesTooltip({ active, payload }: ChartTipProps) {
  const row = active ? (payload?.[0]?.payload as ChartRow | undefined) : undefined;
  if (!row) return null;
  return (
    <div className="grid min-w-[210px] gap-1 rounded-xl bg-ds-dark px-3.5 py-3 text-[12.5px] text-ds-on-dark shadow-xl">
      <p className="text-[13px] font-bold">{row.title}</p>
      {row.sold ? <p className="flex justify-between gap-4"><span>Já vendido</span><span className="font-ds-mono">{brl(row.sold)}</span></p> : null}
      {row.late ? <p className="flex justify-between gap-4"><span>Atrasado</span><span className="font-ds-mono">{brl(row.late)}</span></p> : null}
      {row.future ? <p className="flex justify-between gap-4"><span>Venda futura</span><span className="font-ds-mono">{brl(row.future)}</span></p> : null}
      <p className="mt-1 flex justify-between gap-4 border-t border-white/10 pt-1.5 font-bold"><span>Total</span><span className="font-ds-mono">{brl(row.total)}</span></p>
      <p className="text-ds-on-dark-muted">{row.count} lançamentos</p>
    </div>
  );
}

export function EntriesTab({ data, controls }: { data: CashFlowStudyPayload; controls: StudyControls }) {
  const { range, projection, granularity, today } = controls;
  const [stageChoice, setStage] = useState<StageFilter>("all");
  // Sem projeção não há quadro de vendas futuras: o filtro volta para o total.
  const stage: StageFilter = !projection && stageChoice === "projected" ? "all" : stageChoice;
  const resetKey = `${granularity}|${range.from}|${range.to}|${projection}|${stage}`;
  const { isOpen, toggle, open: openGroup } = useGroupToggle(resetKey, granularity);
  const [showAll, setShowAll] = useKeyedState(resetKey, () => false);

  const items = useMemo(() => incomingItems(data, range, projection), [data, range, projection]);
  const summary = useMemo(() => summarizeStages(items, today), [items, today]);
  const filtered = useMemo(() => items.filter(entry => (stage === "all" ? true : stage === "action" ? stuckDays(entry, today) !== null : (entry.stage ?? "projected") === stage)), [items, stage, today]);

  const bounds = useMemo(() => periodBounds(range, granularity), [range, granularity]);
  const chart = useMemo<ChartRow[]>(() => bounds.map(bound => {
    const inPeriod = filtered.filter(entry => entry.date >= bound.start && entry.date <= bound.end);
    const late = inPeriod.filter(entry => entry.lateFrom).reduce((sum, entry) => sum + entry.amountCents, 0);
    const future = inPeriod.filter(isProjection).reduce((sum, entry) => sum + entry.amountCents, 0);
    const sold = inPeriod.reduce((sum, entry) => sum + entry.amountCents, 0) - late - future;
    const axis = granularity === "day" ? (bound.start === today ? "hoje" : dm(bound.start)) : granularity === "month" ? monthName(bound.month!).slice(0, 3) : dm(bound.weekStart ?? bound.start);
    const title = granularity === "day" ? dmy(bound.start) : granularity === "month" ? `${monthName(bound.month!)}/${bound.month!.slice(0, 4)}` : `Semana ${dm(bound.start)} a ${dm(bound.end)}`;
    return { key: bound.start, axis, title, sold, late, future, total: sold + late + future, count: inPeriod.length };
  }), [bounds, filtered, granularity, today]);

  const limit = granularity === "day" ? 7 : granularity === "week" ? 4 : 3;
  const oldest = (stageKey: EntryStage) => summary.byStage[stageKey].oldestDays;

  const tile = (key: EntryStage) => {
    const entry = summary.byStage[key];
    const stuck = entry.stuckCount > 0;
    return (
      <FilterTile key={key} kicker={STAGE_KICKER[key]} title={STAGE_LABEL[key]} value={thousands(entry.cents)}
        line={stuck ? `${entry.stuckCount} ${entry.stuckCount === 1 ? "parado" : "parados"} · até ${oldest(key)} dias` : STAGE_WHO[key]}
        tone={stuck ? (key === "boleto" ? "danger" : "warn") : undefined} active={stage === key} onClick={() => setStage(stage === key ? "all" : key)} />
    );
  };

  const jumpTo = (state: ChartClickState) => {
    const key = state.activePayload?.[0]?.payload?.key;
    if (!key || stage === "action") return;
    setShowAll(true);
    openGroup(key);
    scrollToGroup(key);
  };

  const renderRow = (entry: StudyEntry) => {
    const days = stuckDays(entry, today);
    const step = days !== null ? nextStep(entry) : null;
    const entryStage = entry.stage ?? "projected";
    return (
      <div key={entry.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-ds-divider px-[18px] py-2.5", LEDGER, entry.lateFrom && "bg-ds-alert-bg")}>
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[11px]", entryStage === "projected" ? "border border-dashed border-ds-ink-faint text-ds-ink-faint" : days !== null ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-ok-bg text-ds-ok")}>
            <ArrowDownLeft className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-[13.5px] font-bold leading-5">{entryTitle(entry)}</p>
            <p className="truncate text-xs text-ds-ink-muted">{entry.detail}</p>
          </div>
        </div>
        <span className="text-right font-ds-mono text-[13.5px] font-extrabold text-ds-ok md:hidden">+{brl(entry.amountCents)}</span>
        <span className="col-span-2 truncate text-[13px] font-semibold md:col-span-1">{entryOrigin(entry)}</span>
        <div className="col-span-2 md:col-span-1">
          {days !== null
            ? <StatusPill variant={entry.stage === "boleto" ? "danger" : "warn"}>{entry.lateFrom ? `Boleto vencido · ${days}d` : `${STAGE_LABEL[entryStage]} · ${days}d`}</StatusPill>
            : <StatusPill variant={entryStage === "stone" ? "ok" : "neutral"} className={cn(entryStage === "projected" && "border border-dashed border-ds-ink-faint bg-transparent")}>{STAGE_LABEL[entryStage]}</StatusPill>}
        </div>
        <div className="col-span-2 md:col-span-1"><p className="font-ds-mono text-[12.5px]">{dm(entry.date)}</p><DueHint entry={entry} today={today} />{(entryStage === "cash_open" || entryStage === "counted") && days === null ? <span className="block text-[11.5px] text-ds-ink-faint">previsão</span> : null}</div>
        <span className="hidden text-right font-ds-mono text-[13.5px] font-extrabold text-ds-ok md:block">+{brl(entry.amountCents)}</span>
        <div className="col-span-2 md:col-span-1">
          {step ? <Button variant="ds-secondary" size="xs" asChild><Link href={step.href}>{step.label}</Link></Button> : <span className="text-xs text-ds-ink-muted">{STAGE_WHO[entryStage]}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-[18px]">
      <ProjectionBar projection={projection} onChange={controls.setProjection} />
      <CashOperationsPanel operations={data.cashOperations ?? []} />
      <TileRow>
        <FilterTile kicker={projection ? "Tudo" : "Já vendido"} title={projection ? "Tudo o que entra" : "Fora da conta"} value={thousands(summary.total.cents)} line={`${summary.total.count} lançamentos`} active={stage === "all"} onClick={() => setStage("all")} />
        {summary.stuck.count > 0 ? <FilterTile kicker="Pendências" title="Precisa de ação" value={thousands(summary.stuck.cents)} line={`${summary.stuck.count} itens · até ${summary.stuck.oldestDays} dias`} tone="danger" alert active={stage === "action"} onClick={() => setStage(stage === "action" ? "all" : "action")} /> : null}
        {STAGE_ORDER.map(tile)}
        {projection ? tile("projected") : null}
      </TileRow>

      <Card
        title="Entradas"
        description={`${granularity === "day" ? "Quanto cai nas contas em cada dia" : granularity === "week" ? "Quanto cai nas contas em cada semana" : "Quanto cai nas contas em cada mês"}, até ${dmy(range.to)}${stage === "all" ? "" : ` · filtro: ${stage === "action" ? "Precisa de ação" : STAGE_LABEL[stage]}`}. Embaixo, cada lançamento com a etapa em que está.`}
        aside={<GranularityToggle value={granularity} onChange={controls.setGranularity} />}
      >
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-1 text-[12px] text-ds-ink-muted">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-ds-ink-2" />Já vendido</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-ds-danger" />Atrasado (devia ter caído)</span>
          {projection ? <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-ds-ink-faint" />Venda futura</span> : null}
        </div>
        <div className="h-[200px] w-full px-3 pb-3" role="img" aria-label="Entradas por período">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} style={{ cursor: "pointer" }} onClick={jumpTo}>
              <defs>
                <pattern id="cash-flow-future-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill="var(--ds-surface)" /><rect width="2" height="5" fill="var(--ds-ink-faint)" />
                </pattern>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
              <XAxis dataKey="axis" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={18} />
              <YAxis tickLine={false} axisLine={false} fontSize={10} width={52} tickFormatter={value => axisThousands(Number(value))} />
              <Tooltip cursor={{ opacity: 0.08 }} content={props => <EntriesTooltip {...props} />} />
              <Bar dataKey="sold" stackId="in" fill="var(--ds-ink-2)" fillOpacity={0.85} maxBarSize={42} />
              <Bar dataKey="late" stackId="in" fill="var(--ds-danger)" maxBarSize={42} />
              <Bar dataKey="future" stackId="in" fill="url(#cash-flow-future-hatch)" stroke="var(--ds-ink-faint)" radius={[4, 4, 0, 0]} maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <LedgerHead columns={LEDGER} labels={[{ text: "Descrição" }, { text: "Quiosque" }, { text: "Etapa" }, { text: "Cai em" }, { text: "Valor", right: true }, { text: "Próximo passo" }]} />
        {stage === "action" ? (
          filtered.length
            ? [...filtered].sort((a, b) => (stuckDays(b, today) ?? 0) - (stuckDays(a, today) ?? 0)).map(renderRow)
            : <p className="px-[18px] py-4 text-[13px] text-ds-ink-muted">Nada parado.</p>
        ) : (
          <>
            {(showAll ? bounds : bounds.slice(0, limit)).map(bound => {
              const list = filtered.filter(entry => entry.date >= bound.start && entry.date <= bound.end);
              if (!list.length && stage !== "all") return null;
              const total = list.reduce((sum, entry) => sum + entry.amountCents, 0);
              const open = isOpen(bound.start);
              return (
                <div key={bound.start}>
                  <GroupHeader row={bound} granularity={granularity} today={today} open={open} onToggle={() => toggle(bound.start)} count={list.length}><MoneyIn>+{brl(total)}</MoneyIn></GroupHeader>
                  {open ? (list.length ? list.map(renderRow) : <p className="border-b border-ds-divider px-[18px] py-3 text-[13px] text-ds-ink-muted">Nada cai neste período.</p>) : null}
                </div>
              );
            })}
            {!showAll && bounds.length > limit ? (
              <div className="px-[18px] py-3"><Button variant="ds-link" className="h-auto p-0" onClick={() => setShowAll(true)}>Mostrar {granularity === "day" ? `os outros ${bounds.length - limit} dias` : granularity === "week" ? `as outras ${bounds.length - limit} semanas` : `os outros ${bounds.length - limit} meses`}</Button></div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}

