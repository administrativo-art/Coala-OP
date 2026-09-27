import { FINANCIAL_ROUTES } from "./constants";

export type FinancialSearchParams = Record<string, string | string[] | undefined>;

export function financialSearchQuery(params: FinancialSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, entry);
    }
  }
  return query.toString();
}

/** Return only to the expense list, never to a user-supplied external URL. */
export function expensesReturnHref(value?: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return FINANCIAL_ROUTES.expenses;
  const url = new URL(value, "https://navigation.local");
  if (url.origin !== "https://navigation.local" || url.pathname !== FINANCIAL_ROUTES.expenses) return FINANCIAL_ROUTES.expenses;
  for (const key of ["view", "session", "ledger", "returnTo"]) url.searchParams.delete(key);
  const query = url.searchParams.toString();
  return `${FINANCIAL_ROUTES.expenses}${query ? `?${query}` : ""}`;
}

export function bankStatementsHref(search = "", options: { sessionId?: string; fromExpenses?: boolean } = {}): string {
  const params = new URLSearchParams(search);
  params.delete("view");
  if (options.fromExpenses) {
    params.set("returnTo", expensesReturnHref(`${FINANCIAL_ROUTES.expenses}?${search}`));
  }
  if (options.sessionId) {
    params.set("session", options.sessionId);
    params.delete("ledger");
  }
  return `${FINANCIAL_ROUTES.bankStatements}${params.size ? `?${params}` : ""}`;
}

/** Keep the owning sidebar entry selected for the existing internal steps. */
export function financialSidebarPath(pathname: string, visibleHrefs: string[]): string {
  const parents: Record<string, string> = {
    "/dashboard/financial/cash-deposits": "/dashboard/financial/cash-closures",
    "/dashboard/financial/stone-anticipations": "/dashboard/financial/sales-reconciliation",
  };
  const parent = parents[pathname];
  return parent && visibleHrefs.includes(parent) ? parent : pathname;
}
