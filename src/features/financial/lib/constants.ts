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
  expectedBankDebits: "expectedBankDebits",
  financialObligations: "financialObligations",
  obligationPaymentLinks: "obligationPaymentLinks",
  paymentAdjustments: "paymentAdjustments",
  financialInboxMessages: "financialInboxMessages",
} as const;

export type FinancialCollectionName =
  (typeof FINANCIAL_COLLECTIONS)[keyof typeof FINANCIAL_COLLECTIONS];

export const FINANCIAL_ROUTES = {
  root: "/dashboard/financial",
  cashFlow: "/dashboard/financial/cash-flow",
  financialFlow: "/dashboard/financial/financial-flow",
  dre: "/dashboard/financial/dre",
  expenses: "/dashboard/financial/expenses",
  inbox: "/dashboard/financial/expenses/inbox",
  pendingAuditExpenses: "/dashboard/financial/expenses/pending-audit",
  newExpense: "/dashboard/financial/expenses/new",
  importExpenses: "/dashboard/financial/expenses/import",
  cardStatements: "/dashboard/financial/expenses/card-statements",
  settings: "/dashboard/financial/settings",
  paymentRequests: "/dashboard/financial/expenses/authorizations",
} as const;

// Marco operacional definido para a série contábil. Competências anteriores
// podem ser preservadas apenas como histórico de abertura, sem entrar na fila
// de auditoria da DRE iniciada em agosto de 2026.
export const FINANCIAL_DRE_START_MONTH_KEY = "2026-08";
