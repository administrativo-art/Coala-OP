/**
 * Extrato realizado da Visão do caixa (aba Movimentações). Puro e sem acesso a banco: a página entrega os
 * movimentos já carregados; aqui ficam recorte por período, resumo, saídas sem despesa vinculada e agrupamento.
 * Transferências entre contas próprias nunca chegam aqui (a página as descarta).
 */
import { addMonths, monthEnd } from "@/features/financial/cash-flow-study/model";
import { periodBounds, type Granularity, type StudyRange } from "@/features/financial/cash-flow-study/periods";

export type CashMovement = {
  source?: "expense" | "expense_forecast" | "budget_residual" | "budget_scenario" | "project_residual";
  id: string;
  date: Date;
  description: string;
  accountId?: string;
  accountName?: string;
  accountPlanId?: string;
  accountPlanName?: string;
  supplier?: string;
  expenseId?: string;
  competenceDate?: Date | null;
  dueDate?: Date | null;
  direction: "in" | "out";
  status: "realized" | "forecast";
  /** Em reais, como em `formatCurrency`. */
  amount: number;
};

export type MovementFilter = "all" | "in" | "out" | "unlinked";

const pad = (value: number) => String(value).padStart(2, "0");
/** Data local do movimento, no formato AAAA-MM-DD. */
export const movementDay = (movement: Pick<CashMovement, "date">) => `${movement.date.getFullYear()}-${pad(movement.date.getMonth() + 1)}-${pad(movement.date.getDate())}`;

/** Saída do banco que ainda não tem despesa vinculada. */
export const isUnlinkedOutflow = (movement: CashMovement) => movement.direction === "out" && !movement.expenseId;

export function movementsInRange(movements: CashMovement[], range: StudyRange, accountId = "all") {
  return movements.filter(movement => {
    const day = movementDay(movement);
    return movement.status === "realized" && day >= range.from && day <= range.to && (accountId === "all" || movement.accountId === accountId);
  });
}

export function matchesMovementFilter(movement: CashMovement, filter: MovementFilter) {
  if (filter === "all") return true;
  if (filter === "unlinked") return isUnlinkedOutflow(movement);
  return movement.direction === filter;
}

export function summarizeMovements(movements: CashMovement[]) {
  const sum = (list: CashMovement[]) => list.reduce((total, movement) => total + movement.amount, 0);
  const incoming = movements.filter(movement => movement.direction === "in");
  const outgoing = movements.filter(movement => movement.direction === "out");
  const unlinked = movements.filter(isUnlinkedOutflow);
  return {
    count: movements.length, inCount: incoming.length, outCount: outgoing.length,
    inAmount: sum(incoming), outAmount: sum(outgoing), resultAmount: sum(incoming) - sum(outgoing),
    unlinkedCount: unlinked.length, unlinkedAmount: sum(unlinked),
  };
}

export type MovementGroup = { key: string; start: string; end: string; weekStart: string | null; month: string | null; movements: CashMovement[]; inAmount: number; outAmount: number };

/** Grupos do mais recente para o mais antigo; dentro do grupo, o mais recente primeiro. */
export function groupMovements(movements: CashMovement[], range: StudyRange, granularity: Granularity): MovementGroup[] {
  return periodBounds(range, granularity).map(bound => {
    const list = movements.filter(movement => { const day = movementDay(movement); return day >= bound.start && day <= bound.end; })
      .sort((a, b) => b.date.getTime() - a.date.getTime() || a.id.localeCompare(b.id));
    const sum = (direction: "in" | "out") => list.filter(movement => movement.direction === direction).reduce((total, movement) => total + movement.amount, 0);
    return { key: bound.start, ...bound, movements: list, inAmount: sum("in"), outAmount: sum("out") };
  }).reverse();
}

export type PastPreset = "current_month" | "last_month" | "last_3_months" | "last_6_months" | "custom";
export const PAST_PRESETS: Array<{ value: Exclude<PastPreset, "custom">; label: string }> = [
  { value: "current_month", label: "Mês atual" }, { value: "last_month", label: "Mês passado" }, { value: "last_3_months", label: "Últimos 3 meses" }, { value: "last_6_months", label: "Últimos 6 meses" },
];

/** Os períodos passados terminam hoje (mês atual e atalhos que o incluem) ou no fim do mês passado. */
export function pastPresetRange(preset: Exclude<PastPreset, "custom">, today: string): StudyRange {
  const month = today.slice(0, 7);
  if (preset === "current_month") return { from: `${month}-01`, to: today };
  if (preset === "last_month") return { from: `${addMonths(month, -1)}-01`, to: monthEnd(addMonths(month, -1)) };
  return { from: `${addMonths(month, preset === "last_3_months" ? -2 : -5)}-01`, to: today };
}

export function autoPastGranularity(range: StudyRange): Granularity {
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days <= 35) return "day";
  return days <= 120 ? "week" : "month";
}
