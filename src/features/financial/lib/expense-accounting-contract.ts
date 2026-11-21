import { z } from "zod";

import type { ExpenseAccountAllocation } from "./expense-account-allocations";
import type { CardExpenseEntry } from "./card-invoices";
import {
  cardExpenseStatementOccurrences,
  type ExpenseCardStatementDocument,
} from "./expense-card-statement-groups";
import type { ExpensePersonAllocation } from "./expense-person-allocations";
import { financialDateKey, isValidFinancialDateIso } from "./financial-dates";

export const FINANCIAL_EXPENSE_ACCOUNTING_CONTRACT_VERSION = 1;

export const financialCompetenceMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const FINANCIAL_EXPENSE_DRE_STATUSES = [
  "pending",
  "partially_paid",
  "paid",
  "provisioned",
] as const;

export const FINANCIAL_EXPENSE_DRE_EXCLUDED_STATUSES = [
  "draft",
  "cancelled",
  "reconciled",
] as const;

export type FinancialExpenseDreStatus = (typeof FINANCIAL_EXPENSE_DRE_STATUSES)[number];
export type FinancialExpenseDreExcludedStatus = (typeof FINANCIAL_EXPENSE_DRE_EXCLUDED_STATUSES)[number];

export type FinancialExpenseDreDocument = {
  id: string;
  accountingContractVersion: number;
  competenceMonth: string | null;
  status: string;
  provisionType?: string | null;
  accountPlan?: string | null;
  accountId?: string | null;
  accountPlanName?: string | null;
  totalValue: number;
  hasAccountAllocations?: boolean;
  accountAllocations?: ExpenseAccountAllocation[] | null;
  hasPersonAllocations?: boolean;
  personAllocations?: ExpensePersonAllocation[] | null;
  isApportioned?: boolean;
  resultCenter?: string | null;
  apportionments?: Array<{ resultCenter?: string; percentage?: number }> | null;
  description?: string | null;
  supplier?: string | null;
  employeeId?: string | null;
  supplierId?: string | null;
  billingIdentity?: {
    customerAccount: string | null;
    serviceNumbers: string[];
  } | null;
  cardChargeDate?: string | null;
  feeRecognition?: { estimated: boolean; incomplete: boolean } | null;
};

type ExpenseCompetenceSource = {
  competenceMonth?: unknown;
  provisionCompetence?: unknown;
  competenceDate?: unknown;
};

export const FINANCIAL_INSTALLMENT_PAYMENT_METHOD = "installments";

export type FinancialExpenseChargeSource = ExpenseCompetenceSource & Pick<CardExpenseEntry,
  "id" | "paymentMethod" | "plannedPaymentMethodType" | "plannedBankAccountId" | "plannedPaymentMethodId"
  | "cardStatementId" | "cardStatementKey" | "cardStatementMonthKey" | "dueDate" | "status"
  | "provisionType"
> & { installments?: unknown };

type BillingPeriod = {
  competenceMonth: string | null;
  dueDate: string | null;
};

type InstallmentCharge = BillingPeriod & {
  number: number;
  totalValue: number;
  status: string;
  paymentState: string;
  paymentSchedulingStatus: string;
  confirmedInStatement: boolean;
  settledCents: number;
  settlementCreditCents: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateFromUnknown(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof record(value).toDate === "function") {
    const parsed = (record(value).toDate as () => Date)();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const seconds = record(value).seconds ?? record(value)._seconds;
  if (typeof seconds === "number") {
    const parsed = new Date(seconds * 1_000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string") {
    const calendarMonth = value.match(/^(\d{4}-(?:0[1-9]|1[0-2]))(?:-|$)/)?.[1];
    if (calendarMonth) return new Date(`${calendarMonth}-01T12:00:00.000Z`);
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthFromDateValue(value: unknown) {
  if (typeof value === "string") {
    const direct = value.match(/^(\d{4}-(?:0[1-9]|1[0-2]))(?:-|$)/)?.[1];
    if (direct) return direct;
  }
  const date = dateFromUnknown(value);
  if (!date) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dateKeyFromDateValue(value: unknown) {
  if (typeof value === "string") {
    const direct = value.match(/^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?:T|$)/)?.[1];
    if (direct) return direct;
  }
  const date = dateFromUnknown(value);
  if (!date) return null;
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function normalizeBillingIdentity(value: unknown): FinancialExpenseDreDocument["billingIdentity"] {
  const identity = record(value);
  const customerAccount = text(identity.customerAccount) || null;
  const serviceNumbers = [...new Set(
    (Array.isArray(identity.serviceNumbers) ? identity.serviceNumbers : [])
      .map(text)
      .filter(Boolean),
  )].slice(0, 20);
  return customerAccount || serviceNumbers.length > 0
    ? { customerAccount, serviceNumbers }
    : null;
}

/**
 * Competência é um período contábil, não a data de vencimento nem um evento de
 * pagamento. Campos legados são interpretados em UTC para que o primeiro dia
 * à meia-noite não recue para o mês anterior no fuso de Belém.
 */
export function financialExpenseCompetenceMonth(expense: ExpenseCompetenceSource) {
  const storedMonth = text(expense.competenceMonth);
  if (financialCompetenceMonthSchema.safeParse(storedMonth).success) return storedMonth;

  const provisionMonth = text(expense.provisionCompetence);
  if (financialCompetenceMonthSchema.safeParse(provisionMonth).success) return provisionMonth;

  return monthFromDateValue(expense.competenceDate);
}

/**
 * Alguns produtores legados gravaram um dia civil à meia-noite UTC. Os demais
 * instantes são interpretados no fuso financeiro.
 */
export function financialExpenseChargeDateKey(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return isValidFinancialDateIso(value) ? value : null;
  }
  const date = typeof value === "string" ? new Date(value) : dateFromUnknown(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.getTime() % 86_400_000 === 0 ? date.toISOString().slice(0, 10) : financialDateKey(date);
}

/** Parcelas avulsas pertencem ao mês da cobrança. Cartão segue o ciclo da fatura. */
export function financialExpenseInstallmentCharges(expense: FinancialExpenseChargeSource): InstallmentCharge[] | null {
  if (expense.paymentMethod !== FINANCIAL_INSTALLMENT_PAYMENT_METHOD
    || expense.plannedPaymentMethodType === "credit_card"
    || ["draft", "cancelled", "reconciled"].includes(text(expense.status))
    || (expense.provisionType === "forecast" && expense.status !== "paid")
    || !Array.isArray(expense.installments)
    || expense.installments.length === 0) return null;

  const titleMonth = financialExpenseCompetenceMonth(expense);
  return expense.installments.flatMap((value, index) => {
    const part = record(value);
    if (part.status === "cancelled") return [];
    const number = Number(part.number);
    const dueDate = financialExpenseChargeDateKey(part.dueDate);
    const amountCents = Math.max(0, Math.round(finiteNumber(part.value) * 100));
    const status = text(part.status) || "pending";
    const settledCents = status === "paid" ? amountCents
      : Math.min(amountCents, Math.max(0, Math.round(finiteNumber(part.paidValue) * 100)));
    const settlementCreditCents = Math.min(amountCents - settledCents,
      Math.max(0, Math.round(finiteNumber(part.settlementCreditValue) * 100)));
    return [{
      number: Number.isSafeInteger(number) && number > 0 ? number : index + 1,
      competenceMonth: dueDate?.slice(0, 7) ?? titleMonth,
      dueDate,
      totalValue: amountCents / 100,
      status,
      paymentState: text(part.paymentState),
      paymentSchedulingStatus: text(part.paymentSchedulingStatus),
      confirmedInStatement: Boolean(text(part.linkedBankTransactionId)),
      settledCents,
      settlementCreditCents,
    }];
  });
}

/** Nenhuma baixa ou saldo do título é repetido nas suas parcelas. */
export function financialInstallmentDisplayFields(charge: InstallmentCharge) {
  const { status, paymentSchedulingStatus, confirmedInStatement } = charge;
  return {
    installmentNumber: charge.number,
    competenceMonth: charge.competenceMonth,
    dueDate: charge.dueDate,
    totalValue: charge.totalValue,
    status,
    paymentState: charge.paymentState,
    installments: [{ status, paymentSchedulingStatus }],
    settlementSummary: {
      balanceAmountCents: Math.round(charge.totalValue * 100) - charge.settledCents - charge.settlementCreditCents,
      principalSettledAmountCents: charge.settledCents,
      settlementCreditsAmountCents: charge.settlementCreditCents,
      paymentEvidenceStatus: confirmedInStatement ? "CONFIRMED" : null,
      reconciliationStatus: confirmedInStatement ? "MATCHED" : null,
    },
  };
}

export function financialExpenseChargePeriods(
  expense: FinancialExpenseChargeSource,
  cardStatements: ExpenseCardStatementDocument[] = [],
): BillingPeriod[] {
  const charges = financialExpenseInstallmentCharges(expense);
  if (charges) return charges;
  if (expense.plannedPaymentMethodType === "credit_card") {
    const occurrences = cardExpenseStatementOccurrences(expense as CardExpenseEntry, cardStatements);
    if (occurrences.length > 0) return occurrences.map(({ monthKey, dueDate }) => ({
      competenceMonth: monthKey,
      dueDate: financialExpenseChargeDateKey(dueDate),
    }));
  }
  return [{
    competenceMonth: financialExpenseCompetenceMonth(expense),
    dueDate: financialExpenseChargeDateKey(expense.dueDate),
  }];
}

export function financialExpenseAccountingFields(expense: ExpenseCompetenceSource) {
  return {
    accountingContractVersion: FINANCIAL_EXPENSE_ACCOUNTING_CONTRACT_VERSION,
    competenceMonth: financialExpenseCompetenceMonth(expense),
  };
}

export function financialExpenseParticipatesInDre(expense: ExpenseCompetenceSource & { status?: unknown }) {
  return FINANCIAL_EXPENSE_DRE_STATUSES.includes(String(expense.status ?? "") as FinancialExpenseDreStatus)
    && financialExpenseCompetenceMonth(expense) !== null;
}

function normalizeAccountAllocations(value: unknown): ExpenseAccountAllocation[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => {
    const item = record(entry);
    return {
      accountPlanId: text(item.accountPlanId),
      accountPlanName: text(item.accountPlanName) || null,
      amount: finiteNumber(item.amount),
    };
  });
}

function normalizePersonAllocations(value: unknown): ExpensePersonAllocation[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => {
    const item = record(entry);
    const analysisType = ["employer_cost", "employee_deduction", "informational"].includes(text(item.analysisType))
      ? text(item.analysisType) as ExpensePersonAllocation["analysisType"]
      : "informational";
    return {
      id: text(item.id) || null,
      accountPlanId: text(item.accountPlanId),
      accountPlanName: text(item.accountPlanName) || null,
      employeeId: text(item.employeeId),
      employeeName: text(item.employeeName) || null,
      analysisType,
      amount: finiteNumber(item.amount),
      resultCenter:
        text(item.resultCenterId)
        || text(item.resultCenter)
        || text(item.resultCenterName)
        || null,
      payrollDocumentId: text(item.payrollDocumentId) || null,
      contractReference: text(item.contractReference) || null,
      creditorName: text(item.creditorName) || null,
    };
  });
}

export function normalizeFinancialExpenseForDre(
  id: string,
  value: unknown,
): FinancialExpenseDreDocument {
  const expense = record(value);
  const competenceMonth = financialExpenseCompetenceMonth(expense);
  return {
    id,
    accountingContractVersion: finiteNumber(expense.accountingContractVersion)
      || FINANCIAL_EXPENSE_ACCOUNTING_CONTRACT_VERSION,
    competenceMonth,
    status: text(expense.status),
    provisionType: text(expense.provisionType) || null,
    accountPlan: text(expense.accountPlan) || null,
    accountId: text(expense.accountId) || null,
    accountPlanName: text(expense.accountPlanName) || null,
    totalValue: finiteNumber(expense.totalValue),
    hasAccountAllocations: expense.hasAccountAllocations === true,
    accountAllocations: normalizeAccountAllocations(expense.accountAllocations),
    hasPersonAllocations: expense.hasPersonAllocations === true,
    personAllocations: normalizePersonAllocations(expense.personAllocations),
    isApportioned: expense.isApportioned === true,
    resultCenter:
      text(expense.resultCenterId)
      || text(expense.resultCenter)
      || text(expense.resultCenterName)
      || null,
    apportionments: Array.isArray(expense.apportionments)
      ? expense.apportionments.map((entry) => ({
          resultCenter:
            text(record(entry).resultCenterId)
            || text(record(entry).resultCenter)
            || text(record(entry).resultCenterName),
          percentage: finiteNumber(record(entry).percentage),
        }))
      : null,
    description: text(expense.description) || null,
    supplier: text(expense.supplier) || null,
    employeeId: text(expense.employeeId) || null,
    supplierId: text(expense.supplierId) || null,
    billingIdentity: normalizeBillingIdentity(expense.billingIdentity),
    cardChargeDate: dateKeyFromDateValue(expense.cardChargeDate),
    feeRecognition: record(expense.sourceSettlement).kind === "acquirer_fee" ? { estimated: record(expense.sourceSettlement).estimated === true, incomplete: record(expense.sourceSettlement).sourceIncomplete === true } : null,
  };
}

export function financialExpenseDreWithoutPresentationDetails(
  expense: FinancialExpenseDreDocument,
): FinancialExpenseDreDocument {
  return {
    ...expense,
    description: null,
    supplier: null,
    billingIdentity: null,
    cardChargeDate: null,
  };
}
