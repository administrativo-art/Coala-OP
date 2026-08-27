export const PAYROLL_FGTS_LOANS_PROVISION_SERIES_KEY = "payroll-fgts-loans";
export const PAYROLL_INSS_PROVISION_SERIES_KEY = "payroll-inss-withheld";

export function payrollSalaryProvisionSeriesKey(employeeId: string) {
  const normalized = String(employeeId ?? "").trim();
  if (!normalized) throw new Error("O colaborador é obrigatório para a série de salário.");
  return `payroll-salary:${normalized}`;
}

const INSS_BANDS_2026 = [
  { ceilingCents: 162_100, rate: 0.075 },
  { ceilingCents: 290_284, rate: 0.09 },
  { ceilingCents: 435_427, rate: 0.12 },
  { ceilingCents: 847_555, rate: 0.14 },
] as const;

function cents(value: unknown) {
  return Math.round((Number(value) || 0) * 100);
}

export function calculatePayrollInss2026(grossValue: number) {
  const grossCents = cents(grossValue);
  let previousCeilingCents = 0;
  let contributionCents = 0;
  for (const band of INSS_BANDS_2026) {
    const taxableCents = Math.max(0, Math.min(grossCents, band.ceilingCents) - previousCeilingCents);
    contributionCents += Math.floor(taxableCents * band.rate);
    previousCeilingCents = band.ceilingCents;
    if (grossCents <= band.ceilingCents) break;
  }
  return contributionCents / 100;
}

export function calculatePayrollFgts(grossValue: number) {
  return Math.floor(cents(grossValue) * 0.08) / 100;
}

type PayrollProvisionLike = {
  id?: string;
  competenceDate?: unknown;
  provisionCompetence?: string | null;
  provisionSeriesKey?: string | null;
  provisionType?: string | null;
  status?: string | null;
  totalValue?: number | null;
  reconciledProvisionId?: string | null;
};

function competenceKey(value: PayrollProvisionLike) {
  if (/^\d{4}-\d{2}$/.test(value.provisionCompetence || "")) return value.provisionCompetence!;
  const raw = value.competenceDate as { toDate?: () => Date } | Date | string | null | undefined;
  const date = raw instanceof Date ? raw : raw && typeof raw === "object" && raw.toDate ? raw.toDate() : new Date(String(raw ?? ""));
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export type PayrollProvisionConsultation =
  | { status: "not_applicable" }
  | { status: "missing"; competence: string | null }
  | { status: "ambiguous"; competence: string; candidates: PayrollProvisionLike[] }
  | {
      status: "matched" | "already_reconciled";
      competence: string;
      provision: PayrollProvisionLike;
      actualValue: number;
      provisionedValue: number;
      variance: number;
    };

export function consultPayrollProvision(
  actual: PayrollProvisionLike,
  expenses: PayrollProvisionLike[],
): PayrollProvisionConsultation {
  const seriesKey = String(actual.provisionSeriesKey ?? "").trim();
  if (!seriesKey.startsWith("payroll-") || actual.provisionType === "forecast") return { status: "not_applicable" };
  const competence = competenceKey(actual);
  if (!competence) return { status: "missing", competence: null };
  if (actual.reconciledProvisionId) {
    const provision = expenses.find((candidate) => candidate.id === actual.reconciledProvisionId);
    if (provision) {
      const actualValue = cents(actual.totalValue) / 100;
      const provisionedValue = cents(provision.totalValue) / 100;
      return {
        status: "already_reconciled",
        competence,
        provision,
        actualValue,
        provisionedValue,
        variance: (cents(actualValue) - cents(provisionedValue)) / 100,
      };
    }
  }
  const candidates = expenses.filter((candidate) => (
    candidate.id !== actual.id
    && candidate.provisionSeriesKey === seriesKey
    && candidate.provisionType === "forecast"
    && candidate.status === "provisioned"
    && competenceKey(candidate) === competence
  ));
  if (candidates.length === 0) return { status: "missing", competence };
  if (candidates.length > 1) return { status: "ambiguous", competence, candidates };
  const provision = candidates[0];
  const actualValue = cents(actual.totalValue) / 100;
  const provisionedValue = cents(provision.totalValue) / 100;
  return {
    status: "matched",
    competence,
    provision,
    actualValue,
    provisionedValue,
    variance: (cents(actualValue) - cents(provisionedValue)) / 100,
  };
}
