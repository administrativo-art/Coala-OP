export type DPSchedulePeriod = {
  period: string;
  year: number;
  month: number;
};

export function formatDPSchedulePeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function buildDPScheduleDocumentId(year: number, month: number, canonicalUnitId: string) {
  return `${formatDPSchedulePeriod(year, month)}--${encodeURIComponent(canonicalUnitId)}`;
}

export function parseDPSchedulePeriod(value: string): DPSchedulePeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2020 || month < 1 || month > 12) return null;

  return { period: formatDPSchedulePeriod(year, month), year, month };
}

export function getAutomaticDPSchedulePeriods(
  referenceDate = new Date(),
  count = 2,
): DPSchedulePeriod[] {
  const safeCount = Math.max(0, Math.floor(count));
  return Array.from({ length: safeCount }, (_, offset) => {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + offset, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return { period: formatDPSchedulePeriod(year, month), year, month };
  });
}
