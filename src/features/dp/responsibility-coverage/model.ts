import type { DPResponsibilityActivity } from '@/types';

export const RESPONSIBILITY_ACTIVITY_LABELS: Record<DPResponsibilityActivity, string> = {
  schedules: 'Escalas',
  vacations: 'Férias',
  absences: 'Ausências',
};

export type ResponsibilityCoverageStatus = 'covered' | 'warning' | 'uncovered' | 'draft';

export function responsibilityCoverageStatus(input: {
  configured: boolean;
  active: boolean;
  eligibleCount: number;
  invalidConfiguredLevelCount: number;
}): ResponsibilityCoverageStatus {
  if (!input.configured || !input.active) return 'draft';
  if (input.eligibleCount === 0) return 'uncovered';
  return input.invalidConfiguredLevelCount > 0 ? 'warning' : 'covered';
}
