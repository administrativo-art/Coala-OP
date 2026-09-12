import { z } from "zod";

import type { ExpenseAccountAllocation } from "./expense-account-allocations";
import type { ExpensePersonAllocation } from "./expense-person-allocations";

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
};

type ExpenseCompetenceSource = {
  competenceMonth?: unknown;
  provisionCompetence?: unknown;
  competenceDate?: unknown;
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
