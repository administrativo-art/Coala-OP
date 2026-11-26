import { FINANCIAL_DRE_START_MONTH_KEY } from "@/features/financial/lib/constants";
import { FINANCIAL_TIME_ZONE } from "@/features/financial/lib/financial-dates";

export const MONTH_CLOSING_FIRST_MONTH = FINANCIAL_DRE_START_MONTH_KEY;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

/** Data civil de hoje (`AAAA-MM-DD`) no fuso do negócio, sem converter dias. */
export function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FINANCIAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function shiftMonth(month: string, delta: number) {
  const [year, index] = month.split("-").map(Number);
  const zero = year * 12 + (index - 1) + delta;
  return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, "0")}`;
}

/** Competência padrão: o mês civil anterior ao de hoje, que é o que se fecha. */
export function defaultClosingMonth(now = new Date()) {
  const current = todayKey(now).slice(0, 7);
  const previous = shiftMonth(current, -1);
  return previous < MONTH_CLOSING_FIRST_MONTH ? MONTH_CLOSING_FIRST_MONTH : previous;
}

/** O fechamento cobre do início da DRE até o mês corrente (que aparece como em andamento). */
export function isClosableRange(month: string, now = new Date()) {
  return isMonthKey(month) && month >= MONTH_CLOSING_FIRST_MONTH && month <= todayKey(now).slice(0, 7);
}

export function monthLabel(month: string) {
  const [year, index] = month.split("-").map(Number);
  return `${MONTH_NAMES[index - 1]} de ${year}`;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA` (somente apresentação; os dados continuam em ISO). */
export function formatDateBr(isoDate: string | null | undefined) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "—";
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Valor em centavos → `R$ 1.234,56`. */
export function formatCents(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}
