export const FINANCIAL_COLLECTIONS = {
  users: "users",
  accounts: "accounts",
  resultCenters: "resultCenters",
  expenseDescriptions: "expenseDescriptions",
  expenses: "expenses",
  bankAccounts: "bankAccounts",
  cardStatements: "cardStatements",
  payments: "payments",
  transactions: "transactions",
  importAliases: "importAliases",
  importDrafts: "importDrafts",
  supplierPaymentProfiles: "supplierPaymentProfiles",
  bankPaymentRequests: "bankPaymentRequests",
  financialObligations: "financialObligations",
  obligationPaymentLinks: "obligationPaymentLinks",
  paymentAdjustments: "paymentAdjustments",
} as const;

export type FinancialCollectionName =
  (typeof FINANCIAL_COLLECTIONS)[keyof typeof FINANCIAL_COLLECTIONS];

export const FINANCIAL_ROUTES = {
  root: "/dashboard/financial",
  cashFlow: "/dashboard/financial/cash-flow",
  financialFlow: "/dashboard/financial/financial-flow",
  dre: "/dashboard/financial/dre",
  expenses: "/dashboard/financial/expenses",
  pendingAuditExpenses: "/dashboard/financial/expenses/pending-audit",
  newExpense: "/dashboard/financial/expenses/new",
  importExpenses: "/dashboard/financial/expenses/import",
  cardStatements: "/dashboard/financial/expenses/card-statements",
  settings: "/dashboard/financial/settings",
  paymentRequests: "/dashboard/financial/payment-requests",
} as const;
