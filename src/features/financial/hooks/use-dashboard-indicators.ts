"use client";

import { useMemo } from "react";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { financialCollection } from "@/features/financial/lib/repositories";
import { toDate } from "@/features/financial/lib/utils";
import { useFinancialCollection } from "./use-financial-collection";

export function useFinancialDashboardIndicators() {
  const { data: expensesData, loading: expensesLoading } = useFinancialCollection<any>(
    financialCollection("expenses")
  );
  const { data: transactionsData, loading: transactionsLoading } = useFinancialCollection<any>(
    financialCollection("transactions")
  );
  const { data: paymentsData, loading: paymentsLoading } = useFinancialCollection<any>(
    financialCollection("payments")
  );

  const expenses = expensesData || [];
  const transactions = transactionsData || [];
  const payments = paymentsData || [];
  const loading = expensesLoading || transactionsLoading || paymentsLoading;

  const indicators = useMemo(() => {
    const now = startOfDay(new Date());
    const in30Days = endOfDay(addDays(now, 30));

    const outstandingValue = (expense: any) => expense.status === "partially_paid" && expense.settlementSummary?.balanceAmountCents != null
      ? Number(expense.settlementSummary.balanceAmountCents) / 100
      : Number(expense.totalValue) || 0;
    const openExpenses = expenses
      .filter((expense) => ["pending", "partially_paid"].includes(expense.status))
      .reduce((sum, expense) => sum + outstandingValue(expense), 0);

    const upcomingDue = expenses
      .filter((expense) => {
        if (!["pending", "partially_paid"].includes(expense.status)) return false;
        const due = toDate(expense.dueDate);
        return due && due >= now && due <= in30Days;
      })
      .reduce((sum, expense) => sum + outstandingValue(expense), 0);

    const totalRevenue = transactions
      .filter((transaction: any) => transaction.direction === "in" && transaction.type !== "transfer_in")
      .reduce((sum, transaction) => sum + (transaction.amount ?? 0), 0);

    const transactionExpenseIds = new Set(
      transactions
        .filter((transaction: any) => transaction.reversed !== true && transaction.auditStatus !== "reversed")
        .flatMap((transaction: any) => [transaction.expenseId, transaction.linkedExpenseId, ...(Array.isArray(transaction.splitExpenseIds) ? transaction.splitExpenseIds : [])])
        .filter(Boolean),
    );
    const totalReportedPayments = payments
      .filter((payment: any) =>
        payment.status !== "MATCHED" &&
        payment.reconciliationStatus !== "MATCHED" &&
        !payment.bankTransactionId &&
        !transactionExpenseIds.has(payment.expenseId)
      )
      .reduce((sum, payment) => sum + (payment.totalPaid ?? 0), 0);

    const totalOutgoingTransactions = transactions
      .filter((transaction: any) => transaction.direction === "out" && transaction.type !== "transfer_out" && transaction.reversed !== true && transaction.auditStatus !== "reversed")
      .reduce((sum, transaction) => sum + (transaction.amount ?? 0), 0);
    const economicExpenses = expenses
      .filter((expense) =>
        expense.provisionType !== "forecast" &&
        !["draft", "cancelled", "reconciled"].includes(expense.status)
      )
      .reduce((sum, expense) => sum + (Number(expense.totalValue) || 0), 0);

    return {
      openExpenses,
      upcomingDue,
      dre: totalRevenue - economicExpenses,
      cash: totalRevenue - totalReportedPayments - totalOutgoingTransactions,
    };
  }, [expenses, transactions, payments]);

  return { indicators, expenses, loading };
}
