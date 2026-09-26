import type { FinancialBudgetProject, ProjectCashPlan, ProjectCashStageSummary } from "./types";
import type { BudgetExpense } from "../lib/budget-consumption";
import { calculateProjectBudgetConsumption } from "../lib/budget-project-consumption";
import { BudgetDomainError } from "./errors";
import type { ProjectCashProjection } from "./projection-view";

const dayMs = 86_400_000;
const stamp = (day: string) => Date.parse(`${day}T12:00:00Z`);
const dateKey = (value: number) => new Date(value).toISOString().slice(0, 10);
export function projectDateRange(project: Pick<FinancialBudgetProject, "startMonth" | "endMonth" | "startDate" | "endDate">) {
  const [year, month] = project.endMonth.split("-").map(Number);
  return { startDate: project.startDate ?? `${project.startMonth}-01`,
    endDate: project.endDate ?? new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10) };
}

/** Cumulative integer allocation preserves every cent and the original, fixed daily reference. */
export function spreadProjectAmount(amountCents: number, startDate: string, endDate: string) {
  const first = stamp(startDate), last = stamp(endDate);
  const days = Math.round((last - first) / dayMs) + 1;
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isFinite(days) || days < 1 || days > 732) {
    throw new BudgetDomainError("Confira o valor e o período (máximo de dois anos). ");
  }
  return Array.from({ length: days }, (_, index) => ({ date: dateKey(first + index * dayMs),
    amountCents: Math.floor(amountCents * (index + 1) / days) - Math.floor(amountCents * index / days) }));
}

export function materializeProjectCashPlan(project: Pick<FinancialBudgetProject, "startMonth" | "endMonth" | "startDate" | "endDate" | "budgetedAmountCents">,
  input: ProjectCashPlan): ProjectCashPlan {
  const range = projectDateRange(project);
  const days = spreadProjectAmount(project.budgetedAmountCents, range.startDate, range.endDate);
  if (input.mode === "uniform") {
    const stages: ProjectCashPlan["stages"] = [];
    for (const day of days) {
      const id = `month-${day.date.slice(0, 7)}`;
      const existing = stages.at(-1);
      if (existing?.id === id) { existing.endDate = day.date; existing.amountCents += day.amountCents; }
      else stages.push({ id, name: `Previsão ${day.date.slice(0, 7)}`, startDate: day.date, endDate: day.date, amountCents: day.amountCents });
    }
    return { mode: "uniform", stages };
  }
  if (!input.stages.length || input.stages.length > 36 || new Set(input.stages.map((stage) => stage.id)).size !== input.stages.length
    || input.stages.some((stage) => stage.startDate !== stage.endDate || stage.startDate < range.startDate || stage.endDate > range.endDate
      || !Number.isSafeInteger(stage.amountCents) || stage.amountCents < 0)
    || input.stages.reduce((sum, stage) => sum + stage.amountCents, 0) !== project.budgetedAmountCents) {
    throw new BudgetDomainError("As etapas devem estar no período e somar exatamente o limite total do projeto.");
  }
  return { mode: "custom", stages: [...input.stages].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)) };
}

export function summarizeProjectCashPlan(project: FinancialBudgetProject, expenses: BudgetExpense[]) {
  const consumption = calculateProjectBudgetConsumption(project, expenses);
  const issues = [...consumption.issues];
  const known = new Set(expenses.map((expense) => expense.id));
  const missing = project.expenseIds.some((id) => !known.has(id));
  const unassigned = project.expenseIds.some((id) => !project.cashPlan?.stages.some((s) => s.id === project.expenseStageIds?.[id]));
  if (missing) issues.push("Há despesas vinculadas não encontradas; confira antes de projetar o saldo.");
  if (project.cashPlan && unassigned) issues.push("Associe cada despesa a uma etapa antes de incluir o projeto no fluxo.");
  const invalid = missing || unassigned || consumption.issues.some((issue) => project.periodMode !== "date_range" || !issue.includes("fora do período"));
  const stages: ProjectCashStageSummary[] = (project.cashPlan?.stages ?? []).map((stage) => {
    const matching = consumption.expenses.filter((expense) => project.expenseStageIds?.[expense.id] === stage.id);
    const committedAmountCents = matching.reduce((sum, expense) => sum + expense.amountCents, 0);
    // Payment status is deliberately absent: paying a bill must not consume the estimate twice.
    const evidence = JSON.stringify({ stage: { id: stage.id, startDate: stage.startDate, endDate: stage.endDate, amountCents: stage.amountCents },
      expenses: matching.map(({ id, amountCents, competenceMonth }) => ({ id, amountCents, competenceMonth }))
        .sort((a, b) => a.id.localeCompare(b.id)) });
    const closure = project.stageClosures?.find((entry) => entry.stageId === stage.id);
    const closed = Boolean(closure && closure.evidence === evidence);
    const requiresReview = Boolean(closure && !closed);
    if (requiresReview) issues.push(`A etapa ${stage.name} mudou após a conferência. Revise o encerramento.`);
    return { ...stage, committedAmountCents, evidence, closed, requiresReview,
      residualAmountCents: closed || invalid ? 0 : Math.max(0, stage.amountCents - committedAmountCents) };
  });
  return { stages, issues, blocked: invalid };
}

export function buildProjectCashProjections(project: FinancialBudgetProject, expenses: BudgetExpense[],
  range: { from: string; to: string; today: string }) {
  const summary = summarizeProjectCashPlan(project, expenses);
  const rows: ProjectCashProjection[] = [];
  if (!project.active || !project.cashPlan || summary.blocked) return { rows, issues: summary.issues };
  for (const stage of summary.stages) {
    for (const day of spreadProjectAmount(stage.residualAmountCents, stage.startDate, stage.endDate)) {
      // Overdue expectations remain visible today, flagged; the saved reference is never rewritten.
      const date = day.date < range.today ? range.today : day.date;
      if (!day.amountCents || date < range.from || date > range.to) continue;
      rows.push({ id: `${project.id}:${stage.id}:${day.date}`, projectId: project.id,
        accountPlanIds: project.accountPlanIds,
        description: `${project.name} · ${stage.name}`, date, amountCents: day.amountCents,
        requiresReview: stage.requiresReview || day.date < range.today });
    }
  }
  return { rows, issues: summary.issues };
}
