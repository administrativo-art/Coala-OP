import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { serializeFinancialValue } from "../lib/server-access";
import { financialDateKey } from "../lib/financial-dates";
import { buildProjectCashProjections } from "./project-cash-plan";
import { BudgetDomainError } from "./errors";
import type { BudgetExpense } from "../lib/budget-consumption";
import type { FinancialBudgetProject } from "./types";
import type { ProjectCashProjection } from "./projection-view";

/** Caller must authorize global unit access. No polling, business writes or unbounded scans. */
export async function getProjectCashProjections(range: { from: string; to: string }, composedAccountIds: string[]) {
  const snapshots = await financialDbAdmin.collection("financialBudgetProjects").where("active", "==", true)
    .where("cashPlanningEnabled", "==", true).where("cashPlanStartDate", "<=", range.to).limit(51).get();
  if (snapshots.size > 50) throw new BudgetDomainError("Há mais de 50 projetos no planejamento. Inative os projetos concluídos.");
  const projects = snapshots.docs.map((doc) => ({ ...serializeFinancialValue(doc.data()) as FinancialBudgetProject, id: doc.id }));
  const ids = [...new Set(projects.flatMap((project) => project.expenseIds))];
  if (projects.some((project) => project.expenseIds.length > 100) || ids.length > 500) throw new BudgetDomainError("O planejamento de projetos excedeu 500 despesas. Inative os projetos concluídos.");
  const docs = ids.length ? await financialDbAdmin.getAll(...ids.map((id) => financialDbAdmin.collection("expenses").doc(id))) : [];
  const expenses = new Map(docs.filter((doc) => doc.exists).map((doc) => [doc.id, { id: doc.id, ...doc.data() } as BudgetExpense]));
  const projectProjections: ProjectCashProjection[] = [];
  const projectIssues: string[] = [];
  const accountIds = new Set<string>();
  const today = financialDateKey(new Date())!;
  for (const project of projects) {
    const summary = buildProjectCashProjections(project, project.expenseIds.flatMap((id) => expenses.has(id) ? [expenses.get(id)!] : []), { ...range, today });
    projectIssues.push(...summary.issues.map((issue) => `${project.name}: ${issue}`));
    if (summary.rows.length && project.accountPlanIds.some((id) => composedAccountIds.includes(id))) {
      projectIssues.push(`${project.name}: projeção suspensa por coexistir com planejamento por colaborador nas mesmas contas. Confira a sobreposição.`);
      continue;
    }
    summary.rows.forEach((row) => projectProjections.push(row));
    if (summary.rows.length) project.accountPlanIds.forEach((id) => accountIds.add(id));
  }
  return { projectProjections, projectIssues, projectAccountPlanIds: [...accountIds] };
}
