import { COVERAGE_LONG_DAY_MINUTES, coverageOf, INCIDENT_SEVERITY, pauseLengths, plannedBreakMinutesOf, toleranceOf, type DayIncident, type DayView } from '../rep-p/day-model';

/** A stricter display warning must not activate new payroll consequences before rollout. */
export function blockingClosureIncidents(day: DayView, policyRulesActive: boolean): DayIncident[] {
  const expectedBreak = plannedBreakMinutesOf(day.shift);
  const legacyShortBreak = day.breakMinutes !== null && expectedBreak > 0 && day.breakMinutes < expectedBreak - toleranceOf(day.shift)
    || Boolean(day.shift?.breakMinPauseMinutes && pauseLengths(day.markings).some(length => length < day.shift!.breakMinPauseMinutes!));
  const coverageShortBreak = Boolean(coverageOf(day.shift, day.manualSegments ?? [])) && day.workedMinutes > COVERAGE_LONG_DAY_MINUTES;
  return day.incidents.filter(incident => INCIDENT_SEVERITY[incident] === 'danger'
    && (incident !== 'short_break' || policyRulesActive || legacyShortBreak || coverageShortBreak));
}

export const alertLabels: Partial<Record<DayIncident, string>> = {
  missing: 'Dia escalado sem batida',
  odd: 'Número ímpar de batidas',
  missing_break: 'Intervalo sem registro completo',
  short_break: 'Intervalo abaixo do previsto',
  coverage_early_exit: 'Saída antes do fim da cobertura',
};

export type ClosureAlert = {
  employeeUid: string; date: string; incidents: DayIncident[]; fingerprint: string; unitIds: string[];
};
export type ClosureAlertDecision = ClosureAlert & { by: string; at: string; reason: string };
export type ReviewableAlert = ClosureAlert & { canJustify: boolean; decision: ClosureAlertDecision | null };
