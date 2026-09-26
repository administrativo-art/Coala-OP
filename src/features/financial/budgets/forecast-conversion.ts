import { z } from "zod";
import { budgetIdSchema } from "./schemas";
import { financialCompetenceMonthSchema, financialExpenseCompetenceMonth } from "../lib/expense-accounting-contract";
import { financialDateKey } from "../lib/financial-dates";
import { personAllocationsAreValid } from "../lib/expense-person-allocations";
import { budgetForecastEmployeeId } from "./composition";
import { BudgetDomainError } from "./errors";
import type { BudgetExpense } from "../lib/budget-consumption";

export const forecastConversionSchema = z.object({
  month: financialCompetenceMonthSchema,
  mappings: z.array(z.object({ expenseId: budgetIdSchema,
    destinations: z.array(z.object({ budgetId: budgetIdSchema, lineId: budgetIdSchema })).min(1).max(10),
  })).min(1).max(20),
  reason: z.string().trim().min(5).max(500),
}).superRefine((input, context) => {
  const destinations = input.mappings.flatMap((mapping) => mapping.destinations.map((target) => JSON.stringify([target.budgetId, target.lineId])));
  if (new Set(input.mappings.map((mapping) => mapping.expenseId)).size !== input.mappings.length || new Set(destinations).size !== destinations.length || destinations.length > 100) {
    context.addIssue({ code: "custom", message: "Não repita origem ou destino; limite de 100 linhas." });
  }
});
export type ForecastConversionInput = z.infer<typeof forecastConversionSchema>;
export type ForecastConversionCandidate = { id: string; description: string; employeeId: string; accountPlanId: string; amountCents: number; expectedPurchaseDate: string; resultCenterId: string | null };

export function forecastConversionCandidate(expense: BudgetExpense & Record<string, any>, month: string): ForecastConversionCandidate {
  const employeeId = budgetForecastEmployeeId(expense);
  const amountCents = Math.round(Number(expense.totalValue) * 100);
  // A civil date is not a UTC instant: parsing it with Date would move it back a day in Belém.
  const date = typeof expense.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expense.dueDate)
    ? expense.dueDate : financialDateKey(expense.dueDate);
  const dateInstant = date ? new Date(`${date}T12:00:00Z`) : null;
  const validDate = dateInstant && !Number.isNaN(dateInstant.getTime()) && dateInstant.toISOString().slice(0, 10) === date;
  const seriesPerson = expense.provisionSeriesKey?.match(/^recurring:vale-transporte:([^:]+)$/)?.[1];
  if (!employeeId || !expense.provisionSeriesKey?.startsWith("recurring:vale-transporte:")
    || expense.provisionType !== "forecast" || expense.status !== "provisioned"
    || financialExpenseCompetenceMonth(expense) !== month || !Number.isSafeInteger(amountCents) || amountCents <= 0 || !date
    || !validDate || seriesPerson !== employeeId || expense.employeeUserId && expense.employeeUserId !== employeeId
    || !expense.accountId && !expense.accountPlan || expense.hasAccountAllocations || expense.isApportioned
    || !personAllocationsAreValid(expense) || expense.hasPersonAllocations && expense.personAllocations?.some((part) => part.employeeId !== employeeId)) {
    throw new BudgetDomainError("A origem não é uma previsão simples de VT aberta e válida para a competência.");
  }
  for (const field of ["budgetMigration", "paidAt", "paymentRequestId", "bankTransactionId", "linkedBankTransactionId", "replacedByExpenseId", "reconciledProvisionId", "financialInboxMessageId", "boletoAttachment", "cardStatementId", "documentIdentity", "fiscalIdentity", "documentUrl", "sourceDocumentSha256", "purchaseOrderId"]) {
    if (expense[field]) throw new BudgetDomainError("A previsão tem histórico/documento financeiro e exige revisão individual.");
  }
  const summary = expense.settlementSummary ?? {};
  if (Array.isArray(expense.attachments) && expense.attachments.length > 0 || expense.paymentState && !["provisioned", "pending", "open", "unpaid"].includes(expense.paymentState)
    || ["paid", "partially_paid"].includes(expense.status!) || expense.provisionReconciliationStatus === "reconciled"
    || ["cashPaidAmountCents", "principalSettledAmountCents", "confirmedCashAmountCents", "reportedCashAmountCents", "settlementCreditsAmountCents", "unclassifiedDifferenceAmountCents"].some((key) => Number(summary[key] ?? 0) !== 0)
    || summary.actualAmountCents != null || summary.reconciliationStatus === "MATCHED" || expense.reconciliationStatus === "MATCHED"
    || summary.paymentEvidenceStatus && summary.paymentEvidenceStatus !== "NONE"
    || (expense.installments ?? []).some((part: Record<string, any>) => part.paidAt || part.paymentRequestId || part.linkedBankTransactionId || !["pending", "provisioned"].includes(part.status))) {
    throw new BudgetDomainError("Há liquidação, conciliação ou parcela incompatível; conversão bloqueada.");
  }
  return { id: expense.id, description: expense.description ?? "Previsão de VT", employeeId,
    accountPlanId: (expense.accountId ?? expense.accountPlan)!, amountCents, expectedPurchaseDate: date, resultCenterId: expense.resultCenter ?? null };
}
