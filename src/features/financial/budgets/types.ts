export type BudgetCalculationMode = "manual" | "fixed" | "expense_average" | "expense_previous" | "consumption_price";

/** Absence of resultCenterId means a legacy/global envelope. Names are server snapshots. */
export type BudgetScope = { resultCenterId?: string | null; resultCenterName?: string | null };
export type BudgetPersonLine = {
  id: string;
  employeeId: string;
  employeeName: string;
  accountPlanId: string;
  amountCents: number;
  expectedPurchaseDate: string;
  estimateSource: "manual" | "fixed";
};
export type BudgetRulePersonLine = Omit<BudgetPersonLine, "expectedPurchaseDate" | "estimateSource"> & {
  purchaseDay: number;
  purchaseMonthOffset: -1 | 0;
};
export type BudgetCoverage = {
  lineId: string;
  state: "partial" | "final" | "not_required";
  documents: Array<{ expenseId: string; fingerprint: string }>;
  residualAmountCents: number | null;
  reason: string;
  confirmedBy: string;
  confirmedAt: string;
};
export type BudgetPersonSummary = BudgetPersonLine & {
  committedAmountCents: number;
  balanceAmountCents: number;
  residualAmountCents: number;
  coverageState: "open" | "partial" | "final" | "invalidated" | "not_required";
  documentIds: string[];
  documentFingerprints: Record<string, string>;
};

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

export type FinancialBudget = BudgetScope & {
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
  composition?: BudgetPersonLine[];
  purchaseMonths?: string[];
  compositionEmployeeIds?: string[];
  expectationStops?: Array<{ lineId: string; terminationProcessId: string; terminationDate: string; stoppedBy: string; stoppedAt: string }>;
  coverage?: BudgetCoverage[];
};

export type FinancialBudgetRule = BudgetScope & {
  hasComposition?: boolean;
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
  endMonth?: string | null;
  generationLeadMonths?: 0 | 1;
  composition?: BudgetRulePersonLine[];
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type FinancialBudgetSummary = FinancialBudget & {
  hasComposition?: boolean;
  people?: BudgetPersonSummary[];
  residualAmountCents?: number;
  unidentifiedAmountCents?: number;
  outsideCompositionAmountCents?: number;
  personnelDetailsRedacted?: boolean;
  consumedAmountCents: number;
  forecastCoverageAmountCents: number;
  balanceAmountCents: number;
  usageRatio: number;
  expenses: Array<{ id: string; description: string; amountCents: number; impactDate: string }>;
  curve: Array<{ key: string; day: string; plannedBalanceCents: number; actualBalanceCents: number | null }>;
  issues: string[];
};

export type ProjectCashStage = { id: string; name: string; startDate: string; endDate: string; amountCents: number };
export type ProjectCashPlan = { mode: "uniform" | "custom"; stages: ProjectCashStage[] };
export type ProjectStageClosure = { stageId: string; evidence: string; reason: string; actorUid: string; closedAt: string };
export type ProjectCashStageSummary = ProjectCashStage & {
  committedAmountCents: number; residualAmountCents: number; closed: boolean; requiresReview: boolean; evidence: string;
};

export type FinancialBudgetProject = {
  id: string;
  name: string;
  accountPlanIds: string[];
  startMonth: string;
  endMonth: string;
  periodMode?: "competence" | "date_range";
  startDate?: string;
  endDate?: string;
  cashPlan?: ProjectCashPlan;
  originalCashPlan?: ProjectCashPlan;
  expenseStageIds?: Record<string, string>;
  stageClosures?: ProjectStageClosure[];
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
  cashStages?: ProjectCashStageSummary[];
};
