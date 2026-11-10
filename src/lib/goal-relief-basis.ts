/** Competência inicial da regra de folguista por dia. Períodos anteriores preservam o rateio por turno. */
export const GOAL_RELIEF_DAY_BASIS_FROM = '2026-11-01';

export function goalReliefBasisForStart(value: unknown): 'turns' | 'days' {
  let key: string | null = null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) key = value;
  else {
    const date = value instanceof Date ? value
      : value && typeof (value as { toDate?: unknown }).toDate === 'function'
        ? (value as { toDate(): Date }).toDate() : null;
    if (date && !Number.isNaN(date.getTime())) key = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  }
  return key && key >= GOAL_RELIEF_DAY_BASIS_FROM ? 'days' : 'turns';
}
