import {
  consultExpenseProvision,
  DAS_PROVISION_SERIES_KEY,
  expenseCompetenceKey,
} from "@/features/financial/lib/expense-provisions";

export { DAS_PROVISION_SERIES_KEY, expenseCompetenceKey };

type DasExpenseLike = {
  id?: string;
  accountPlanName?: string | null;
  competenceDate?: unknown;
  provisionCompetence?: string | null;
  provisionSeriesKey?: string | null;
  provisionType?: string | null;
  status?: string | null;
  totalValue?: number;
  reconciledProvisionId?: string | null;
};

export type DasProvisionConsultation =
  | { status: "not_applicable" }
  | { status: "missing"; competence: string | null }
  | { status: "ambiguous"; competence: string; candidates: DasExpenseLike[] }
  | {
      status: "matched" | "already_reconciled";
      competence: string;
      provision: DasExpenseLike;
      actualValue: number;
      provisionedValue: number;
      variance: number;
    };

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function isDasExpense(expense: DasExpenseLike) {
  return expense.provisionSeriesKey === DAS_PROVISION_SERIES_KEY
    || normalize(expense.accountPlanName) === "das";
}

export function consultDasProvision(
  expense: DasExpenseLike,
  expenses: DasExpenseLike[],
): DasProvisionConsultation {
  if (!isDasExpense(expense) || expense.provisionType === "forecast") return { status: "not_applicable" };
  const consultation = consultExpenseProvision(
    { ...expense, provisionSeriesKey: DAS_PROVISION_SERIES_KEY },
    expenses,
  );
  if (consultation.status === "not_applicable") return consultation;
  const { seriesKey: _seriesKey, ...legacyConsultation } = consultation;
  return legacyConsultation as DasProvisionConsultation;
}
