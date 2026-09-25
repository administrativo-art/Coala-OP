export type BudgetCalculationMode = "manual" | "fixed" | "expense_average" | "expense_previous" | "consumption_price";

export type BudgetInputEstimate = {
  baseProductId: string;
  name: string;
  unit: string;
  forecastQuantity: number;
  openingStockQuantity: number;
  inboundQuantity: number;
  closingStockQuantity: number;
  additionalPurchaseQuantity: number;
  averagePriceCentsPerUnit: number;
  additionalPurchaseAmountCents: number;
};

export type FinancialBudget = {
  id: string;
  name: string;
  competenceMonth: string;
  accountPlanIds: string[];
  budgetedAmountCents: number;
  active: boolean;
  source: "manual" | "generated";
  ruleId: string | null;
  calculationMode: BudgetCalculationMode;
  calculationSnapshot: {
    referenceMonths: string[];
    referenceAmountsCents: number[];
    calculatedAt: string;
    inputEstimates?: BudgetInputEstimate[];
    committedAmountCents?: number;
  } | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type FinancialBudgetRule = {
  id: string;
  name: string;
  accountPlanIds: string[];
  mode: Exclude<BudgetCalculationMode, "manual">;
  fixedAmountCents: number | null;
  averageMonths: number;
  baseProductIds: string[];
  stockKioskId: string | null;
  closingStockDays: number;
  startMonth: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type FinancialBudgetSummary = FinancialBudget & {
  consumedAmountCents: number;
  forecastCoverageAmountCents: number;
  balanceAmountCents: number;
  usageRatio: number;
  expenses: Array<{ id: string; description: string; amountCents: number; impactDate: string }>;
  curve: Array<{ key: string; day: string; plannedBalanceCents: number; actualBalanceCents: number | null }>;
  issues: string[];
};

export type FinancialBudgetProject = {
  id: string;
  name: string;
  accountPlanIds: string[];
  startMonth: string;
  endMonth: string;
  budgetedAmountCents: number;
  active: boolean;
  expenseIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type FinancialBudgetProjectSummary = FinancialBudgetProject & {
  consumedAmountCents: number;
  balanceAmountCents: number;
  expenses: Array<{ id: string; description: string; amountCents: number; competenceMonth: string }>;
  issues: string[];
};
