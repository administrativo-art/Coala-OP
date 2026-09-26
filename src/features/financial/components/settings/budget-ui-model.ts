import type { BudgetPersonLine, BudgetPersonSummary, BudgetRulePersonLine } from "@/features/financial/budgets/types";
import { canAccessUnit, resolveUnitAccess, type UnitAccessUser } from "@/lib/unit-access";

export type BudgetAccountOption = { id: string; name: string };
export type BudgetPersonOption = { id: string; name: string };
export type BudgetCenterOption = { id: string; name: string; active?: boolean; unitIds?: string[] };
export type BudgetLineDraft = BudgetPersonLine & { purchaseDay: number; purchaseMonthOffset: -1 | 0 };
export type CoverageChoice = "partial" | "final" | "not_required";

export function allowedBudgetCenters(centers: BudgetCenterOption[], user: UnitAccessUser, isDefaultAdmin: boolean) {
  return centers.filter((center) => resolveUnitAccess(user, { isDefaultAdmin }).allUnits
    || Boolean(center.unitIds?.length && center.unitIds.every((id) => canAccessUnit(user, id, { isDefaultAdmin }))));
}

export function budgetScopeQuery(resultCenterId: string) {
  return resultCenterId ? `&resultCenterId=${encodeURIComponent(resultCenterId)}` : "";
}

export function compositionTotal(lines: Array<{ amountCents: number }>) {
  return lines.reduce((total, line) => total + line.amountCents, 0);
}

/** Presentation only. The server resolves and persists the monthly snapshot. */
export function purchaseDatePreview(month: string, day: number, offset: -1 | 0) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(day) || day < 1 || day > 31) return "";
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber + offset, 0));
  lastDay.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return lastDay.toISOString().slice(0, 10);
}

export function draftFromSnapshot(line: BudgetPersonLine): BudgetLineDraft {
  return { ...line, purchaseDay: Number(line.expectedPurchaseDate.slice(8, 10)), purchaseMonthOffset: 0 };
}

export function manualComposition(lines: BudgetLineDraft[]) {
  return lines.map(({ id, employeeId, accountPlanId, amountCents, expectedPurchaseDate, estimateSource }) =>
    ({ id, employeeId, accountPlanId, amountCents, expectedPurchaseDate, estimateSource }));
}

export function ruleComposition(lines: BudgetLineDraft[]): Omit<BudgetRulePersonLine, "employeeName">[] {
  return lines.map(({ id, employeeId, accountPlanId, amountCents, purchaseDay, purchaseMonthOffset }) =>
    ({ id, employeeId, accountPlanId, amountCents, purchaseDay, purchaseMonthOffset }));
}

export function canDispensePurchase(line: Pick<BudgetPersonSummary, "committedAmountCents" | "documentIds">) {
  return line.committedAmountCents === 0 && line.documentIds.length === 0;
}

export function coveragePayload(line: BudgetPersonSummary, state: CoverageChoice, reason: string, confirmed: boolean, residualAmountCents?: number) {
  if (!confirmed || reason.trim().length < 5 || reason.trim().length > 500) throw new Error("Informe o motivo e confirme a conferência.");
  if (state === "not_required" && !canDispensePurchase(line)) throw new Error("Só é possível dispensar compra sem comprometimento e sem documentos.");
  if (state !== "not_required" && (line.documentIds.length === 0 || line.documentIds.length > 20)) {
    throw new Error("A cobertura exige de 1 a 20 documentos de suporte. Atualize a apuração.");
  }
  if (state === "partial" && residualAmountCents !== undefined
    && (!Number.isSafeInteger(residualAmountCents) || residualAmountCents < 0 || residualAmountCents > 100_000_000_000)) {
    throw new Error("Informe um valor válido para a compra ainda esperada.");
  }
  return { lineId: line.id, state, documentIds: state === "not_required" ? [] : [...line.documentIds],
    documentFingerprints: { ...((line as BudgetPersonSummary & { documentFingerprints?: Record<string, string> }).documentFingerprints ?? {}) },
    ...(state !== "partial" ? { residualAmountCents: 0 } : residualAmountCents === undefined ? {} : { residualAmountCents }),
    reason: reason.trim(), confirmed: true as const };
}

export function revisedComposition(lines: BudgetLineDraft[], previous: BudgetPersonLine[]) {
  return manualComposition(lines).map((line) => {
    const original = previous.find((item) => item.employeeId === line.employeeId && item.accountPlanId === line.accountPlanId);
    return { ...line, id: original?.id ?? line.id, estimateSource: "manual" as const };
  });
}
