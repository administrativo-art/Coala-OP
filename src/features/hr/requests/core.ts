import type { TransportVoucherRequestAction } from "@/features/hr/requests/types";

export function todayInBelem(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const TRANSPORT_VOUCHER_CUTOFF_DAY = 20;
export const PAYROLL_PAYMENT_BUSINESS_DAY = 5;

const MONTHS_PT_BR = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

function calendarDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Data da solicitação inválida.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
  ) {
    throw new Error("Data da solicitação inválida.");
  }
  return { year, month, day };
}

export function formatBrazilianRequestText(value: string) {
  return value
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_match, year: string, month: string, day: string) => `${day}/${month}/${year}`)
    .replace(/\b(\d{4})-(\d{2})\b/g, (match, year: string, month: string) => {
      const monthName = MONTHS_PT_BR[Number(month) - 1];
      return monthName ? `${monthName} de ${year}` : match;
    });
}

export function calculateTransportVoucherEffect(
  requestDate = todayInBelem(),
  cutoffDay = TRANSPORT_VOUCHER_CUTOFF_DAY,
) {
  const { year, month, day } = calendarDateParts(requestDate);
  if (!Number.isInteger(cutoffDay) || cutoffDay < 1 || cutoffDay > 28) {
    throw new Error("Dia de corte do vale-transporte inválido.");
  }
  const requestedAfterCutoff = day > cutoffDay;
  const monthsAhead = requestedAfterCutoff ? 2 : 1;
  const targetIndex = year * 12 + (month - 1) + monthsAhead;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = targetIndex % 12 + 1;
  const processingCompetence = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
  const payslipPaymentDate = calculatePayslipPaymentDate(processingCompetence);
  return {
    requestDate,
    cutoffDay,
    requestedAfterCutoff,
    processingCompetence,
    effectiveDate: `${processingCompetence}-01`,
    payslipPaymentDate,
  };
}

export function calculatePayslipPaymentDate(
  processingCompetence: string,
  paymentBusinessDay = PAYROLL_PAYMENT_BUSINESS_DAY,
  holidays: Iterable<string> = [],
) {
  if (!/^\d{4}-\d{2}$/.test(processingCompetence)) {
    throw new Error("Competência do contracheque inválida.");
  }
  if (!Number.isInteger(paymentBusinessDay) || paymentBusinessDay < 1 || paymentBusinessDay > 10) {
    throw new Error("Dia útil de pagamento inválido.");
  }
  const { year, month } = calendarDateParts(`${processingCompetence}-01`);
  const paymentMonth = new Date(Date.UTC(year, month, 1));
  const holidaySet = new Set(holidays);
  let businessDays = 0;
  for (let day = 1; day <= 31; day += 1) {
    const candidate = new Date(Date.UTC(paymentMonth.getUTCFullYear(), paymentMonth.getUTCMonth(), day));
    if (candidate.getUTCMonth() !== paymentMonth.getUTCMonth()) break;
    const date = candidate.toISOString().slice(0, 10);
    const weekday = candidate.getUTCDay();
    if (weekday === 0 || weekday === 6 || holidaySet.has(date)) continue;
    businessDays += 1;
    if (businessDays === paymentBusinessDay) return date;
  }
  throw new Error("Não foi possível calcular a data de pagamento do contracheque.");
}

export function normalizeRequestDetails(value: unknown) {
  const details = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!details) return "";
  if (details.length < 10) throw new Error("Quando informado, o motivo deve ter pelo menos 10 caracteres.");
  if (details.length > 1_500) throw new Error("A justificativa deve ter no máximo 1.500 caracteres.");
  return details;
}

export function normalizeTransportVoucherRequestAction(value: unknown): TransportVoucherRequestAction {
  if (value === "activate" || value === "change" || value === "suspend" || value === "reactivate") return value;
  throw new Error("Selecione adesão, alteração, suspensão ou reativação.");
}

export function assertTransportVoucherActionAvailable(
  action: TransportVoucherRequestAction,
  active: boolean,
  wasConfigured = false,
) {
  if (active && (action === "activate" || action === "reactivate")) {
    throw new Error("O vale-transporte já está ativo. Solicite uma alteração ou suspensão.");
  }
  if (active) return;
  if (action === "change" || action === "suspend") {
    throw new Error(`O vale-transporte não está ativo. Solicite a ${wasConfigured ? "reativação" : "adesão"}.`);
  }
  if (wasConfigured && action !== "reactivate") {
    throw new Error("O vale-transporte está suspenso. Solicite a reativação.");
  }
  if (!wasConfigured && action !== "activate") {
    throw new Error("O vale-transporte ainda não foi configurado. Solicite a adesão.");
  }
}

export function normalizeApprovedDailyValue(value: unknown, required: boolean) {
  if (!required && (value === null || value === undefined || value === "")) return null;
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Informe um valor diário de vale-transporte maior que zero.");
  }
  return Math.round(parsed * 100) / 100;
}
