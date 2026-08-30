export const CASH_COUNTING_MIN_YEAR = 2020;
export const CASH_COUNTING_MAX_YEAR = 2200;
export const CASH_COUNTING_MAX_PERIODS = 6;
export const CASH_COUNTING_MAX_SCOPES = 36;

export const CASH_COUNTING_MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

const PERIOD_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function cashCountingPeriodKey(year: number, month: number) {
  if (!Number.isInteger(year) || year < CASH_COUNTING_MIN_YEAR || year > CASH_COUNTING_MAX_YEAR) {
    throw new Error("Ano da competência inválido.");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Mês da competência inválido.");
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function toggleCashCountingPeriod(
  current: readonly string[],
  target: string,
  limit = CASH_COUNTING_MAX_PERIODS,
) {
  const match = PERIOD_KEY_PATTERN.exec(target);
  if (!match) throw new Error("Competência inválida.");
  cashCountingPeriodKey(Number(match[1]), Number(match[2]));
  if (!Number.isInteger(limit) || limit < 1 || limit > CASH_COUNTING_MAX_PERIODS) {
    throw new Error("Limite de competências inválido.");
  }

  const selected = new Set(current);
  if (selected.has(target)) selected.delete(target);
  else if (selected.size < limit) selected.add(target);

  return Array.from(selected).sort();
}

export function cashCountingPeriodLimit(unitCount: number) {
  if (!Number.isInteger(unitCount) || unitCount < 0) throw new Error("Quantidade de unidades inválida.");
  return Math.min(
    CASH_COUNTING_MAX_PERIODS,
    Math.floor(CASH_COUNTING_MAX_SCOPES / Math.max(1, unitCount)),
  );
}
