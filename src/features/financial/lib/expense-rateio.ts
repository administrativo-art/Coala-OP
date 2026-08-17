export const RATEIO_CRITERIA = ["equal", "fixed", "revenue", "headcount"] as const;

export type RateioCriterion = (typeof RATEIO_CRITERIA)[number];
export type RateioFirstMonthMode = "full" | "prorated";

export type RateioParticipant = {
  resultCenter: string;
  percentage: number;
  basisValue?: number;
  participationStartDate?: string;
};

export type ExpenseRateioPolicy = {
  versionId: string;
  criterion: RateioCriterion;
  effectiveFrom: string;
  firstMonthMode: RateioFirstMonthMode;
  participants: RateioParticipant[];
};

type ExpenseLike = {
  totalValue?: number;
  status?: string;
  competenceDate?: unknown;
  dueDate?: unknown;
  isApportioned?: boolean;
  resultCenter?: string | null;
  apportionments?: Array<{ resultCenter?: string; percentage?: number }> | null;
};

export type ResultCenterNameMap = Record<string, string>;

export function resolveResultCenterName(
  resultCenter: string | null | undefined,
  namesById: ResultCenterNameMap = {}
) {
  const value = typeof resultCenter === "string" ? resultCenter.trim() : "";
  return value ? namesById[value] || value : "";
}

export function expenseReferencesResultCenter(
  expense: ExpenseLike,
  resultCenter: string,
  namesById: ResultCenterNameMap = {}
) {
  if (!expense.isApportioned) {
    return resolveResultCenterName(expense.resultCenter, namesById) === resultCenter;
  }

  return (expense.apportionments || []).some(
    (item) => resolveResultCenterName(item.resultCenter, namesById) === resultCenter
  );
}

function parseLocalDate(value: string | Date): Date {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day || 1);
}

function dateFromUnknown(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function monthKey(value: string | Date): number {
  const date = parseLocalDate(value);
  return date.getFullYear() * 12 + date.getMonth();
}

export function toCompetenceDate(value: string | Date): string {
  const date = parseLocalDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export function distributeRateioPercentages(weights: number[]): number[] {
  if (weights.length === 0) return [];

  const sanitized = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const totalWeight = sanitized.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = totalWeight > 0 ? sanitized : weights.map(() => 1);
  const effectiveTotal = effectiveWeights.reduce((sum, weight) => sum + weight, 0);
  const rawHundredths = effectiveWeights.map((weight) => (weight / effectiveTotal) * 10_000);
  const hundredths = rawHundredths.map(Math.floor);
  let remainder = 10_000 - hundredths.reduce((sum, value) => sum + value, 0);

  const remainderOrder = rawHundredths
    .map((raw, index) => ({ index, fraction: raw - Math.floor(raw) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let index = 0; index < remainder; index += 1) {
    hundredths[remainderOrder[index % remainderOrder.length].index] += 1;
  }

  return hundredths.map((value) => value / 100);
}

export function distributeEqualRateioPercentages(count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  return distributeRateioPercentages(Array.from({ length: count }, () => 1)).reverse();
}

export function buildEqualRateio(
  resultCenters: string[],
  participationStartDate?: string
): RateioParticipant[] {
  const uniqueCenters = Array.from(new Set(resultCenters.map((center) => center.trim()).filter(Boolean)));
  const percentages = distributeRateioPercentages(uniqueCenters.map(() => 1));

  return uniqueCenters.map((resultCenter, index) => ({
    resultCenter,
    percentage: percentages[index],
    ...(participationStartDate ? { participationStartDate } : {}),
  }));
}

function participantBaseWeight(participant: RateioParticipant, criterion: RateioCriterion) {
  if (criterion === "equal") return 1;
  if (criterion === "fixed") return Number(participant.percentage) || 0;
  return Number(participant.basisValue) || 0;
}

export function resolveRateioForCompetence(
  policy: ExpenseRateioPolicy,
  competence: string | Date
): Array<{ resultCenter: string; percentage: number }> {
  const competenceKey = monthKey(competence);
  if (competenceKey < monthKey(policy.effectiveFrom)) return [];

  const activeParticipants = policy.participants.filter((participant) => {
    const start = participant.participationStartDate || policy.effectiveFrom;
    return monthKey(start) <= competenceKey;
  });

  const weights = activeParticipants.map((participant) => {
    let weight = participantBaseWeight(participant, policy.criterion);
    const start = parseLocalDate(participant.participationStartDate || policy.effectiveFrom);

    if (policy.firstMonthMode === "prorated" && monthKey(start) === competenceKey) {
      const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
      weight *= (daysInMonth - start.getDate() + 1) / daysInMonth;
    }

    return weight;
  });

  const percentages = distributeRateioPercentages(weights);
  return activeParticipants.map((participant, index) => ({
    resultCenter: participant.resultCenter,
    percentage: percentages[index],
  }));
}

export function isRateioOccurrenceEligible(
  expense: Pick<ExpenseLike, "status" | "competenceDate" | "dueDate">,
  effectiveFrom: string | Date
) {
  if (expense.status !== "pending") return false;
  const competence = dateFromUnknown(expense.competenceDate) || dateFromUnknown(expense.dueDate);
  return !!competence && monthKey(competence) >= monthKey(effectiveFrom);
}

export function expenseValueForResultCenter(
  expense: ExpenseLike,
  resultCenter?: string | null,
  namesById: ResultCenterNameMap = {}
) {
  const totalValue = Number(expense.totalValue) || 0;
  if (!resultCenter) return totalValue;
  if (!expense.isApportioned) {
    return resolveResultCenterName(expense.resultCenter, namesById) === resultCenter ? totalValue : 0;
  }

  const percentage = (expense.apportionments || [])
    .filter((item) => resolveResultCenterName(item.resultCenter, namesById) === resultCenter)
    .reduce((sum, item) => sum + (Number(item.percentage) || 0), 0);

  return Number(((totalValue * percentage) / 100).toFixed(2));
}
