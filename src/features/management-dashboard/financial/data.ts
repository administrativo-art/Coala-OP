import { addDays, endOfDay, endOfMonth, format, isBefore, startOfDay, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

import { expenseValueForResultCenter } from "@/features/financial/lib/expense-rateio";
import { toDate } from "@/features/financial/lib/utils";

type Row = Record<string, any>;

export type ExpenseRow = { id: string; description: string; supplier: string; dueDay: string; dueLabel: string; value: number; daysLabel: string; overdue: boolean };
export type ExpenseGroup = { count: number; total: number; rows: ExpenseRow[] };
export type RankingRow = { label: string; value: number; share: number };
export type ForecastBucket = { label: string; total: number; count: number; overdue?: boolean };
export type AccountBalance = { id: string; name: string; balance: number };

export type FinancialDashboardData = {
  monthLabel: string;
  overdue: ExpenseGroup;
  dueWeek: ExpenseGroup;
  pendingAudit: ExpenseGroup;
  competence: { provisioned: number; paid: number; open: number; count: number; paidShare: number };
  cashMonth: { income: number; outcome: number; net: number; previousIncome: number; previousOutcome: number };
  forecast: ForecastBucket[];
  topCategories: RankingRow[];
  topSuppliers: RankingRow[];
  units: RankingRow[];
  bankAccounts: AccountBalance[];
};

const OPEN_STATUSES = ["pending", "partially_paid"];
const EXCLUDED_ECONOMIC = ["draft", "cancelled", "reconciled"];

/** Quanto ainda falta pagar: o saldo de uma baixa parcial, ou o valor cheio. */
export function outstandingValue(expense: Row) {
  if (expense.status === "partially_paid" && expense.settlementSummary?.balanceAmountCents != null) {
    return Number(expense.settlementSummary.balanceAmountCents) / 100;
  }
  return Number(expense.totalValue) || 0;
}

function isPendingAudit(expense: Row) {
  return OPEN_STATUSES.includes(expense.status) && expense.originModule === "purchasing" && expense.originStatus === "pending_audit";
}

function isOverdue(expense: Row, today: Date) {
  if (!OPEN_STATUSES.includes(expense.status) || isPendingAudit(expense)) return false;
  const due = toDate(expense.dueDate);
  return !!due && isBefore(due, today);
}

function daysBetween(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

function daysLabel(due: Date | null, today: Date) {
  if (!due) return "Sem vencimento";
  const diff = daysBetween(today, due);
  if (diff < 0) return `${Math.abs(diff)} dia(s) em atraso`;
  if (diff === 0) return "Vence hoje";
  if (diff === 1) return "Vence amanhã";
  return `Vence em ${diff} dias`;
}

function toRow(expense: Row, today: Date): ExpenseRow {
  const due = toDate(expense.dueDate);
  return {
    id: String(expense.id),
    description: expense.description || "Despesa sem descrição",
    supplier: expense.supplier || "Favorecido não informado",
    dueDay: due ? format(due, "dd") : "--",
    dueLabel: due ? format(due, "MMM", { locale: ptBR }) : "",
    value: outstandingValue(expense),
    daysLabel: daysLabel(due, today),
    overdue: !!due && isBefore(due, today),
  };
}

function group(expenses: Row[], today: Date, limit = 8): ExpenseGroup {
  const sorted = [...expenses].sort((a, b) => (toDate(a.dueDate)?.getTime() ?? 0) - (toDate(b.dueDate)?.getTime() ?? 0));
  return {
    count: sorted.length,
    total: sorted.reduce((sum, expense) => sum + outstandingValue(expense), 0),
    rows: sorted.slice(0, limit).map((expense) => toRow(expense, today)),
  };
}

function ranking(entries: Map<string, number>, limit = 6): RankingRow[] {
  const total = [...entries.values()].reduce((sum, value) => sum + value, 0);
  return [...entries.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, value]) => ({ label, value, share: total > 0 ? value / total : 0 }));
}

function inRange(value: unknown, from: Date, to: Date) {
  const date = toDate(value);
  return !!date && date >= from && date <= to;
}

function isRealizedTransaction(transaction: Row) {
  return transaction.reversed !== true && transaction.auditStatus !== "reversed";
}

export type BuildInput = {
  expenses: Row[];
  transactions: Row[];
  bankAccounts: Row[];
  accountPlans: Row[];
  unitNames: string[];
  now?: Date;
};

export function buildFinancialDashboard({ expenses, transactions, bankAccounts, accountPlans, unitNames, now = new Date() }: BuildInput): FinancialDashboardData {
  const today = startOfDay(now);
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const previousStart = startOfMonth(subMonths(today, 1));
  const previousEnd = endOfMonth(subMonths(today, 1));
  const planNames = new Map<string, string>(accountPlans.map((plan) => [String(plan.id), String(plan.name ?? plan.id)]));

  const open = expenses.filter((expense) => OPEN_STATUSES.includes(expense.status));
  const overdue = open.filter((expense) => isOverdue(expense, today));
  const weekEnd = endOfDay(addDays(today, 7));
  const dueWeek = open.filter((expense) => {
    if (isPendingAudit(expense)) return false;
    const due = toDate(expense.dueDate);
    return !!due && due >= today && due <= weekEnd;
  });
  const pendingAudit = expenses.filter(isPendingAudit);

  const competenceExpenses = expenses.filter((expense) =>
    expense.provisionType !== "forecast" &&
    !EXCLUDED_ECONOMIC.includes(expense.status) &&
    inRange(expense.competenceDate, monthStart, monthEnd));
  const provisioned = competenceExpenses.reduce((sum, expense) => sum + (Number(expense.totalValue) || 0), 0);
  const paid = competenceExpenses.filter((expense) => expense.status === "paid").reduce((sum, expense) => sum + (Number(expense.totalValue) || 0), 0);
  const competence = {
    provisioned,
    paid,
    open: Math.max(0, provisioned - paid),
    count: competenceExpenses.length,
    paidShare: provisioned > 0 ? paid / provisioned : 0,
  };

  const flow = (from: Date, to: Date, direction: "in" | "out") => transactions
    .filter((transaction) =>
      isRealizedTransaction(transaction) &&
      transaction.direction === direction &&
      !["transfer_in", "transfer_out"].includes(transaction.type) &&
      inRange(transaction.date, from, to))
    .reduce((sum, transaction) => sum + (Number(transaction.amount) || 0), 0);
  const income = flow(monthStart, monthEnd, "in");
  const outcome = flow(monthStart, monthEnd, "out");

  const buckets: ForecastBucket[] = [
    { label: "Vencidos", total: 0, count: 0, overdue: true },
    { label: "Esta semana", total: 0, count: 0 },
    { label: "Semana 2", total: 0, count: 0 },
    { label: "Semana 3", total: 0, count: 0 },
    { label: "Semana 4", total: 0, count: 0 },
  ];
  for (const expense of open) {
    const due = toDate(expense.dueDate);
    if (!due) continue;
    const diff = daysBetween(today, due);
    const index = diff < 0 ? 0 : diff < 28 ? 1 + Math.floor(diff / 7) : -1;
    if (index < 0) continue;
    buckets[index].total += outstandingValue(expense);
    buckets[index].count += 1;
  }

  const byCategory = new Map<string, number>();
  const bySupplier = new Map<string, number>();
  for (const expense of competenceExpenses) {
    const value = Number(expense.totalValue) || 0;
    const key = String(expense.accountId ?? expense.accountPlan ?? "");
    const category = planNames.get(key) || expense.accountPlanName || key || "Sem categoria";
    byCategory.set(category, (byCategory.get(category) ?? 0) + value);
    const supplier = expense.supplier || "Sem fornecedor";
    bySupplier.set(supplier, (bySupplier.get(supplier) ?? 0) + value);
  }

  const byUnit = new Map<string, number>();
  for (const name of unitNames) {
    const value = competenceExpenses.reduce((sum, expense) => sum + expenseValueForResultCenter(expense, name), 0);
    if (value > 0) byUnit.set(name, value);
  }

  const balances = new Map<string, number>();
  for (const transaction of transactions) {
    if (!isRealizedTransaction(transaction) || !transaction.accountId) continue;
    const amount = Number(transaction.amount) || 0;
    balances.set(transaction.accountId, (balances.get(transaction.accountId) ?? 0) + (transaction.direction === "in" ? amount : -amount));
  }

  return {
    monthLabel: format(today, "MMMM 'de' yyyy", { locale: ptBR }),
    overdue: group(overdue, today),
    dueWeek: group(dueWeek, today),
    pendingAudit: group(pendingAudit, today),
    competence,
    cashMonth: { income, outcome, net: income - outcome, previousIncome: flow(previousStart, previousEnd, "in"), previousOutcome: flow(previousStart, previousEnd, "out") },
    forecast: buckets,
    topCategories: ranking(byCategory),
    topSuppliers: ranking(bySupplier),
    units: ranking(byUnit),
    bankAccounts: bankAccounts
      .filter((account) => account.active !== false)
      .map((account) => ({ id: String(account.id), name: String(account.name ?? account.id), balance: balances.get(account.id) ?? 0 }))
      .sort((a, b) => b.balance - a.balance),
  };
}
