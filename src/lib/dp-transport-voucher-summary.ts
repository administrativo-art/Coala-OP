import type { DPSchedule, DPShift } from '@/types';
import { hasPublishedScheduleVersion } from '@/lib/dp-schedule-publication';

type TransportVoucherUser = {
  id: string;
  username: string;
  needsTransportVoucher?: boolean;
  transportVoucherValue?: number;
};

export type MonthlyTransportVoucherPerson = {
  userId: string;
  name: string;
  days: number;
  amountCents: number;
};

export type MonthlyTransportVoucherSummary = {
  period: string;
  totalCents: number;
  people: MonthlyTransportVoucherPerson[];
};

type VoucherDay = {
  period: string;
  userId: string;
  date: string;
  name: string;
  amountCents: number;
  frozen: boolean;
};

function schedulePeriod(schedule: Pick<DPSchedule, 'year' | 'month'>) {
  return `${schedule.year}-${String(schedule.month).padStart(2, '0')}`;
}

/**
 * Consolida o VT por colaboradora e dia trabalhado em todas as unidades do mês.
 * Escalas publicadas com snapshot usam os dados congelados na publicação.
 */
export function buildMonthlyTransportVoucherSummaries({
  schedules,
  shifts,
  users,
}: {
  schedules: DPSchedule[];
  shifts: DPShift[];
  users: TransportVoucherUser[];
}) {
  const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const uniqueDays = new Map<string, VoucherDay>();

  shifts.forEach((shift) => {
    if (shift.type !== 'work') return;
    const schedule = scheduleById.get(shift.scheduleId);
    if (!schedule) return;
    const period = schedulePeriod(schedule);
    if (!shift.date.startsWith(`${period}-`)) return;

    const liveUser = userById.get(shift.userId);
    const snapshotUser = hasPublishedScheduleVersion(schedule) ? schedule.snapshot?.users?.[shift.userId] : undefined;
    const source = snapshotUser ?? liveUser;
    if (!source?.needsTransportVoucher || !source.transportVoucherValue || source.transportVoucherValue <= 0) return;

    const candidate: VoucherDay = {
      period,
      userId: shift.userId,
      date: shift.date,
      name: source.username || shift.userName || liveUser?.username || shift.userId,
      amountCents: Math.round(source.transportVoucherValue * 100),
      frozen: Boolean(snapshotUser),
    };
    const key = `${period}:${shift.userId}:${shift.date}`;
    const current = uniqueDays.get(key);
    if (!current || (!current.frozen && candidate.frozen)) uniqueDays.set(key, candidate);
  });

  const byPeriod = new Map<string, Map<string, MonthlyTransportVoucherPerson>>();
  uniqueDays.forEach((day) => {
    if (!byPeriod.has(day.period)) byPeriod.set(day.period, new Map());
    const people = byPeriod.get(day.period)!;
    const person = people.get(day.userId) ?? {
      userId: day.userId,
      name: day.name,
      days: 0,
      amountCents: 0,
    };
    person.days += 1;
    person.amountCents += day.amountCents;
    people.set(day.userId, person);
  });

  return new Map(Array.from(byPeriod.entries()).map(([period, people]) => {
    const rows = Array.from(people.values()).sort((left, right) => (
      right.amountCents - left.amountCents || left.name.localeCompare(right.name, 'pt-BR')
    ));
    return [period, {
      period,
      totalCents: rows.reduce((sum, person) => sum + person.amountCents, 0),
      people: rows,
    } satisfies MonthlyTransportVoucherSummary] as const;
  }));
}
