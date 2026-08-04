/**
 * O PDV Legal reporta horários já em hora local do quiosque (sem offset),
 * então o "dia de fechamento" é extraído diretamente da string, sem conversão
 * de fuso. Se um timestamp vier com offset/UTC explícito (Z ou ±HH:MM), aí sim
 * convertemos para America/Belem antes de extrair o dia — cobre o caso de a
 * API mudar de formato sem quebrar o bucket diário.
 */
export const CASH_CLOSURE_TIMEZONE = "America/Belem";

const DATE_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CASH_CLOSURE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

export function todayInClosureTimezone(now = new Date()) {
  return DATE_KEY_FORMATTER.format(now);
}

export function formatClosureMonthLabel(year: number, month: number) {
  const label = MONTH_YEAR_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1)));
  return `${label.charAt(0).toLocaleUpperCase("pt-BR")}${label.slice(1)}`;
}

const HAS_EXPLICIT_OFFSET = /[Zz]$|[+-]\d{2}:?\d{2}$/;
const NAIVE_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

export function closureDateFromIso(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Data do PDV vazia — não é possível determinar o dia de fechamento.");
  }

  if (HAS_EXPLICIT_OFFSET.test(trimmed)) {
    const instant = new Date(trimmed);
    if (Number.isNaN(instant.getTime())) {
      throw new Error(`Data do PDV em formato inválido: "${raw}".`);
    }
    return DATE_KEY_FORMATTER.format(instant);
  }

  const match = trimmed.match(NAIVE_DATE_PREFIX);
  if (!match) {
    throw new Error(`Data do PDV em formato inválido: "${raw}".`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}
