import type { ServerUserContext } from "@/lib/auth-server";
import type { FinancialBudgetRule, FinancialBudgetSummary } from "./types";

export function canViewBudgetPersonnel(actor: Pick<ServerUserContext, "isDefaultAdmin" | "permissions">) {
  return actor.isDefaultAdmin || Boolean(actor.permissions.financial?.view && actor.permissions.financial.personnelCosts?.view);
}
export function canEditBudgetPersonnel(actor: Pick<ServerUserContext, "isDefaultAdmin" | "permissions">) {
  const financial = actor.permissions.financial;
  return actor.isDefaultAdmin || Boolean(canViewBudgetPersonnel(actor) && financial?.personnelCosts?.edit
    && financial.settings?.view && financial.settings.manageBudgets);
}

export function budgetSummaryForViewer(summary: FinancialBudgetSummary, canView: boolean): FinancialBudgetSummary {
  if (canView) return summary;
  // Allowlist: free text, snapshots and future nominal fields never escape by object spreading.
  return {
    id: summary.id, name: summary.composition?.length ? "Orçamento de pessoal" : summary.name, competenceMonth: summary.competenceMonth,
    hasComposition: Boolean(summary.hasComposition || summary.composition?.length),
    accountPlanIds: summary.accountPlanIds, budgetedAmountCents: summary.budgetedAmountCents,
    resultCenterId: summary.resultCenterId, resultCenterName: summary.resultCenterName,
    active: summary.active, source: summary.source, ruleId: summary.ruleId,
    calculationMode: summary.calculationMode, calculationSnapshot: null,
    createdBy: "", createdAt: summary.createdAt, updatedAt: summary.updatedAt,
    purchaseMonths: summary.purchaseMonths, consumedAmountCents: summary.consumedAmountCents,
    forecastCoverageAmountCents: summary.forecastCoverageAmountCents, balanceAmountCents: summary.balanceAmountCents,
    usageRatio: summary.usageRatio, curve: summary.curve,
    expenses: summary.expenses.map((expense) => ({ ...expense, description: "Despesa" })),
    issues: summary.issues.length ? ["Há pendências na apuração. Solicite conferência a um perfil autorizado."] : [],
    residualAmountCents: summary.residualAmountCents, unidentifiedAmountCents: summary.unidentifiedAmountCents,
    outsideCompositionAmountCents: summary.outsideCompositionAmountCents, personnelDetailsRedacted: true,
  };
}

export function budgetRuleForViewer(rule: FinancialBudgetRule, canView: boolean): FinancialBudgetRule {
  if (canView) return rule;
  return {
    id: rule.id, name: rule.composition?.length ? "Regra de orçamento de pessoal" : rule.name, accountPlanIds: rule.accountPlanIds,
    hasComposition: Boolean(rule.hasComposition || rule.composition?.length),
    mode: rule.mode, fixedAmountCents: rule.fixedAmountCents, averageMonths: rule.averageMonths,
    baseProductIds: rule.baseProductIds, stockKioskId: rule.stockKioskId, closingStockDays: rule.closingStockDays,
    startMonth: rule.startMonth, endMonth: rule.endMonth, generationLeadMonths: rule.generationLeadMonths,
    resultCenterId: rule.resultCenterId, resultCenterName: rule.resultCenterName,
    active: rule.active, createdBy: "", createdAt: rule.createdAt, updatedAt: rule.updatedAt,
  };
}
