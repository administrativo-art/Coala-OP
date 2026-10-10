import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/observability/app-error";
import { financialExpenseCompetenceMonth } from "../lib/expense-accounting-contract";
import type { CashClosure, CashClosureCashMovement, CashClosureLine } from "./types";
import type { SourceSettlement } from "../lib/source-settlement";

export const MAX_WITHDRAWALS = 100;
export const withdrawalDocumentIdSchema = z.string().min(1).max(200).regex(/^[^/]+$/).refine(v => v !== "." && v !== "..");
const sourceId = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(3).max(500);
export const withdrawalClassificationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), sourceId, fingerprint: sourceId,
    accountPlanId: withdrawalDocumentIdSchema, resultCenterId: withdrawalDocumentIdSchema,
    description: z.string().trim().min(3).max(240), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("link"), sourceId, fingerprint: sourceId,
    existingExpenseId: withdrawalDocumentIdSchema, reason: reason.optional() }).strict(),
  z.object({ action: z.literal("unlink"), sourceId, reason }).strict(),
]);
export type WithdrawalClassificationInput = z.infer<typeof withdrawalClassificationSchema>;
export type WithdrawalSource = SourceSettlement & {
  kind: "cash_withdrawal"; closureId: string; operatorId: string; lineId: string;
  movementId: string; occurredAt: string; identityVerified: boolean;
};
export type WithdrawalClassification = {
  source: WithdrawalSource;
  expenseId: string;
  accountPlanId: string;
  accountPlanName: string;
  resultCenterId: string;
  resultCenterName: string;
  description: string;
  createdExpense: boolean;
  /** Troco devolvido ao caixa por suprimento: a despesa quitada é a sangria menos este valor. */
  changeReturnedCents?: number;
  active: boolean;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  // These internal snapshots are never returned by GET.
  expenseGuard: string;
  previousFields: Record<string, unknown>;
  previousMissingFields: string[];
};

export function withdrawalFailure(code: string, safeMessage: string, kind: "CONFLICT" | "VALIDATION" | "AUTHORIZATION" | "NOT_FOUND" = "CONFLICT"): never {
  throw new AppError({ code: `CASH_WITHDRAWAL_${code}`, kind, safeMessage });
}

export function withdrawalHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function eligibleMovement(movement: CashClosureCashMovement) {
  return movement.kind === "withdrawal" && movement.isCash && !movement.cancelled && movement.amountCents > 0;
}

/** Same identity for the closure and for the live PDV list shown in the app. */
export function withdrawalSourceId(scope: { workspaceId: string; unitId: string; pdvFilialId: string }, movementId: string) {
  return withdrawalHash(["cash_withdrawal", scope.workspaceId, scope.unitId, scope.pdvFilialId, movementId]);
}

export function withdrawalSources(closure: CashClosure, lines: CashClosureLine[]) {
  const sources: WithdrawalSource[] = [];
  const issues: string[] = [];
  if ((closure.source.unassignedMovementCount ?? 0) > 0) issues.push("unassigned_movements");
  const seen = new Set<string>();
  for (const line of lines.filter(row => row.channel === "cash" && !row.pdvSourceMissing)) {
    const movements = (line.metadata.cashMovements ?? []).filter(eligibleMovement);
    const total = movements.reduce((sum, item) => sum + item.amountCents, 0);
    if (!Number.isSafeInteger(total) || total !== (line.metadata.withdrawalCents ?? 0)) issues.push("movement_total_mismatch");
    for (const movement of movements) {
      // Legacy rows were stored without identity provenance. Require a resync;
      // an index fallback is never an idempotency key for money.
      const identityVerified = movement.identitySource === "provider";
      if (!Number.isSafeInteger(movement.amountCents) || movement.operatorId !== line.operatorId
        || movement.date !== closure.date || !movement.id) issues.push("movement_scope_invalid");
      const id = withdrawalSourceId({ workspaceId: closure.workspaceId, unitId: closure.kioskId, pdvFilialId: closure.pdvFilialId }, movement.id);
      if (seen.has(id)) issues.push("duplicate_movement_identity");
      seen.add(id);
      sources.push({ version: 1, kind: "cash_withdrawal", sourceId: id,
        fingerprint: withdrawalHash([id, closure.id, movement.operatorId, movement.amountCents, movement.date, movement.occurredAt, movement.terminalId, movement.paymentMethodId]),
        workspaceId: closure.workspaceId, unitId: closure.kioskId, closureId: closure.id,
        operatorId: line.operatorId, lineId: line.id, movementId: movement.id,
        amountCents: movement.amountCents, competenceMonth: closure.date.slice(0, 7), settledOn: closure.date,
        occurredAt: movement.occurredAt, identityVerified });
    }
  }
  if (sources.length > MAX_WITHDRAWALS) issues.push("withdrawal_limit");
  return { sources, issues: [...new Set(issues)] };
}

export function assertWithdrawalSourceIntegrity(result: ReturnType<typeof withdrawalSources>) {
  if (result.issues.length) withdrawalFailure("SOURCE_INCOMPLETE", "As sangrias do PDV precisam de conferência: há movimento sem operador, repetido ou total divergente. Sincronize e corrija a origem.");
}

/**
 * Troco de uma compra que o operador vinculou a esta sangria no aplicativo: a nota
 * custou menos que o dinheiro retirado e a diferença precisa ter voltado ao caixa.
 */
export function preLinkedChangeCents(expense: Record<string, any>, source: WithdrawalSource) {
  if (expense.originModule !== "local_purchase" || expense.localPurchaseWithdrawalSourceId !== source.sourceId) return 0;
  const totalCents = Math.round(Number(expense.totalValue) * 100);
  return Number.isSafeInteger(totalCents) && totalCents > 0 && totalCents < source.amountCents ? source.amountCents - totalCents : 0;
}

/**
 * O PDV não liga um suprimento a uma sangria, então a prova do troco é por dia e valor:
 * cada troco já aceito no fechamento consome um suprimento em dinheiro daquele valor.
 */
export function changeReturnIsProven(lines: CashClosureLine[], closureDate: string, changeCents: number, alreadyAccepted: number) {
  const supplies = lines.flatMap(line => line.metadata.cashMovements ?? [])
    .filter(movement => movement.kind === "supply" && !movement.cancelled && movement.date === closureDate && movement.amountCents === changeCents);
  return supplies.length > alreadyAccepted;
}

export function assertEligibleWithdrawalExpense(expense: Record<string, any>, source: WithdrawalSource, configuredWorkspaceId?: string, changeReturnedCents = 0) {
  const settledCents = source.amountCents - changeReturnedCents;
  if (changeReturnedCents !== 0 && changeReturnedCents !== preLinkedChangeCents(expense, source)) {
    withdrawalFailure("EXPENSE_AMOUNT_MONTH", "Somente a compra vinculada a esta sangria no aplicativo pode ser conciliada com troco.");
  }
  if ((expense.workspaceId ?? configuredWorkspaceId) !== source.workspaceId
    || (expense.kioskId && expense.kioskId !== source.unitId)
    || (expense.unitId && expense.unitId !== source.unitId)) withdrawalFailure("EXPENSE_SCOPE", "A despesa não pertence ao workspace/unidade desta sangria.");
  if (financialExpenseCompetenceMonth(expense) !== source.competenceMonth
    || !Number.isFinite(expense.totalValue) || Math.round(expense.totalValue * 100) !== settledCents) {
    withdrawalFailure("EXPENSE_AMOUNT_MONTH", "Escolha uma despesa com o mesmo valor e competência da sangria.");
  }
  // The operator may pre-link the purchase to one sangria in the app; that choice replaces the same-day heuristic.
  const preLinkedSourceId = expense.originModule === "local_purchase" ? expense.localPurchaseWithdrawalSourceId : undefined;
  if (preLinkedSourceId && preLinkedSourceId !== source.sourceId) {
    withdrawalFailure("EXPENSE_PRELINKED", "Esta compra local foi pré-vinculada a outra sangria pelo aplicativo.");
  }
  if (expense.originModule === "local_purchase"
    && (expense.localPurchaseFundingSource !== "cash_withdrawal" || !preLinkedSourceId && expense.localPurchaseDate !== source.settledOn)) {
    withdrawalFailure("EXPENSE_DATE", "A compra local precisa estar marcada como sangria e ter a mesma data do movimento.");
  }
  if (expense.status !== "pending" || expense.provisionType === "forecast" || expense.budgetMigration
    || expense.sourceSettlement || expense.paymentState && expense.paymentState !== "open"
    || expense.paidAt || expense.linkedBankTransactionId || expense.bankTransactionId
    || expense.paymentRequestId || expense.financialPaymentRequestId || expense.paymentId
    || expense.settlementSummary || expense.financialInboxMessageId || expense.reconciledProvisionId
    || expense.cardStatementId || expense.cardId || expense.latestCardStatementObligationId
    || expense.paymentMethod !== "single" || (expense.installments?.length ?? 0) > 1
    || expense.hasAccountAllocations || (expense.accountAllocations?.length ?? 0) > 0
    || expense.hasPersonAllocations || (expense.personAllocations?.length ?? 0) > 0
    || expense.isApportioned || (expense.apportionments?.length ?? 0) > 0
    || expense.plannedBankAccountId || expense.plannedPaymentMethodType && expense.plannedPaymentMethodType !== "cash"
    || expense.originModule && !["manual", "local_purchase"].includes(expense.originModule)) {
    withdrawalFailure("EXPENSE_INELIGIBLE", "Vincule apenas despesa avulsa em aberto, sem rateio, previsão, cartão ou outro pagamento/vínculo. Não é possível transformar pagamento bancário em sangria.");
  }
  const installment = expense.installments?.[0];
  if (installment && (installment.status !== "pending" || installment.number !== 1
    || !Number.isFinite(installment.value) || Math.round(installment.value * 100) !== settledCents
    || installment.paidAt || installment.paymentRequestId || installment.paymentId || installment.financialInboxMessageId
    || installment.linkedBankTransactionId || installment.settlementSummary
    || sourceExpenseGuard({ dueDate: installment.dueDate }) !== sourceExpenseGuard({ dueDate: expense.dueDate }))) {
    withdrawalFailure("INSTALLMENT_INELIGIBLE", "A parcela única precisa estar em aberto, com o mesmo valor e vencimento da despesa, sem outro pagamento.");
  }
}

export const SOURCE_EXPENSE_MUTABLE_PRESENTATION_FIELDS = ["notes", "attachments", "attachmentUrls", "updatedAt", "updatedBy"] as const;

/** Stable across Firestore key order/Timestamps, but detects any financial edit. */
export function sourceExpenseGuard(expense: Record<string, unknown>) {
  function canonical(value: any): any {
    if (value?.toDate instanceof Function) return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  }
  return withdrawalHash(canonical(Object.fromEntries(Object.entries(expense).filter(([key]) =>
    !SOURCE_EXPENSE_MUTABLE_PRESENTATION_FIELDS.includes(key as typeof SOURCE_EXPENSE_MUTABLE_PRESENTATION_FIELDS[number])))));
}
