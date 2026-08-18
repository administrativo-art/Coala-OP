import { format } from "date-fns";

import { toDate } from "@/features/financial/lib/utils";

export const DAS_PROVISION_SERIES_KEY = "das-simples-nacional";

type ExpenseProvisionLike = {
  id?: string;
  description?: string | null;
  accountPlanName?: string | null;
  competenceDate?: unknown;
  provisionCompetence?: string | null;
  provisionSeriesKey?: string | null;
  provisionType?: string | null;
  status?: string | null;
  totalValue?: number | null;
  reconciledProvisionId?: string | null;
};

export type ExpenseProvisionConsultation =
  | { status: "not_applicable" }
  | { status: "missing"; competence: string | null; seriesKey: string }
  | { status: "ambiguous"; competence: string; seriesKey: string; candidates: ExpenseProvisionLike[] }
  | {
      status: "matched" | "already_reconciled";
      competence: string;
      seriesKey: string;
      provision: ExpenseProvisionLike;
      actualValue: number;
      provisionedValue: number;
      variance: number;
    };

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function slug(value: unknown) {
  return normalized(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function money(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function recurringSeries(parts: unknown[]) {
  const normalizedParts = parts.map(slug).filter(Boolean);
  return normalizedParts.length > 1 ? `recurring:${normalizedParts.join(":")}` : null;
}

export function expenseCompetenceKey(expense: ExpenseProvisionLike) {
  if (/^\d{4}-\d{2}$/.test(expense.provisionCompetence || "")) return expense.provisionCompetence!;
  const competence = toDate(expense.competenceDate);
  return competence ? format(competence, "yyyy-MM") : null;
}

export function inferExpenseProvisionSeriesKey(expense: ExpenseProvisionLike) {
  const stored = String(expense.provisionSeriesKey ?? "").trim();
  if (stored) return stored;

  const description = String(expense.description ?? "").trim();
  const normalizedDescription = normalized(description);
  if (normalized(expense.accountPlanName) === "das" || normalizedDescription.startsWith("das - unica -")) {
    return DAS_PROVISION_SERIES_KEY;
  }

  const internet = description.match(/^Internet\s*-\s*(.+?)\s*\|\s*(.+)$/i);
  if (internet) return recurringSeries(["internet", internet[1], internet[2]]);

  const accounting = description.match(/^Honor[aá]rio cont[aá]bil\s*-\s*(.+?)\s*\|\s*(.+)$/i);
  if (accounting) return recurringSeries(["honorario-contabil", accounting[1], accounting[2]]);

  const rent = description.match(/^Aluguel\s*-\s*(.+?)\s*\|\s*(.+)$/i);
  if (rent) return recurringSeries(["aluguel", rent[1], rent[2]]);

  if (normalizedDescription === "sistema rh - bizneo") return "recurring:sistema-rh:bizneo";

  const dental = description.match(/^Plano odontol[oó]gico\s*-\s*Odontoprev\s*\|\s*(.+)$/i);
  if (dental) return recurringSeries(["plano-odontologico", "odontoprev", dental[1]]);

  const gpt = description.match(/^GPT\/Codex\s*\|\s*(.+)$/i);
  if (gpt) return recurringSeries(["gpt-codex", gpt[1]]);

  return null;
}

export function expenseProvisionIdentity(expense: ExpenseProvisionLike) {
  const seriesKey = inferExpenseProvisionSeriesKey(expense);
  if (!seriesKey) return null;
  const competence = expenseCompetenceKey(expense);
  return {
    provisionSeriesKey: seriesKey,
    provisionType: expense.provisionType === "forecast" ? "forecast" : "actual",
    provisionCompetence: competence,
  } as const;
}

export function consultExpenseProvision(
  expense: ExpenseProvisionLike,
  expenses: ExpenseProvisionLike[],
): ExpenseProvisionConsultation {
  if (expense.provisionType === "forecast") return { status: "not_applicable" };
  const seriesKey = inferExpenseProvisionSeriesKey(expense);
  if (!seriesKey) return { status: "not_applicable" };
  const competence = expenseCompetenceKey(expense);
  if (!competence) return { status: "missing", competence: null, seriesKey };

  if (expense.reconciledProvisionId) {
    const provision = expenses.find((candidate) => candidate.id === expense.reconciledProvisionId);
    if (provision) {
      const actualValue = money(expense.totalValue);
      const provisionedValue = money(provision.totalValue);
      return {
        status: "already_reconciled",
        competence,
        seriesKey,
        provision,
        actualValue,
        provisionedValue,
        variance: money(actualValue - provisionedValue),
      };
    }
  }

  const candidates = expenses.filter((candidate) => (
    candidate.id !== expense.id
    && inferExpenseProvisionSeriesKey(candidate) === seriesKey
    && candidate.provisionType === "forecast"
    && candidate.status === "provisioned"
    && expenseCompetenceKey(candidate) === competence
  ));
  if (candidates.length === 0) return { status: "missing", competence, seriesKey };
  if (candidates.length > 1) return { status: "ambiguous", competence, seriesKey, candidates };

  const provision = candidates[0];
  const actualValue = money(expense.totalValue);
  const provisionedValue = money(provision.totalValue);
  return {
    status: "matched",
    competence,
    seriesKey,
    provision,
    actualValue,
    provisionedValue,
    variance: money(actualValue - provisionedValue),
  };
}
