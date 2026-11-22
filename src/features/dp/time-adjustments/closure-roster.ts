import { isCivilDate } from '../employment-reference/resolve';
import { belongsToTimeClosureRoster } from '../../../lib/hr/employment-relationship';

export const rosterReasons = {
  historical: 'Vínculo elegível no histórico da competência',
  registered: 'Vínculo elegível pelas datas do cadastro',
  legacy: 'Cadastro antigo sem data de admissão',
  occurrence: 'Ocorrência registrada na competência',
} as const;
export type RosterReason = keyof typeof rosterReasons;

export function rosterDate(value: unknown): string | null {
  if (isCivilDate(value)) return value;
  const date = value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function'
    ? value.toDate() : value;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function registeredRosterReason(user: Record<string, unknown>, start: string, end: string): RosterReason | null {
  const admission = rosterDate(user.admissionDate);
  const termination = rosterDate(user.terminationDate);
  if ((admission && admission > end) || (termination && termination < start)) return null;
  if (user.isActive === false && !termination) return null;
  const relationship = termination ? user.terminationRelationshipType ?? user.employmentRelationshipType : user.employmentRelationshipType;
  const scheduled = user.scheduledContractChange as { id?: string } | undefined;
  const periods = Array.isArray(user.contractualDataPeriods)
    ? user.contractualDataPeriods.filter((period) => period && isCivilDate(period.validFrom) && period.changeId !== scheduled?.id)
    : [];
  const from = admission && admission > start ? admission : start;
  const through = termination && termination < end ? termination : end;
  for (const [index, period] of periods.entries()) {
    const periodEnd = scheduled?.id && index === periods.length - 1 ? null : period.validTo;
    if (period.validFrom <= through && (!periodEnd || periodEnd >= from)
      && belongsToTimeClosureRoster(period.fields?.employmentRelationshipType ?? relationship)) return 'historical';
  }
  if (periods.length && from >= periods[0].validFrom) return null;
  if (!belongsToTimeClosureRoster(relationship)) return null;
  return admission ? 'registered' : 'legacy';
}
