"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { StatusPill } from "@/components/ui/status-pill";
import { budgetPace, type BudgetPaceTone } from "@/features/financial/budgets/comparison";
import type { FinancialBudgetSummary } from "@/features/financial/budgets/types";
import { formatCurrency } from "@/features/financial/lib/utils";
import { cn } from "@/lib/utils";

const TONE_VARIANT: Record<BudgetPaceTone, "ok" | "warn" | "danger"> = { ok: "ok", warn: "warn", danger: "danger" };
const TONE_COLOR: Record<BudgetPaceTone, string> = { ok: "var(--ds-info)", warn: "var(--ds-warn)", danger: "var(--ds-danger)" };
const TONE_BAR: Record<BudgetPaceTone, string> = { ok: "bg-ds-info", warn: "bg-ds-warn", danger: "bg-ds-danger" };
const cents = (value: number) => formatCurrency(value / 100);

/** Resumo visual do orçamento da competência: livre, ritmo de consumo e a curva do disponível ao longo do mês. */
export function BudgetPaceSummary({ budget, today }: { budget: FinancialBudgetSummary; today: string }) {
  const pace = budgetPace(budget, today);
  const used = Math.min(pace.usedRatio, 1) * 100;
  const expected = Math.min(pace.expectedCents / Math.max(budget.budgetedAmountCents, 1), 1 - Math.min(pace.usedRatio, 1)) * 100;
  const color = TONE_COLOR[pace.tone];
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill variant={TONE_VARIANT[pace.tone]}>{pace.label}</StatusPill>
        <p className="font-mono text-[26px] font-bold leading-none tracking-[-0.02em]">
          {pace.freeCents < 0 ? "−" : ""}{cents(Math.abs(pace.freeCents))}
          <small className="ml-1.5 text-[13px] font-semibold tracking-normal text-ds-ink-muted">{pace.freeCents < 0 ? "acima do previsto" : "livre"}</small>
        </p>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-ds-muted" role="img" aria-label={`Usou ${Math.round(pace.usedRatio * 100)}% do previsto em ${Math.round(pace.timeRatio * 100)}% do mês`}>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", TONE_BAR[pace.tone])} style={{ width: `${used}%` }} />
        {expected > 0 ? <span className="absolute inset-y-0 bg-ds-ink-faint/50" style={{ left: `${used}%`, width: `${expected}%` }} /> : null}
        <span className="absolute -inset-y-0.5 w-0.5 bg-ds-ink" style={{ left: `${pace.timeRatio * 100}%` }} title="Hoje" />
      </div>
      <p className="text-[12.5px] text-ds-ink-2">
        {pace.tone === "danger"
          ? <>Já passou <b>{cents(budget.consumedAmountCents - budget.budgetedAmountCents)}</b> do previsto.</>
          : <>Usou <b>{Math.round(pace.usedRatio * 100)}%</b> do previsto em {Math.round(pace.timeRatio * 100)}% do mês.</>}
        {pace.expectedCents > 0 ? <> Ainda é esperada compra de <b>{cents(pace.expectedCents)}</b>.</> : null}
      </p>
      {budget.curve.length > 1 ? (
        <div className="h-[170px] w-full" role="img" aria-label="Disponível do orçamento ao longo do mês">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={budget.curve} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} fontSize={10} width={44} tickFormatter={(value) => `${Math.round(Number(value) / 100_000)}k`} />
              <Tooltip formatter={(value) => cents(Number(value))} labelFormatter={(label) => `Dia ${label}`} />
              <ReferenceLine y={0} stroke="var(--ds-ink-faint)" />
              <Line type="linear" dataKey="plannedBalanceCents" name="Referência planejada" stroke="var(--ds-ink-faint)" strokeDasharray="5 5" strokeWidth={2} dot={false} />
              <Line type="stepAfter" dataKey="actualBalanceCents" name="Disponível após despesas" stroke={color} strokeWidth={2.5} dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <p className="text-xs text-ds-ink-muted">Este saldo é do orçamento da categoria; não representa o saldo bancário.</p>
    </div>
  );
}
