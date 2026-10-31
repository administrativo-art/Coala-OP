import { FieldValue, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { readOfficialScheduleShifts, type OfficialShift } from './official-schedule.js';
import './app-init.js';

const MAX_PERIODS = 100;
const MAX_GOALS = 500;
const MAX_MONTHS = 24;

function day(value: unknown): string | null {
  const date = value && typeof (value as { toDate?: unknown }).toDate === 'function'
    ? (value as { toDate(): Date }).toDate() : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function monthsBetween(start: string, end: string) {
  const result: Array<{ year: number; month: number }> = [];
  let [year, month] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    result.push({ year, month });
    if (result.length > MAX_MONTHS) throw new Error('Goal period spans too many months.');
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return result;
}

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/quiosque\s*|quisque\s*|centro de distribuicao\s*/g, '')
    .replace(/[-–_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sameUnit(kioskName: string, unitName: string) {
  const kiosk = normalize(kioskName); const unit = normalize(unitName);
  return Boolean(kiosk && unit && (kiosk === unit || kiosk.includes(unit) || unit.includes(kiosk)));
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function fuzzyUnit(kioskName: string, unitName: string) {
  const kiosk = normalize(kioskName); const unit = normalize(unitName);
  if (!kiosk || !unit) return false;
  return editDistance(kiosk, unit) <= Math.max(3, Math.floor(Math.max(kiosk.length, unit.length) * 0.25));
}

function shiftMatchesGoal(shift: OfficialShift, goal: QueryDocumentSnapshot, periodShifts: Array<Record<string, unknown>>) {
  const shiftId = goal.get('shiftId');
  if (!shiftId) return true;
  const configured = periodShifts.find((item) => item.id === shiftId);
  if (!configured || typeof configured.label !== 'string') return false;
  const match = configured.label.match(/\((\d{2}:\d{2})[–\-](\d{2}:\d{2})\)/u);
  return Boolean(match && match[1] === shift.startTime && match[2] === shift.endTime);
}

export function calculateScheduledTargets(period: Record<string, unknown>, goals: QueryDocumentSnapshot[], shifts: OfficialShift[],
  start: string, end: string) {
  const periodShifts = Array.isArray(period.shifts) ? period.shifts as Array<Record<string, unknown>> : [];
  const dateGoals = new Map<string, Set<string>>();
  for (const shift of shifts) {
    if (shift.type !== 'work' || shift.countsTowardGoals === false || shift.date < start || shift.date > end) continue;
    for (const goal of goals) {
      if (goal.get('employeeId') !== shift.userId || !shiftMatchesGoal(shift, goal, periodShifts)) continue;
      const key = `${goal.get('shiftId') ?? '__legacy__'}:${shift.date}`;
      const group = dateGoals.get(key) ?? new Set<string>();
      group.add(goal.id);
      dateGoals.set(key, group);
    }
  }
  const targets = new Map<string, { targetValue: number; fraction: number }>();
  const targetValue = Number(period.targetValue);
  if (!Number.isFinite(targetValue) || targetValue < 0) throw new Error('Goal period target invalid.');
  const groups = periodShifts.length ? periodShifts : [{ id: '__legacy__', fraction: 1 }];
  for (const goal of goals) targets.set(goal.id, { targetValue: 0, fraction: 0 });
  for (const group of groups) {
    const groupId = String(group.id);
    const fraction = Number(group.fraction);
    if (!Number.isFinite(fraction) || fraction < 0) throw new Error('Goal shift fraction invalid.');
    const dates = [...dateGoals].filter(([key]) => key.startsWith(`${groupId}:`));
    for (const [, goalIds] of dates) {
      const share = targetValue * fraction / dates.length / goalIds.size;
      for (const id of goalIds) {
        const previous = targets.get(id)?.targetValue ?? 0;
        targets.set(id, { targetValue: previous + share, fraction: 0 });
      }
    }
    for (const goal of goals) {
      if ((goal.get('shiftId') ?? '__legacy__') !== groupId) continue;
      const amount = targets.get(goal.id)?.targetValue ?? 0;
      const denominator = targetValue * fraction;
      targets.set(goal.id, { targetValue: amount, fraction: denominator > 0 ? amount / denominator : Number(goal.get('fraction') ?? 0) });
    }
  }
  return targets;
}

export async function reconcileScheduleGoals(db: Firestore, scheduleId: string) {
  const schedule = await db.collection('dp_schedules').doc(scheduleId).get();
  if (!schedule.exists || !schedule.get('unitId')) return;
  const unit = await db.collection('dp_units').doc(String(schedule.get('unitId'))).get();
  if (!unit.exists) return;
  const kiosks = await db.collection('kiosks').limit(501).get();
  if (kiosks.size > 500) throw new Error('Too many kiosks to map goal schedule.');
  const unitName = String(unit.get('name') ?? '');
  const exact = kiosks.docs.filter((item) => sameUnit(String(item.get('name') ?? ''), unitName));
  const matching = exact.length ? exact : kiosks.docs.filter((item) => fuzzyUnit(String(item.get('name') ?? ''), unitName));
  if (!matching.length) return;
  if (matching.length !== 1) throw new Error(`Goal kiosk mapping ambiguous for schedule ${scheduleId}.`);
  const periods = await db.collection('goalPeriods').where('kioskId', '==', matching[0].id).where('status', '==', 'active').limit(MAX_PERIODS + 1).get();
  if (periods.size > MAX_PERIODS) throw new Error('Too many active goal periods.');
  const year = Number(schedule.get('year')); const month = Number(schedule.get('month'));
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  for (const period of periods.docs) {
    if (period.get('version') === 2 || period.get('distributionMode') !== 'scheduled_days') continue;
    const start = day(period.get('startDate')); const end = day(period.get('endDate'));
    if (!start || !end || monthKey < start.slice(0, 7) || monthKey > end.slice(0, 7)) continue;
    const template = await db.collection('goalTemplates').doc(String(period.get('templateId') ?? '')).get();
    if (template.exists && template.get('type') !== 'revenue') continue;
    const goals = await db.collection('employeeGoals').where('periodId', '==', period.id).limit(MAX_GOALS + 1).get();
    if (goals.size > MAX_GOALS) throw new Error('Too many employee goals for a period.');
    if (goals.empty) continue;
    const shifts: OfficialShift[] = [];
    for (const item of monthsBetween(start.slice(0, 7), end.slice(0, 7))) {
      const candidates = await db.collection('dp_schedules').where('unitId', '==', unit.id)
        .where('year', '==', item.year).where('month', '==', item.month).limit(2).get();
      if (candidates.size > 1) throw new Error('Duplicate schedule for goal competence.');
      if (candidates.empty) continue;
      shifts.push(...await readOfficialScheduleShifts(db, candidates.docs[0]));
    }
    const targets = calculateScheduledTargets(period.data(), goals.docs, shifts, start, end);
    const latest = await schedule.ref.get();
    if (latest.get('goalEligibilityVersion') !== schedule.get('goalEligibilityVersion')) {
      throw new Error('Schedule changed during goal rebalance.');
    }
    const batch = db.batch();
    for (const [id, target] of targets) batch.update(db.collection('employeeGoals').doc(id), {
      ...target, updatedAt: FieldValue.serverTimestamp(),
    });
    if (targets.size) await batch.commit();
  }
}

export const onScheduleGoalEligibilityChange = onDocumentWritten({ document: 'dp_schedules/{scheduleId}', database: 'coala', retry: true },
  async (event) => {
    const before = event.data?.before; const after = event.data?.after;
    if (!after?.exists || before?.get('goalEligibilityVersion') === after.get('goalEligibilityVersion')) return;
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore('coala');
    await reconcileScheduleGoals(db, event.params.scheduleId);
    if (after.get('publicationVersion') !== before?.get('publicationVersion')) {
      const eventRef = db.collection('dp_scheduleRevisionEvents').doc(`${event.params.scheduleId}_${after.get('publicationVersion')}`);
      const revisionEvent = await eventRef.get();
      if (revisionEvent.exists && revisionEvent.get('status') === 'pending') {
        await eventRef.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() });
      }
    }
  });
