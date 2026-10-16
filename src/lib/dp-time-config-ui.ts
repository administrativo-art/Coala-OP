import type {
  DPJourney,
  DPJourneyDay,
  DPOvertimePolicy,
  DPTimeApplicability,
  DPTimeConfigStatus,
} from '@/types';

const WEEKDAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export function parseDuration(value: string): number | null {
  const match = value.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

/** Keeps duration fields in the visual HH:MM shape while the person types or pastes digits. */
export function maskDurationInput(value: string) {
  const compact = value.replace(/[^\d:]/g, '');
  if (compact.includes(':')) {
    const [rawHours = '', rawMinutes = ''] = compact.split(':');
    return `${rawHours.replace(/\D/g, '').slice(0, 3)}:${rawMinutes.replace(/\D/g, '').slice(0, 2)}`;
  }
  const digits = compact.replace(/\D/g, '').slice(0, 5);
  if (digits.length <= 2) return digits;
  const hourDigits = digits.length === 5 ? 3 : 2;
  return `${digits.slice(0, hourDigits)}:${digits.slice(hourDigits)}`;
}

export function parseCycleLengthDaysInput(value: string): number | null {
  if (!/^\d{1,2}$/.test(value)) return null;
  const days = Number(value);
  return days >= 1 && days <= 42 ? days : null;
}

export function formatDuration(minutes: number | undefined | null) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(safeMinutes / 60)).padStart(2, '0')}:${String(safeMinutes % 60).padStart(2, '0')}`;
}

/** Referência mensal brasileira: a carga semanal multiplicada por cinco (44h → 220h). */
export function monthlyWorkloadMinutes(weeklyMinutes: number) {
  return Math.max(0, Math.round(weeklyMinutes)) * 5;
}

export function formatCalendarDateBR(value: string | undefined | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return value?.trim() || '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatValidityBR(validFrom: string, validTo?: string) {
  return validTo
    ? `${formatCalendarDateBR(validFrom)} a ${formatCalendarDateBR(validTo)}`
    : `${formatCalendarDateBR(validFrom)} em diante`;
}

export function buildJourneyDays(cycleLengthDays: number, current: DPJourneyDay[] = []) {
  return Array.from({ length: cycleLengthDays }, (_, index) => {
    const dayIndex = index + 1;
    return current.find((day) => day.dayIndex === dayIndex) ?? {
      dayIndex,
      plannedMinutes: 0,
      isRestDay: true,
    };
  });
}

export function journeyDayLabel(dayIndex: number, cycleLengthDays: number) {
  if (cycleLengthDays === 7) return `${dayIndex} · ${WEEKDAY_LABELS[dayIndex - 1]}`;
  return `Dia ${dayIndex}`;
}

export function weeklyRestPlacementLabel(weeklyRest: DPJourney['weeklyRest']) {
  return weeklyRest?.placement === 'schedule' ? 'Definido na escala' : 'Posição fixa no ciclo';
}

export function journeyDistributionLabel(
  day: DPJourneyDay,
  cycleLengthDays: number,
  weeklyRest: DPJourney['weeklyRest'],
  workOrdinal: number,
  restOrdinal: number,
) {
  if (weeklyRest?.placement !== 'schedule') return journeyDayLabel(day.dayIndex, cycleLengthDays);
  return day.isRestDay ? `DSR móvel ${restOrdinal}` : `Dia de trabalho ${workOrdinal}`;
}

export function journeyCycleMatchesWeeklyLoad(weeklyMinutes: number, cycleLengthDays: number, days: DPJourneyDay[]) {
  const cycleMinutes = days.reduce((total, day) => total + day.plannedMinutes, 0);
  return cycleMinutes * 7 === weeklyMinutes * cycleLengthDays;
}

export function journeyRegimeLabel(regime: DPJourney['regime']) {
  if (regime?.mode === 'flexible') return 'Flexível';
  return 'Fixa';
}

export function journeyRegimeDescription(regime: DPJourney['regime']) {
  if (regime?.mode === 'flexible') return 'Apura a quantidade trabalhada prevista na jornada, sem exigir os horários exatos do turno.';
  return 'Compara as batidas com a entrada, a saída e os intervalos do turno escalado.';
}

export function timeConfigStatusLabel(status: DPTimeConfigStatus) {
  if (status === 'published') return 'Publicado';
  if (status === 'archived') return 'Arquivado';
  return 'Rascunho';
}

export function applicabilityLabel(
  applicability: DPTimeApplicability,
  options: {
    unitNames?: ReadonlyMap<string, string>;
    unitGroupNames?: ReadonlyMap<string, string>;
    unitOrganizationNames?: ReadonlyMap<string, string>;
  } = {},
) {
  const { scope } = applicability;
  let label = 'Toda a empresa';
  if (scope.kind === 'unit') label = options.unitNames?.get(scope.id) ?? 'Unidade específica';
  if (scope.kind === 'unit_group') label = options.unitGroupNames?.get(scope.id) ?? 'Grupo de unidades';
  if (scope.kind === 'unit_organization') label = options.unitOrganizationNames?.get(scope.id) ?? 'Organização';

  const filters = [
    applicability.jobRoleIds?.length ? `${applicability.jobRoleIds.length} cargo(s)` : null,
    applicability.jobFunctionIds?.length ? `${applicability.jobFunctionIds.length} função(ões)` : null,
    applicability.collaboratorIds?.length ? `${applicability.collaboratorIds.length} pessoa(s)` : null,
  ].filter(Boolean);
  return filters.length ? `${label} · ${filters.join(' · ')}` : label;
}

export function externalCoverageRuleLabel(rule: DPOvertimePolicy['externalCoverageRule']) {
  if (rule === 'execution_unit') return 'Regra da unidade de execução';
  if (rule === 'manual_review') return 'Revisão manual';
  return 'Regra da unidade de origem';
}
