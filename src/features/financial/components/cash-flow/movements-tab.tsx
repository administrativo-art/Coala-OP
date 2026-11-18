"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCurrency } from "@/features/financial/lib/utils";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { periodBounds, type Granularity, type StudyRange } from "@/features/financial/cash-flow-study/periods";
import { Card, FilterTile, GranularityToggle, GroupHeader, LedgerHead, MoneyIn, MoneyOut, TileRow, dm, dmy, monthName, useGroupToggle, type ChartTipProps } from "@/features/financial/cash-flow-study/study-ui";
import { cn } from "@/lib/utils";
import {
  groupMovements, matchesMovementFilter, movementDay, isUnlinkedOutflow, summarizeMovements, type CashMovement, type MovementFilter,
} from "./movements-model";

const LEDGER = "md:grid-cols-[minmax(0,2fr)_110px_minmax(110px,1fr)_70px_120px_150px]";
const thousand = (reais: number) => `${reais < 0 ? "−" : ""}R$ ${(Math.abs(reais) / 1000).toFixed(1).replace(".", ",")} mil`;

type ChartRow = { key: string; axis: string; title: string; income: number; outcome: number };
function MovementsTooltip({ active, payload }: ChartTipProps) {
  const row = active ? (payload?.[0]?.payload as ChartRow | undefined) : undefined;
  if (!row) return null;
  return (
    <div className="grid min-w-[200px] gap-1 rounded-xl bg-ds-dark px-3.5 py-3 text-[12.5px] text-ds-on-dark shadow-xl">
      <p className="text-[13px] font-bold">{row.title}</p>
      <p className="flex justify-between gap-4"><span>Entrou</span><span className="font-ds-mono">+{formatCurrency(row.income)}</span></p>
      <p className="flex justify-between gap-4"><span>Saiu</span><span className="font-ds-mono">−{formatCurrency(-row.outcome)}</span></p>
    </div>
  );
}

/** Extrato realizado das contas: o que entrou e saiu no período escolhido, do mais recente para o mais antigo. */
export function MovementsTab({ movements, range, granularity, onGranularity, loading, today }: {
  /** Movimentos realizados do período e da conta escolhidos. */
  movements: CashMovement[];
  range: StudyRange;
  granularity: Granularity;
  onGranularity: (value: Granularity) => void;
  loading: boolean;
  today: string;
}) {
  const [filter, setFilter] = useState<MovementFilter>("all");
  const { isOpen, toggle } = useGroupToggle(`${granularity}|${range.from}|${range.to}|${filter}`, granularity);

  const summary = useMemo(() => summarizeMovements(movements), [movements]);
  const visible = useMemo(() => movements.filter(movement => matchesMovementFilter(movement, filter)), [movements, filter]);
  const groups = useMemo(() => groupMovements(visible, range, granularity), [visible, range, granularity]);
  const chart = useMemo<ChartRow[]>(() => periodBounds(range, granularity).map(bound => {
    const inPeriod = visible.filter(movement => { const day = movementDay(movement); return day >= bound.start && day <= bound.end; });
    const sum = (direction: "in" | "out") => inPeriod.filter(movement => movement.direction === direction).reduce((total, movement) => total + movement.amount, 0);
    return {
      key: bound.start, income: sum("in"), outcome: -sum("out"),
      axis: granularity === "day" ? dm(bound.start) : granularity === "month" ? monthName(bound.month!).slice(0, 3) : dm(bound.weekStart ?? bound.start),
      title: granularity === "day" ? dmy(bound.start) : granularity === "month" ? `${monthName(bound.month!)}/${bound.month!.slice(0, 4)}` : `Semana ${dm(bound.start)} a ${dm(bound.end)}`,
    };
  }), [visible, range, granularity]);

  if (loading) return <div className="space-y-4"><Skeleton className="h-24 w-full rounded-ds-card" /><Skeleton className="h-64 w-full rounded-ds-card" /></div>;

  return (
    <div className="space-y-[18px]">
      <TileRow>
        <FilterTile kicker="Período" title="Resultado" value={thousand(summary.resultAmount)} line={`${summary.count} movimentações`} tone={summary.resultAmount < 0 ? "danger" : undefined} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterTile kicker="Entradas" title="Entrou" value={thousand(summary.inAmount)} line={`${summary.inCount} lançamentos`} active={filter === "in"} onClick={() => setFilter(filter === "in" ? "all" : "in")} />
        <FilterTile kicker="Saídas" title="Saiu" value={thousand(summary.outAmount)} line={`${summary.outCount} lançamentos`} active={filter === "out"} onClick={() => setFilter(filter === "out" ? "all" : "out")} />
        {summary.unlinkedCount > 0 ? <FilterTile kicker="Pendências" title="Sem despesa vinculada" value={thousand(summary.unlinkedAmount)} line={`${summary.unlinkedCount} saídas para classificar`} tone="danger" alert active={filter === "unlinked"} onClick={() => setFilter(filter === "unlinked" ? "all" : "unlinked")} /> : null}
      </TileRow>

      <Card
        title="Extrato das contas"
        description={`O que já entrou e saiu, de ${dmy(range.from)} a ${dmy(range.to)}. Previsões ficam em Próximas semanas e em Entradas.`}
        aside={<GranularityToggle value={granularity} onChange={onGranularity} />}
      >
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-1 text-[12px] text-ds-ink-muted">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-ds-ok" />Entrou</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px] bg-ds-danger" />Saiu</span>
        </div>
        <div className="h-[220px] w-full px-3 pb-3" role="img" aria-label="Entradas e saídas por período">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} stackOffset="sign" margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
              <XAxis dataKey="axis" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" minTickGap={18} />
              <YAxis tickLine={false} axisLine={false} fontSize={10} width={52} tickFormatter={value => `${Math.round(Number(value) / 1000)} mil`} />
              <Tooltip cursor={{ opacity: 0.08 }} content={props => <MovementsTooltip {...props} />} />
              <ReferenceLine y={0} stroke="var(--ds-ink-faint)" />
              <Bar dataKey="income" stackId="m" fill="var(--ds-ok)" fillOpacity={0.85} maxBarSize={38} />
              <Bar dataKey="outcome" stackId="m" fill="var(--ds-danger)" fillOpacity={0.85} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <LedgerHead columns={LEDGER} labels={[{ text: "Descrição" }, { text: "Conta" }, { text: "Categoria" }, { text: "Data" }, { text: "Valor", right: true }, { text: "Situação" }]} />
        {groups.every(group => !group.movements.length) ? <p className="px-[18px] py-6 text-center text-[13px] text-ds-ink-muted">Nenhuma movimentação encontrada para os filtros selecionados.</p> : groups.map(group => {
          if (!group.movements.length && filter !== "all") return null;
          const open = isOpen(group.key);
          return (
            <div key={group.key}>
              <GroupHeader row={group} granularity={granularity} today={today} open={open} onToggle={() => toggle(group.key)} count={group.movements.length}>
                <MoneyIn>+{formatCurrency(group.inAmount)}</MoneyIn><MoneyOut>−{formatCurrency(group.outAmount)}</MoneyOut>
              </GroupHeader>
              {open ? group.movements.map(movement => {
                const unlinked = isUnlinkedOutflow(movement);
                return (
                  <div key={movement.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-ds-divider px-[18px] py-2.5", LEDGER, unlinked && "bg-ds-alert-bg")}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[11px]", movement.direction === "in" ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-danger-bg text-ds-danger")}>
                        {movement.direction === "in" ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-[13.5px] font-bold leading-5">{movement.description}</p>
                        <p className="truncate text-xs text-ds-ink-muted">{movement.supplier ?? "Sem favorecido informado"}{movement.competenceDate ? ` · competência ${String(movement.competenceDate.getMonth() + 1).padStart(2, "0")}/${movement.competenceDate.getFullYear()}` : ""}</p>
                      </div>
                    </div>
                    <span className={cn("text-right font-ds-mono text-[13.5px] font-bold md:hidden", movement.direction === "in" ? "text-ds-ok" : "text-ds-danger")}>{movement.direction === "in" ? "+" : "−"}{formatCurrency(movement.amount)}</span>
                    <span className="col-span-2 truncate text-[13px] font-semibold md:col-span-1">{movement.accountName ?? "Sem conta"}</span>
                    <span className="col-span-2 truncate text-[13px] text-ds-ink-2 md:col-span-1">{movement.accountPlanName ?? "Sem plano de contas"}</span>
                    <span className="col-span-2 font-ds-mono text-[12.5px] md:col-span-1">{dm(movementDay(movement))}</span>
                    <span className={cn("hidden text-right font-ds-mono text-[13.5px] font-extrabold md:block", movement.direction === "in" ? "text-ds-ok" : "text-ds-danger")}>{movement.direction === "in" ? "+" : "−"}{formatCurrency(movement.amount)}</span>
                    <div className="col-span-2 md:col-span-1">
                      {unlinked
                        ? <Button variant="ds-secondary" size="xs" asChild><Link href={FINANCIAL_ROUTES.expenses}>Vincular despesa</Link></Button>
                        : <StatusPill variant="ok">{movement.direction === "in" ? "Recebido" : "Conciliado"}</StatusPill>}
                    </div>
                  </div>
                );
              }) : null}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
