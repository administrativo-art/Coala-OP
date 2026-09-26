import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { ServerUserContext } from "@/lib/auth-server";
import { serializeFinancialValue } from "../lib/server-access";
import { calculateBudgetConsumption, type BudgetExpense } from "../lib/budget-consumption";
import { buildBudgetResidualProjections, shiftBudgetMonth, summarizeBudgetPeople } from "./composition";
import { expensesForMonth } from "./service.server";
import { resolveBudgetCenter, resolveBudgetExpenseCenters } from "./references.server";
import { canViewBudgetPersonnel } from "./personnel-access";
import { BudgetDomainError } from "./errors";
import type { FinancialBudget } from "./types";
import type { BudgetCashProjection, BudgetCashProjectionPayload, BudgetPlanningComparison } from "./projection-view";
import { getProjectCashProjections } from "./project-projections.server";

const budgetData = (doc: FirebaseFirestore.DocumentSnapshot) => ({ ...serializeFinancialValue(doc.data()) as FinancialBudget, id: doc.id });

export function budgetPurchaseMonths(from: string, to: string) {
  const months: string[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = shiftBudgetMonth(month, 1)) {
    if (months.length === 12) throw new BudgetDomainError("Consulte até 12 meses de compras por vez.");
    months.push(month);
  }
  if (!months.length) throw new BudgetDomainError("O início deve ser anterior ao fim.");
  return months;
}

export async function getBudgetCashProjections(actor: ServerUserContext, input: { from: string; to: string; resultCenterId?: string }): Promise<BudgetCashProjectionPayload> {
  await resolveBudgetCenter(input.resultCenterId, actor, undefined, false);
  const months = budgetPurchaseMonths(input.from, input.to);
  let query = financialDbAdmin.collection("financialBudgets").where("active", "==", true).where("purchaseMonths", "array-contains-any", months);
  if (input.resultCenterId) query = query.where("resultCenterId", "==", input.resultCenterId);
  const snapshot = await query.limit(301).get();
  if (snapshot.size > 300) throw new BudgetDomainError("Há mais de 300 orçamentos neste intervalo. Selecione um centro ou reduza o período.");
  const budgets = snapshot.docs.map(budgetData);
  const competences = [...new Set(budgets.map((budget) => budget.competenceMonth))];
  if (competences.length > 13) throw new BudgetDomainError("As compras abrangem mais de 13 competências. Refine o período.");
  // One bounded read per competence, shared by every envelope and line.
  const expenses = await resolveBudgetExpenseCenters((await Promise.all(competences.map(expensesForMonth))).flat());
  const result = buildBudgetResidualProjections(budgets, expenses, input);
  const byId = new Map(budgets.map((budget) => [budget.id, budget]));
  const grouped = new Map<string, BudgetCashProjection>();
  for (const projection of result.projections) {
    const budget = byId.get(projection.budgetId)!;
    const id = JSON.stringify([budget.id, projection.accountPlanId, projection.expectedPurchaseDate]);
    const current = grouped.get(id);
    if (current) { current.amountCents += projection.amountCents; current.requiresReview ||= projection.requiresReview; }
    else grouped.set(id, { id, budgetId: budget.id,
      description: canViewBudgetPersonnel(actor) ? budget.name : "Planejamento de pessoal",
      resultCenterId: projection.resultCenterId, resultCenterName: budget.resultCenterName ?? "Centro do orçamento",
      accountPlanId: projection.accountPlanId, competenceMonth: projection.competenceMonth,
      date: projection.expectedPurchaseDate, amountCents: projection.amountCents, requiresReview: projection.requiresReview });
  }
  const projects = input.resultCenterId ? {} : await getProjectCashProjections(input, budgets.filter((budget) => budget.composition?.length).flatMap((budget) => budget.accountPlanIds));
  return { projections: [...grouped.values()], conflictCount: result.conflicts.length, issueCount: result.issues.length, ...projects };
}

/** Separate planning comparison: never fabricates payable expenses or changes DRE policy. */
export async function getBudgetPlanningComparisons(input: { periods: string[]; kioskIds: string[]; expenses: BudgetExpense[]; canViewPersonnel: boolean }): Promise<BudgetPlanningComparison[]> {
  const centersSnapshot = await financialDbAdmin.collection("resultCenters").where("unitIds", "array-contains-any", input.kioskIds).limit(101).get();
  if (centersSnapshot.size > 100) throw new BudgetDomainError("Há mais de 100 centros vinculados às unidades da DRE.");
  const centers = centersSnapshot.docs.filter((doc) => (doc.get("unitIds") as string[]).every((id) => input.kioskIds.includes(id)));
  if (!centers.length) return [];
  const budgets: FinancialBudget[] = [];
  for (const month of input.periods) {
    const monthly: FinancialBudget[] = [];
    for (let offset = 0; offset < centers.length; offset += 30) {
      const snapshot = await financialDbAdmin.collection("financialBudgets").where("competenceMonth", "==", month).where("active", "==", true)
        .where("resultCenterId", "in", centers.slice(offset, offset + 30).map((doc) => doc.id)).limit(101).get();
      monthly.push(...snapshot.docs.map(budgetData));
      if (monthly.length > 100) throw new BudgetDomainError("Há mais de 100 orçamentos na competência da DRE.");
    }
    budgets.push(...monthly.filter((budget) => budget.composition?.length));
  }
  if (!budgets.length) return [];
  const expenses = await resolveBudgetExpenseCenters(input.expenses);
  return budgets.map((budget) => {
    const actual = calculateBudgetConsumption(budget, expenses);
    const people = summarizeBudgetPeople(budget, expenses);
    const projection = buildBudgetResidualProjections([budget], expenses);
    const center = centers.find((doc) => doc.id === budget.resultCenterId)!;
    return { id: budget.id, name: input.canViewPersonnel ? budget.name : "Planejamento de pessoal", competenceMonth: budget.competenceMonth,
      resultCenterId: center.id, resultCenterName: String(center.get("name")), unitIds: center.get("unitIds") as string[],
      budgetedAmountCents: budget.budgetedAmountCents, committedAmountCents: actual.consumedAmountCents,
      balanceAmountCents: actual.balanceAmountCents, residualAmountCents: people.residualAmountCents,
      conflictCount: projection.conflicts.length, issueCount: actual.issues.length + people.issues.length };
  });
}
