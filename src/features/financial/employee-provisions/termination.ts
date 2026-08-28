export const EMPLOYEE_FORECAST_SERIES = [
  "payroll-salary",
  "recurring:vale-transporte",
] as const;

export function employeeForecastSeriesKeys(employeeId: string) {
  const normalized = String(employeeId || "").trim();
  if (!normalized) throw new Error("O colaborador é obrigatório para cancelar provisões futuras.");
  return EMPLOYEE_FORECAST_SERIES.map((prefix) => `${prefix}:${normalized}`);
}

export function terminationCompetence(terminationDate: string) {
  const normalized = String(terminationDate || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error("A data de desligamento é inválida.");
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`);
  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("A data de desligamento é inválida.");
  }
  return `${match[1]}-${match[2]}`;
}

export function isForecastAfterTermination(provisionCompetence: unknown, terminationDate: string) {
  const competence = String(provisionCompetence || "").trim();
  if (!/^\d{4}-\d{2}$/.test(competence)) return false;
  return competence > terminationCompetence(terminationDate);
}
