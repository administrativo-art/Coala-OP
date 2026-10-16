import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const interval = z.object({ date, fromMinute: z.number().int().min(0).max(1439),
  toMinute: z.number().int().min(1).max(1440) }).strict().refine((value) => value.fromMinute < value.toMinute);
const projection = z.object({ id, requestId: id, workspaceId: id, beneficiaryUid: id, unitId: id,
  requestVersion: z.number().int().positive(), revision: z.number().int().positive(),
  fenceId: z.string().uuid(), epoch: z.string().uuid(), state: z.enum(['prepared', 'active', 'tombstone']),
  blocksSchedule: z.boolean(), startDate: date, endDate: date,
  intervals: z.array(interval).min(1).max(180) }).passthrough();
const request = z.object({ id, workspaceId: id, beneficiaryUid: id, unitId: id,
  startDate: date, endDate: date, version: z.number().int().positive(), revision: z.number().int().positive(),
  segments: z.array(z.object({ date, fromMinute: z.number().int(), toMinute: z.number().int() }).passthrough()).min(1).max(180),
  status: z.string(), operationalPending: z.unknown().optional(),
  operationalFence: z.object({ state: z.string(), fenceId: z.string(), requestVersion: z.number().int() }).passthrough().nullable().optional(),
}).passthrough();

export type NatashaApprovedAbsence = { id: string; employeeId: string; employeeName: string;
  unitId: string; startDate: string; endDate: string;
  intervals: Array<{ date: string; fromMinute: number; toMinute: number }> };
export type NatashaOperationalIssue = 'ABSENCE_SOURCE_INCOMPLETE' | 'ABSENCE_PENDING' | 'ABSENCE_INCONSISTENT';

/** Pure, conservative join. A missing or divergent RH ack never becomes availability. */
export function assessNatashaOperationalAvailability(input: {
  workspaceId: string; epoch: string | null; sourceReady: boolean;
  from: string; through: string; candidates: Array<{ id: string; name: string; allowedUnitIds: string[] }>;
  projections: Array<Record<string, unknown>>; requests: Array<Record<string, unknown>>;
}): { approvedAbsences: NatashaApprovedAbsence[]; issues: NatashaOperationalIssue[] } {
  const issues = new Set<NatashaOperationalIssue>();
  const approvedAbsences: NatashaApprovedAbsence[] = [];
  if (!input.sourceReady || !input.epoch || !z.string().uuid().safeParse(input.epoch).success) {
    return { approvedAbsences, issues: ['ABSENCE_SOURCE_INCOMPLETE'] };
  }
  const people = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const projectionById = new Map<string, z.infer<typeof projection>>();
  for (const raw of input.projections) {
    const parsed = projection.safeParse(raw);
    if (!parsed.success) { issues.add('ABSENCE_INCONSISTENT'); continue; }
    const value = parsed.data;
    if (projectionById.has(value.id) || value.id !== value.requestId
      || value.workspaceId !== input.workspaceId || value.epoch !== input.epoch
      || !people.get(value.beneficiaryUid)?.allowedUnitIds.includes(value.unitId)
      || value.startDate > value.endDate || value.intervals[0]?.date !== value.startDate
      || value.intervals.at(-1)?.date !== value.endDate
      || value.intervals.some((part, index) => index > 0 && part.date <= value.intervals[index - 1].date
        || part.date < value.startDate || part.date > value.endDate)) {
      issues.add('ABSENCE_INCONSISTENT'); continue;
    }
    projectionById.set(value.id, value);
  }
  const seenRequests = new Set<string>();
  for (const raw of input.requests) {
    const parsed = request.safeParse(raw);
    if (!parsed.success) { issues.add('ABSENCE_INCONSISTENT'); continue; }
    const value = parsed.data;
    const person = people.get(value.beneficiaryUid);
    if (seenRequests.has(value.id) || value.workspaceId !== input.workspaceId
      || !person?.allowedUnitIds.includes(value.unitId) || value.startDate > value.endDate) {
      issues.add('ABSENCE_INCONSISTENT'); continue;
    }
    seenRequests.add(value.id);
    const source = projectionById.get(value.id);
    if (value.operationalPending || source?.state === 'prepared') { issues.add('ABSENCE_PENDING'); continue; }
    if (value.status === 'approved') {
      if (!source || source.state !== 'active' || !value.operationalFence
        || value.operationalFence.state !== 'active' || source.requestVersion !== value.version
        || source.revision !== value.revision
        || source.fenceId !== value.operationalFence.fenceId
        || source.requestVersion !== value.operationalFence.requestVersion
        || source.beneficiaryUid !== value.beneficiaryUid || source.unitId !== value.unitId
        || source.startDate !== value.segments[0].date
        || source.endDate !== value.segments[value.segments.length - 1].date
        || JSON.stringify(source.intervals) !== JSON.stringify(value.segments.map((segment) => ({
          date: segment.date, fromMinute: segment.fromMinute, toMinute: segment.toMinute })))) {
        issues.add('ABSENCE_INCONSISTENT'); continue;
      }
      if (source.blocksSchedule && source.intervals.some((part) => part.date >= input.from && part.date <= input.through)) {
        approvedAbsences.push({ id: source.id, employeeId: person.id, employeeName: person.name,
          unitId: source.unitId, startDate: source.startDate, endDate: source.endDate,
          intervals: source.intervals.filter((part) => part.date >= input.from && part.date <= input.through) });
      }
    } else if (value.status === 'cancelled') {
      if (!source || source.state !== 'tombstone' || value.operationalFence?.state !== 'reversed'
        || source.fenceId !== value.operationalFence.fenceId) issues.add('ABSENCE_PENDING');
    } else if (['submitted', 'in_review', 'adjustments_requested'].includes(value.status)) {
      issues.add('ABSENCE_PENDING');
    } else if (source?.state === 'active') {
      issues.add('ABSENCE_INCONSISTENT');
    }
  }
  for (const source of projectionById.values()) {
    if (!seenRequests.has(source.id)) issues.add('ABSENCE_INCONSISTENT');
  }
  // Approved active intervals for the same person cannot overlap. Any divergence is source failure.
  const ordered = approvedAbsences.flatMap((item) => item.intervals.map((part) => ({ ...part, id: item.id, uid: item.employeeId })))
    .sort((a, b) => a.uid.localeCompare(b.uid) || a.date.localeCompare(b.date) || a.fromMinute - b.fromMinute);
  for (let index = 1; index < ordered.length; index += 1) {
    const left = ordered[index - 1]; const right = ordered[index];
    if (left.uid === right.uid && left.date === right.date && right.fromMinute < left.toMinute) {
      issues.add('ABSENCE_INCONSISTENT');
    }
  }
  return { approvedAbsences: issues.size > 0 ? [] : approvedAbsences,
    issues: [...issues] };
}
