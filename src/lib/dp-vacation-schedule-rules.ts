import type { DPVacationRecord } from '@/types';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(year: number, month: number, day: number) {
  return [year, month, day].map((part, index) => (
    index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0')
  )).join('-');
}

export function vacationQueryWindow(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Competência da escala inválida.');
  }

  const monthEndDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const followingMonthEnd = new Date(Date.UTC(year, month + 1, 0));

  return {
    monthStart: isoDate(year, month, 1),
    monthEnd: isoDate(year, month, monthEndDay),
    queryEnd: isoDate(
      followingMonthEnd.getUTCFullYear(),
      followingMonthEnd.getUTCMonth() + 1,
      followingMonthEnd.getUTCDate(),
    ),
  };
}

function isValidISODate(value: string | undefined): value is string {
  if (!value || !ISO_DATE_PATTERN.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isApprovedVacationPeriod(
  vacation: DPVacationRecord,
): vacation is DPVacationRecord & { startDate: string; endDate: string } {
  return vacation.status === 'APPROVED'
    && vacation.recordType === 'gozo'
    && isValidISODate(vacation.startDate)
    && isValidISODate(vacation.endDate)
    && vacation.startDate <= vacation.endDate;
}

export type ApprovedVacationPeriod = DPVacationRecord & { startDate: string; endDate: string };
export type ApprovedVacationIndex = Map<string, ApprovedVacationPeriod[]>;

export function buildApprovedVacationIndex(vacations: DPVacationRecord[]): ApprovedVacationIndex {
  const index: ApprovedVacationIndex = new Map();

  vacations.forEach((vacation) => {
    if (!isApprovedVacationPeriod(vacation)) return;
    const periods = index.get(vacation.userId) ?? [];
    periods.push(vacation);
    index.set(vacation.userId, periods);
  });

  index.forEach((periods) => periods.sort((left, right) => left.startDate.localeCompare(right.startDate)));
  return index;
}

export function findApprovedVacationInIndex(
  index: ApprovedVacationIndex,
  userId: string,
  date: string,
) {
  if (!userId || !isValidISODate(date)) return null;
  return index.get(userId)?.find((vacation) =>
    vacation.startDate <= date && vacation.endDate >= date
  ) ?? null;
}

export function findApprovedVacationForDate(
  vacations: DPVacationRecord[],
  userId: string,
  date: string,
) {
  return findApprovedVacationInIndex(buildApprovedVacationIndex(vacations), userId, date);
}

export function formatVacationPeriod(vacation: Pick<DPVacationRecord, 'startDate' | 'endDate'>) {
  const formatDate = (value: string | undefined) => {
    if (!isValidISODate(value)) return '';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  };

  return `${formatDate(vacation.startDate)} a ${formatDate(vacation.endDate)}`;
}
