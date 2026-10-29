import type { EmploymentPeriodInput } from './schemas';

export type EmploymentPeriod = EmploymentPeriodInput & {
  employer: { unitId: string; unitName: string; cnpj: string; address: string; identityStatus: 'catalog_identifiers_consistent_unverified' };
  jobRoleName: string | null;
  jobFunctionNames: string[];
};

export type EmploymentHistory = {
  workspaceId: string;
  userId: string;
  revision: number;
  historyId: string;
  periods: EmploymentPeriod[];
};

export type EmploymentResolution =
  | { status: 'missing' }
  | { status: 'gap'; historyId: string; revision: number; date: string }
  | { status: 'inconsistent'; historyId?: string; revision?: number }
  | { status: 'matched'; historyId: string; revision: number; date: string; period: EmploymentPeriod;
      contractualDataReference?: { changeId: string; validFrom: string; validTo: string | null };
      operationalUnitReference?: { hash: string; validFrom: string; validTo: string | null; unitIds: string[] } };

export function isCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function validEmploymentHistory(history: EmploymentHistory): boolean {
  if (!Array.isArray(history.periods) || history.periods.length < 1 || history.periods.length > 100) return false;
  let previous: EmploymentPeriod | undefined;
  for (const period of history.periods) {
    if (!period || !isCivilDate(period.validFrom)
      || period.validTo !== undefined && !isCivilDate(period.validTo)
      || period.validTo && period.validTo < period.validFrom
      || previous && (previous.validFrom >= period.validFrom || !previous.validTo || previous.validTo >= period.validFrom)
      || !['clt', 'apprenticeship', 'pj', 'internship', 'partner'].includes(period.employmentRelationshipType)
      || typeof period.employerUnitId !== 'string' || !period.employerUnitId
      || typeof period.unitId !== 'string' || !period.unitId
      || !Array.isArray(period.unitIds) || period.unitIds.length < 1 || period.unitIds.length > 20
      || !period.unitIds.every((id) => typeof id === 'string' && Boolean(id))
      || new Set(period.unitIds).size !== period.unitIds.length
      || period.jobRoleId !== undefined && (typeof period.jobRoleId !== 'string' || !period.jobRoleId)
      || !Array.isArray(period.jobFunctionIds) || period.jobFunctionIds.length > 20
      || !period.jobFunctionIds.every((id) => typeof id === 'string' && Boolean(id))
      || new Set(period.jobFunctionIds).size !== period.jobFunctionIds.length
      || period.jobRoleName !== null && typeof period.jobRoleName !== 'string'
      || !Array.isArray(period.jobFunctionNames)
      || period.jobFunctionNames.length !== period.jobFunctionIds.length
      || !period.jobFunctionNames.every((name) => typeof name === 'string')
      || typeof period.sourceDocumentId !== 'string' || !period.sourceDocumentId
      || typeof period.sourceReason !== 'string' || !period.sourceReason
      || !period.employer || period.employer.unitId !== period.employerUnitId
      || typeof period.employer.cnpj !== 'string' || !/^\d{14}$/.test(period.employer.cnpj)
      || typeof period.employer.unitName !== 'string' || !period.employer.unitName.trim()
      || typeof period.employer.address !== 'string' || !period.employer.address.trim()
      || period.employer.identityStatus !== 'catalog_identifiers_consistent_unverified') return false;
    previous = period;
  }
  return true;
}

export function resolveEmploymentReference(history: EmploymentHistory | null, date: string): EmploymentResolution {
  if (!history) return { status: 'missing' };
  const base = { historyId: history.historyId, revision: history.revision };
  if (!isCivilDate(date) || !validEmploymentHistory(history)) {
    return { status: 'inconsistent', ...base };
  }
  const matches = history.periods.filter((period) => period.validFrom <= date && (!period.validTo || period.validTo >= date));
  if (matches.length > 1) return { status: 'inconsistent', ...base };
  if (!matches.length) return { status: 'gap', ...base, date };
  return { status: 'matched', ...base, date, period: matches[0] };
}
