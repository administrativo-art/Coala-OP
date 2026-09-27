import { ExpensesPage } from "@/features/financial/pages/expenses-page";
import { redirect } from "next/navigation";
import { bankStatementsHref, financialSearchQuery, type FinancialSearchParams } from "@/features/financial/lib/reconciliation-navigation";

export default async function Page({ searchParams }: { searchParams: Promise<FinancialSearchParams> }) {
  const params = await searchParams;
  if (params.view === "audits" || (Array.isArray(params.view) && params.view[0] === "audits")) {
    redirect(bankStatementsHref(financialSearchQuery(params), { fromExpenses: true }));
  }
  return <ExpensesPage />;
}
