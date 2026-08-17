import { format } from "date-fns";

import { toDate } from "@/features/financial/lib/utils";

export const DAS_PROVISION_SERIES_KEY = "das-simples-nacional";

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

function money(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function expenseCompetenceKey(expense: DasExpenseLike) {
  if (/^\d{4}-\d{2}$/.test(expense.provisionCompetence || "")) return expense.provisionCompetence!;
  const competence = toDate(expense.competenceDate);
  return competence ? format(competence, "yyyy-MM") : null;
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
  const competence = expenseCompetenceKey(expense);
  if (!competence) return { status: "missing", competence: null };

  if (expense.reconciledProvisionId) {
    const provision = expenses.find((candidate) => candidate.id === expense.reconciledProvisionId);
    if (provision) {
      const actualValue = money(expense.totalValue);
      const provisionedValue = money(provision.totalValue);
      return {
        status: "already_reconciled",
        competence,
        provision,
        actualValue,
        provisionedValue,
        variance: money(actualValue - provisionedValue),
      };
    }
  }

  const candidates = expenses.filter((candidate) =>
    candidate.id !== expense.id
    && candidate.provisionSeriesKey === DAS_PROVISION_SERIES_KEY
    && candidate.provisionType === "forecast"
    && candidate.status === "provisioned"
    && expenseCompetenceKey(candidate) === competence
  );
  if (candidates.length === 0) return { status: "missing", competence };
  if (candidates.length > 1) return { status: "ambiguous", competence, candidates };

  const provision = candidates[0];
  const actualValue = money(expense.totalValue);
  const provisionedValue = money(provision.totalValue);
  return {
    status: "matched",
    competence,
    provision,
    actualValue,
    provisionedValue,
    variance: money(actualValue - provisionedValue),
  };
}
