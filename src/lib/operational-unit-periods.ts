import { isCivilDate } from '@/features/dp/employment-reference/resolve';

export type OperationalUnitPeriod = { validFrom: string; validTo?: string; unitIds: string[] };

export function sameOperationalPeriods(left: OperationalUnitPeriod[], right: OperationalUnitPeriod[]) {
  const normalized = (periods: OperationalUnitPeriod[]) => periods.map((period) => [period.validFrom, period.validTo ?? null, [...period.unitIds].sort()]);
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

export function operationalCivilDate(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Belem' }).format(now);
}

export function validateOperationalPeriods(value: unknown): value is OperationalUnitPeriod[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  return value.every((period, index) => {
    const previous = value[index - 1];
    return period && Object.keys(period).every((key) => ['validFrom', 'validTo', 'unitIds'].includes(key)) && isCivilDate(period.validFrom)
      && (period.validTo === undefined || isCivilDate(period.validTo) && period.validTo >= period.validFrom)
      && Array.isArray(period.unitIds) && period.unitIds.length > 0 && period.unitIds.length <= 20
      && period.unitIds.every((id: unknown) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(id))
      && new Set(period.unitIds).size === period.unitIds.length
      && (!previous || previous.validTo && previous.validTo < period.validFrom && previous.validFrom < period.validFrom);
  });
}

export function operationalUnitsOnDate(
  user: { operationalUnitPeriods?: OperationalUnitPeriod[]; unitIds?: string[] },
  date = operationalCivilDate(),
): string[] {
  if (user.operationalUnitPeriods === undefined) return user.unitIds ?? [];
  if (!isCivilDate(date) || !validateOperationalPeriods(user.operationalUnitPeriods)) return [];
  return user.operationalUnitPeriods.find((period) => period.validFrom <= date && (!period.validTo || period.validTo >= date))?.unitIds ?? [];
}

export function appendOperationalPeriod(periods: OperationalUnitPeriod[], start: string, unitIds: string[]) {
  if (!isCivilDate(start)) throw new Error('Informe uma data inicial válida.');
  const last = periods.at(-1);
  if (last && (start <= last.validFrom || last.validTo && start <= last.validTo)) {
    throw new Error('A nova vigência precisa começar depois da anterior.');
  }
  const next = periods.map((period) => ({ ...period, unitIds: [...period.unitIds] }));
  if (last && !last.validTo) {
    const date = new Date(`${start}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    next[next.length - 1].validTo = date.toISOString().slice(0, 10);
  }
  next.push({ validFrom: start, unitIds: [...new Set(unitIds)] });
  if (!validateOperationalPeriods(next)) throw new Error('Selecione de uma a vinte unidades para a vigência.');
  return next;
}
