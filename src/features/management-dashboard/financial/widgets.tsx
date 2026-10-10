"use client";

import type { ElementType } from "react";

import { cn } from "@/lib/utils";

import type { FinancialWidgetId } from "../types";
import { widgetIcons } from "../widgets/icons";
import { KpiTile, MeterBar, Pill, WidgetCard, WidgetEmpty, WidgetHead, toneClass, type Tone } from "../widgets/kit";
import type { AccountBalance, ExpenseGroup, ExpenseRow, FinancialDashboardData, ForecastBucket, RankingRow } from "./data";

type Money = (value: number) => string;

function ExpenseItem({ row, money }: { row: ExpenseRow; money: Money }) {
  return (
    <li className="flex items-center gap-3 rounded-ds-card border border-ds-divider bg-ds-surface p-3">
      <div className={cn("flex h-10 w-11 shrink-0 flex-col items-center justify-center rounded-lg", row.overdue ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-warn-bg text-ds-warn")}>
        <span className="text-sm font-black leading-none tabular-nums">{row.dueDay}</span>
        <span className="mt-0.5 text-[9px] font-bold uppercase leading-none">{row.dueLabel}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-ds-ink">{row.description}</p>
        <p className={cn("truncate text-xs font-medium", row.overdue ? "text-ds-danger" : "text-ds-ink-faint")}>{row.supplier} · {row.daysLabel}</p>
      </div>
      <span className="whitespace-nowrap text-sm font-black tabular-nums text-ds-ink">{money(row.value)}</span>
    </li>
  );
}

/** Lista de despesas com total: serve a vencidos, a vencer na semana e pendentes de auditoria. */
export function ExpenseListWidget({ widgetId, title, subtitle, icon, tone, href, group, loading, empty, totalLabel, money }: {
  widgetId: FinancialWidgetId; title: string; subtitle: string; icon: ElementType; tone: Tone; href: string;
  group: ExpenseGroup; loading: boolean; empty: string; totalLabel: string; money: Money;
}) {
  return (
    <WidgetCard widgetId={widgetId}>
      {(density) => (
        <>
          <WidgetHead icon={icon} tone={tone} title={title} subtitle={subtitle} href={href} density={density} />
          {loading ? (
            <WidgetEmpty>Carregando despesas...</WidgetEmpty>
          ) : density === "compact" ? (
            <div>
              <p className={cn("text-xs font-bold", group.count > 0 ? toneClass[tone].ink : "text-ds-ink-muted")}>{totalLabel} · {group.count} despesa(s)</p>
              <p className={cn("mt-1 whitespace-nowrap text-3xl font-black tracking-tight tabular-nums", group.count > 0 ? toneClass[tone].ink : "text-ds-ink")}>{money(group.total)}</p>
              {group.rows[0] ? <p className="mt-2 truncate text-xs font-medium text-ds-ink-muted">Próxima: {group.rows[0].description}</p> : null}
            </div>
          ) : (
            <>
              <div className={cn("grid gap-3", density === "wide" ? "grid-cols-3" : "grid-cols-2")}>
                <KpiTile label={totalLabel} value={money(group.total)} tone={group.count > 0 ? tone : "muted"} icon={widgetIcons.wallet} />
                <KpiTile label="Despesas" value={String(group.count)} note="no recorte" icon={widgetIcons.expenses} />
                {density === "wide" ? <KpiTile label="Maior valor" value={money(Math.max(0, ...group.rows.map((row) => row.value)))} note="entre as listadas" icon={widgetIcons.analysis} /> : null}
              </div>
              {group.rows.length === 0 ? (
                <WidgetEmpty>{empty}</WidgetEmpty>
              ) : (
                <ul className={cn("gap-2.5", density === "wide" ? "grid grid-cols-2" : "space-y-2.5")}>{group.rows.slice(0, density === "wide" ? 6 : 3).map((row) => <ExpenseItem key={row.id} row={row} money={money} />)}</ul>
              )}
              {group.count > (density === "wide" ? 6 : 3) ? <div><Pill tone="muted">+{group.count - (density === "wide" ? 6 : 3)} outras</Pill></div> : null}
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}

export function SummaryWidget({ indicators, loading, money }: { indicators: { openExpenses: number; upcomingDue: number; cash: number; dre: number }; loading: boolean; money: Money }) {
  return (
    <WidgetCard widgetId="fin-summary">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.financeHub} tone="accent" title="Resumo financeiro" subtitle="Posição consolidada" href="/dashboard/financial/dre" density={density} />
          {loading ? <WidgetEmpty>Carregando indicadores...</WidgetEmpty> : (
            <div className={cn("grid gap-3", density === "compact" ? "grid-cols-1" : density === "medium" ? "grid-cols-2" : "grid-cols-4")}>
              <KpiTile label="Despesas em aberto" value={money(indicators.openExpenses)} note="a liquidar" tone="warn" icon={widgetIcons.expenses} />
              <KpiTile label="Vencem em 30 dias" value={money(indicators.upcomingDue)} note="curto prazo" tone="info" icon={widgetIcons.workday} />
              <KpiTile label="Caixa consolidado" value={money(indicators.cash)} note="entradas − saídas" tone={indicators.cash >= 0 ? "ok" : "danger"} icon={widgetIcons.cash} />
              <KpiTile label="Resultado DRE" value={money(indicators.dre)} note="realizado" tone={indicators.dre >= 0 ? "ok" : "danger"} icon={widgetIcons.income} />
            </div>
          )}
        </>
      )}
    </WidgetCard>
  );
}

export function CompetenceWidget({ data, loading, money }: { data: FinancialDashboardData; loading: boolean; money: Money }) {
  const { competence } = data;
  return (
    <WidgetCard widgetId="fin-competence">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.expenses} tone="info" title="Competência do mês" subtitle={data.monthLabel} href="/dashboard/financial/expenses" density={density} />
          {loading ? <WidgetEmpty>Carregando competência...</WidgetEmpty> : (
            <>
              <div>
                <p className="text-xs font-bold text-ds-ink-muted">Provisionado · {competence.count} despesa(s)</p>
                <p className="mt-1 whitespace-nowrap text-3xl font-black tracking-tight tabular-nums text-ds-ink">{money(competence.provisioned)}</p>
              </div>
              <MeterBar value={competence.paidShare} tone="ok" />
              <div className={cn("grid gap-3", density === "compact" ? "grid-cols-1" : "grid-cols-3")}>
                <KpiTile label="Pago" value={money(competence.paid)} note={`${Math.round(competence.paidShare * 100)}%`} tone="ok" />
                <KpiTile label="Em aberto" value={money(competence.open)} tone={competence.open > 0 ? "warn" : "muted"} />
                {density !== "compact" ? <KpiTile label="Despesas" value={String(competence.count)} note="no mês" /> : null}
              </div>
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}

function delta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "sem variação" : "sem base anterior";
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change >= 0 ? "+" : ""}${change}% vs. mês anterior`;
}

export function CashMonthWidget({ data, loading, money }: { data: FinancialDashboardData; loading: boolean; money: Money }) {
  const { cashMonth } = data;
  const peak = Math.max(cashMonth.income, cashMonth.outcome, 1);
  return (
    <WidgetCard widgetId="fin-cash-month">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.cash} tone="ok" title="Entradas e saídas do mês" subtitle={data.monthLabel} href="/dashboard/financial/cash-flow" density={density} />
          {loading ? <WidgetEmpty>Carregando movimentos...</WidgetEmpty> : (
            <>
              <div>
                <p className="text-xs font-bold text-ds-ink-muted">Saldo do mês</p>
                <p className={cn("mt-1 whitespace-nowrap text-3xl font-black tracking-tight tabular-nums", cashMonth.net >= 0 ? "text-ds-ok" : "text-ds-danger")}>{money(cashMonth.net)}</p>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs font-bold"><span className="text-ds-ok">Entradas</span><span className="tabular-nums text-ds-ink">{money(cashMonth.income)}</span></div>
                  <MeterBar value={cashMonth.income / peak} tone="ok" />
                  {density !== "compact" ? <p className="mt-1 text-[11px] font-medium text-ds-ink-faint">{delta(cashMonth.income, cashMonth.previousIncome)}</p> : null}
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs font-bold"><span className="text-ds-danger">Saídas</span><span className="tabular-nums text-ds-ink">{money(cashMonth.outcome)}</span></div>
                  <MeterBar value={cashMonth.outcome / peak} tone="danger" />
                  {density !== "compact" ? <p className="mt-1 text-[11px] font-medium text-ds-ink-faint">{delta(cashMonth.outcome, cashMonth.previousOutcome)}</p> : null}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}

export function ForecastWidget({ buckets, loading, money }: { buckets: ForecastBucket[]; loading: boolean; money: Money }) {
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  return (
    <WidgetCard widgetId="fin-forecast">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.schedules} tone="warn" title="Previsão de pagamentos" subtitle="Próximas quatro semanas" href="/dashboard/financial/cash-flow" density={density} />
          {loading ? <WidgetEmpty>Carregando previsão...</WidgetEmpty> : (
            <>
              <p className="whitespace-nowrap text-3xl font-black tracking-tight tabular-nums text-ds-ink">{money(total)}</p>
              <ul className="flex h-32 items-end gap-2" aria-label="Valor a pagar por período">
                {buckets.map((bucket) => (
                  <li key={bucket.label} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1.5" title={`${bucket.label}: ${money(bucket.total)} (${bucket.count})`}>
                    {density !== "compact" ? <span className="truncate text-center text-[10.5px] font-bold tabular-nums text-ds-ink-muted">{bucket.total > 0 ? money(bucket.total) : "—"}</span> : null}
                    <span className={cn("block w-full rounded-t-md", bucket.overdue ? "bg-ds-danger" : "bg-ds-warn")} style={{ height: `${Math.max(4, (bucket.total / peak) * 78)}%`, opacity: bucket.total > 0 ? 1 : 0.25 }} />
                    <span className="truncate text-center text-[10.5px] font-extrabold text-ds-ink-muted">{bucket.label}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}

export function RankingWidget({ widgetId, title, subtitle, icon, tone, href, rows, loading, empty, money }: {
  widgetId: FinancialWidgetId; title: string; subtitle: string; icon: ElementType; tone: Tone; href: string;
  rows: RankingRow[]; loading: boolean; empty: string; money: Money;
}) {
  return (
    <WidgetCard widgetId={widgetId}>
      {(density) => (
        <>
          <WidgetHead icon={icon} tone={tone} title={title} subtitle={subtitle} href={href} density={density} />
          {loading ? <WidgetEmpty>Carregando...</WidgetEmpty> : rows.length === 0 ? <WidgetEmpty>{empty}</WidgetEmpty> : (
            <ol className="space-y-3">
              {rows.slice(0, density === "compact" ? 3 : density === "medium" ? 5 : 6).map((row, index) => (
                <li key={row.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate font-extrabold text-ds-ink"><span className="mr-1.5 tabular-nums text-ds-ink-faint">{index + 1}.</span>{row.label}</span>
                    <span className="shrink-0 font-black tabular-nums text-ds-ink">{money(row.value)}</span>
                  </div>
                  <MeterBar value={row.share} tone={tone} className="h-1.5" />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </WidgetCard>
  );
}

export function BankAccountsWidget({ accounts, loading, money }: { accounts: AccountBalance[]; loading: boolean; money: Money }) {
  const total = accounts.reduce((sum, account) => sum + account.balance, 0);
  return (
    <WidgetCard widgetId="fin-bank-accounts">
      {(density) => (
        <>
          <WidgetHead icon={widgetIcons.financeHub} tone="info" title="Contas bancárias" subtitle="Saldo lançado por conta" href="/dashboard/financial/cash-flow" density={density} />
          {loading ? <WidgetEmpty>Carregando contas...</WidgetEmpty> : accounts.length === 0 ? <WidgetEmpty>Nenhuma conta bancária ativa.</WidgetEmpty> : (
            <>
              <div>
                <p className="text-xs font-bold text-ds-ink-muted">Total nas contas</p>
                <p className={cn("mt-1 whitespace-nowrap text-3xl font-black tracking-tight tabular-nums", total >= 0 ? "text-ds-ink" : "text-ds-danger")}>{money(total)}</p>
              </div>
              <ul className="space-y-2">
                {accounts.slice(0, density === "compact" ? 3 : 6).map((account) => (
                  <li key={account.id} className="flex items-center justify-between gap-3 rounded-ds-card border border-ds-divider bg-ds-surface px-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate font-extrabold text-ds-ink">{account.name}</span>
                    <span className={cn("shrink-0 font-black tabular-nums", account.balance >= 0 ? "text-ds-ok" : "text-ds-danger")}>{money(account.balance)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}
