export const FINANCIAL_COLLECTIONS = {
  users: "users",
  accountPlans: "accountPlans",
  resultCenters: "resultCenters",
  expenses: "expenses",
  bankAccounts: "bankAccounts",
  payments: "payments",
  transactions: "transactions",
  importAliases: "importAliases",
  importDrafts: "importDrafts",
} as const;

export type FinancialCollectionName =
  (typeof FINANCIAL_COLLECTIONS)[keyof typeof FINANCIAL_COLLECTIONS];

export const FINANCIAL_ROUTES = {
  root: "/dashboard/financial",
  cashFlow: "/dashboard/financial/cash-flow",
  financialFlow: "/dashboard/financial/financial-flow",
  dre: "/dashboard/financial/dre",
  expenses: "/dashboard/financial/expenses",
  newExpense: "/dashboard/financial/expenses/new",
  importExpenses: "/dashboard/financial/expenses/import",
  settings: "/dashboard/financial/settings",
} as const;
