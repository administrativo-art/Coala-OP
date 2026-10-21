import { resolveAbsencePolicy, type DPAbsenceResolutionTarget } from '@/lib/dp-absence-rules';
import type { DPAbsenceType, DPAbsencePolicy } from '@/types';
import type { AbsenceRequestPreviewInput } from './schemas';
import type { AbsenceRequestOption, AbsenceRequestPreview, PublicAbsenceRule } from './types';

export class AbsencePreviewError extends Error {
  constructor(readonly reason: 'not_available' | 'ambiguous' | 'unit_disabled' | 'notice' | 'retroactive' | 'maximum' | 'invalid_period') {
    super(reason);
  }
}

function civilDay(value: string) { return Date.parse(`${value}T00:00:00Z`) / 86_400_000; }

/** Competências civis tocadas pelo pedido, inclusive quando atravessa a virada do mês. */
export function absenceCompetences(startDate: string, endDate: string) {
  const result: string[] = [];
  let year = Number(startDate.slice(0, 4));
  let month = Number(startDate.slice(5, 7));
  const lastYear = Number(endDate.slice(0, 4));
  const lastMonth = Number(endDate.slice(5, 7));
  while (year < lastYear || year === lastYear && month <= lastMonth) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return result;
}

export function belemCivilDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function isPublished(type: DPAbsenceType) {
  return type.status === 'published' && !!type.publishedAt;
}

function publicRule(policy: DPAbsencePolicy): PublicAbsenceRule {
  return {
    id: policy.id, name: policy.name, calculation: policy.calculation,
    maxUnitsPerRequest: policy.maxUnitsPerRequest,
    maxUnitsPerPeriod: policy.maxUnitsPerPeriod,
    limitPeriod: policy.limitPeriod,
    minimumNoticeDays: policy.minimumNoticeDays,
    maximumRetroactiveDays: policy.maximumRetroactiveDays,
    attachment: policy.attachment, approvalFlow: policy.approvalFlow,
    tacitApprovalDays: policy.tacitApprovalDays,
    instructions: policy.instructions,
  };
}

export function listAbsenceRequestOptions(types: readonly DPAbsenceType[], target: DPAbsenceResolutionTarget, today: string,
  origin: 'collaborator' | 'manager' | 'dp' = 'collaborator'): AbsenceRequestOption[] {
  return types.flatMap((type) => {
    if (!isPublished(type) || !type.initiatedBy.includes(origin) || !type.requestUnits.length) return [];
    const evaluationDate = today < type.validFrom ? type.validFrom : today;
    const resolution = resolveAbsencePolicy(type, evaluationDate, target);
    if (resolution.status !== 'matched') return [];
    return [{ id: type.id, name: type.name, units: [...type.requestUnits], calculation: resolution.policy.calculation, attachmentRequired: resolution.policy.attachment === 'required', validFrom: type.validFrom, validTo: type.validTo ?? null, color: type.color,
      ...(origin === 'collaborator' ? {} : { origin }) }];
  });
}

export function previewAbsenceRequest(input: AbsenceRequestPreviewInput, type: DPAbsenceType, target: DPAbsenceResolutionTarget, today: string, source: 'coala' | 'coala-rh' = 'coala',
  origin: 'collaborator' | 'manager' | 'dp' = 'collaborator'): AbsenceRequestPreview {
  if (!isPublished(type) || !type.initiatedBy.includes(origin)) throw new AbsencePreviewError('not_available');
  if (!type.requestUnits.includes(input.unit)) throw new AbsencePreviewError('unit_disabled');
  const startResolution = resolveAbsencePolicy(type, input.startDate, target);
  if (startResolution.status === 'ambiguous') throw new AbsencePreviewError('ambiguous');
  if (startResolution.status !== 'matched') throw new AbsencePreviewError('not_available');
  const lastAbsentDate = input.unit === 'day' && startResolution.policy.calculation === 'calendar_days_until_return'
    ? new Date((civilDay(input.endDate) - 1) * 86_400_000).toISOString().slice(0, 10)
    : input.endDate;
  if (lastAbsentDate < input.startDate) throw new AbsencePreviewError('invalid_period');
  if (input.startDate < type.validFrom || lastAbsentDate > (type.validTo ?? '9999-12-31')) throw new AbsencePreviewError('not_available');
  const endResolution = resolveAbsencePolicy(type, lastAbsentDate, target);
  if (endResolution.status === 'ambiguous') throw new AbsencePreviewError('ambiguous');
  if (endResolution.status !== 'matched' || startResolution.policy.id !== endResolution.policy.id) throw new AbsencePreviewError('not_available');
  const policy = startResolution.policy;
  const dayDistance = civilDay(input.startDate) - civilDay(today);
  if (policy.minimumNoticeDays !== undefined && dayDistance >= 0 && dayDistance < policy.minimumNoticeDays) throw new AbsencePreviewError('notice');
  if (dayDistance < -(policy.maximumRetroactiveDays ?? 0)) throw new AbsencePreviewError('retroactive');

  let value: number | null;
  if (input.unit === 'hour') {
    const start = civilDay(input.startDate) * 1440 + Number(input.startTime!.slice(0, 2)) * 60 + Number(input.startTime!.slice(3));
    const end = civilDay(input.endDate) * 1440 + Number(input.endTime!.slice(0, 2)) * 60 + Number(input.endTime!.slice(3));
    if (end <= start) throw new AbsencePreviewError('invalid_period');
    value = (end - start) / 60;
  } else if (policy.calculation === 'calendar_days_until_return') {
    value = civilDay(input.endDate) - civilDay(input.startDate);
    if (value <= 0) throw new AbsencePreviewError('invalid_period');
  } else if (policy.calculation === 'calendar_days') {
    value = civilDay(input.endDate) - civilDay(input.startDate) + 1;
  } else {
    value = null;
  }
  if (value !== null && policy.maxUnitsPerRequest !== undefined && value > policy.maxUnitsPerRequest) throw new AbsencePreviewError('maximum');
  const pending: AbsenceRequestPreview['pending'] = [
    'historical_profile_unverified', 'overlaps_unverified', 'approval_and_submission_unavailable',
  ];
  if (policy.maxUnitsPerPeriod !== undefined) pending.push('accumulated_balance_unverified');
  if (value === null) pending.push('scheduled_workdays_unavailable');
  if (input.unit === 'hour') pending.push('hour_schedule_unverified');
  if (policy.attachment === 'required') pending.push('document_required');
  return {
    previewOnly: true, canSubmit: false, source,
    absenceType: { id: type.id, name: type.name, lineageId: type.lineageId, version: type.version, validFrom: type.validFrom, validTo: type.validTo ?? null },
    rule: { id: policy.id, name: policy.name, snapshot: publicRule(policy) },
    period: { startDate: input.startDate, endDate: input.endDate, startTime: input.startTime ?? null, endTime: input.endTime ?? null },
    quantity: { value, unit: input.unit, calculation: policy.calculation },
    approvalFlow: policy.approvalFlow, tacitApprovalDays: policy.approvalFlow === 'automatic' ? null : policy.tacitApprovalDays ?? null,
    attachmentRequired: policy.attachment === 'required', instructions: policy.instructions ?? null,
    limits: { maxUnitsPerRequest: policy.maxUnitsPerRequest ?? null, maxUnitsPerPeriod: policy.maxUnitsPerPeriod ?? null, limitPeriod: policy.limitPeriod ?? null, remaining: null, minimumNoticeDays: policy.minimumNoticeDays ?? 0, maximumRetroactiveDays: policy.maximumRetroactiveDays ?? 0 },
    pending,
  };
}
