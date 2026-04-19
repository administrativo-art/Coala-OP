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

    const openExpenses = expenses
      .filter((expense) => expense.status === "pending")
      .reduce((sum, expense) => sum + (expense.totalValue ?? 0), 0);

    const upcomingDue = expenses
      .filter((expense) => {
        if (expense.status !== "pending") return false;
        const due = toDate(expense.dueDate);
        return due && due >= now && due <= in30Days;
      })
      .reduce((sum, expense) => sum + (expense.totalValue ?? 0), 0);

    const totalRevenue = transactions
      .filter((transaction: any) => transaction.direction === "in" && transaction.type !== "transfer_in")
      .reduce((sum, transaction) => sum + (transaction.amount ?? 0), 0);

    const totalPaid = payments.reduce((sum, payment) => sum + (payment.totalPaid ?? 0), 0);

    const totalOutgoingTransactions = transactions
      .filter((transaction: any) => transaction.direction === "out" && transaction.type !== "transfer_out")
      .reduce((sum, transaction) => sum + (transaction.amount ?? 0), 0);

    return {
      openExpenses,
      upcomingDue,
      dre: totalRevenue - totalPaid,
      cash: totalRevenue - totalPaid - totalOutgoingTransactions,
    };
  }, [expenses, transactions, payments]);

  return { indicators, expenses, loading };
}
