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
  params.delete("ledger");
  if (options.fromExpenses) {
    params.set("returnTo", expensesReturnHref(`${FINANCIAL_ROUTES.expenses}?${search}`));
  }
  if (options.sessionId) {
    params.set("session", options.sessionId);
  }
  return `${FINANCIAL_ROUTES.bankStatements}${params.size ? `?${params}` : ""}`;
}

type CardStatementsHrefOptions = {
  monthKey: string;
  accountId: string;
  paymentMethodId: string;
  returnTo?: string;
};

/** Build a focused card-statement URL without losing its safe return destination. */
export function cardStatementsHref({ monthKey, accountId, paymentMethodId, returnTo }: CardStatementsHrefOptions): string {
  const params = new URLSearchParams({ month: monthKey, accountId, paymentMethodId });
  if (returnTo) params.set("returnTo", cardStatementsReturnHref(returnTo));
  return `${FINANCIAL_ROUTES.cardStatements}?${params}`;
}

/** Card statements may return only to Expenses or to the owning bank statement. */
export function cardStatementsReturnHref(value?: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return FINANCIAL_ROUTES.expenses;
  const url = new URL(value, "https://navigation.local");
  if (url.origin !== "https://navigation.local") return FINANCIAL_ROUTES.expenses;
  if (url.pathname !== FINANCIAL_ROUTES.expenses && url.pathname !== FINANCIAL_ROUTES.bankStatements) return FINANCIAL_ROUTES.expenses;
  url.searchParams.delete("ledger");
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

/** Keep the owning sidebar entry selected for the existing internal steps. */
export function financialSidebarPath(pathname: string, visibleHrefs: string[]): string {
  if (visibleHrefs.includes(pathname)) return pathname;

  const parents: Record<string, string> = {
    "/dashboard/financial/cash-deposits": "/dashboard/financial/cash-closures",
    "/dashboard/financial/budget-comparison": FINANCIAL_ROUTES.expenses,
    [FINANCIAL_ROUTES.stoneAnticipations]: FINANCIAL_ROUTES.stoneReceipts,
  };
  const parent = parents[pathname];
  return parent && visibleHrefs.includes(parent) ? parent : pathname;
}
