export const ABSENCE_REVIEW_SLA_HOURS = 24 as const;

export type AbsenceReviewSla = {
  hours: typeof ABSENCE_REVIEW_SLA_HOURS;
  startedAt: string;
  deadlineAt: string;
};

export function createAbsenceReviewSla(startedAt: string): AbsenceReviewSla {
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) throw new TypeError('Início do prazo de análise inválido.');
  return {
    hours: ABSENCE_REVIEW_SLA_HOURS,
    startedAt: start.toISOString(),
    deadlineAt: new Date(start.getTime() + ABSENCE_REVIEW_SLA_HOURS * 60 * 60 * 1_000).toISOString(),
  };
}

export function isAbsenceReviewOverdue(value: AbsenceReviewSla | null | undefined, now: Date = new Date()) {
  if (!value) return false;
  const deadline = new Date(value.deadlineAt).getTime();
  return Number.isFinite(deadline) && deadline <= now.getTime();
}
