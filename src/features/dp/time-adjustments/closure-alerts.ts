import type { DayIncident } from '../rep-p/day-model';

export const alertLabels: Partial<Record<DayIncident, string>> = {
  missing: 'Dia escalado sem batida',
  odd: 'Número ímpar de batidas',
  missing_break: 'Intervalo sem registro completo',
  short_break: 'Intervalo abaixo do previsto',
};

export type ClosureAlert = {
  employeeUid: string; date: string; incidents: DayIncident[]; fingerprint: string; unitIds: string[];
};
export type ClosureAlertDecision = ClosureAlert & { by: string; at: string; reason: string };
export type ReviewableAlert = ClosureAlert & { canJustify: boolean; decision: ClosureAlertDecision | null };
