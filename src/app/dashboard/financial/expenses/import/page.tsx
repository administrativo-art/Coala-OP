import { redirect } from "next/navigation";
import { bankStatementsHref, financialSearchQuery, type FinancialSearchParams } from "@/features/financial/lib/reconciliation-navigation";

export default async function Page({ searchParams }: { searchParams: Promise<FinancialSearchParams> }) {
  redirect(bankStatementsHref(financialSearchQuery(await searchParams), { fromExpenses: true }));
}
