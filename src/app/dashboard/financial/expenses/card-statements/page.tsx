import { redirect } from "next/navigation";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { financialSearchQuery, type FinancialSearchParams } from "@/features/financial/lib/reconciliation-navigation";

export default async function Page({ searchParams }: { searchParams: Promise<FinancialSearchParams> }) {
  const query = financialSearchQuery(await searchParams);
  redirect(`${FINANCIAL_ROUTES.cardStatements}${query ? `?${query}` : ""}`);
}
