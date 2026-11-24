import { bankLinesWithMovements, type BankIssue, type BankManualMovement, type BankMonthRecord } from './core';

export type PayrollPersonStatus = {
  uid: string; status: 'ready' | 'missing' | 'failed' | 'outdated' | 'review'; reason: string;
};
export type PayrollReadiness = { competence: string; version: number | null; ready: boolean; total: number; readyCount: number; people: PayrollPersonStatus[] };

const issueLabels: Partial<Record<BankIssue, string>> = {
  MISSING_DAY: 'dia sem cobertura de ponto ou ausência', ODD_MARKINGS: 'batidas sem par',
  NO_JOURNEY: 'jornada não definida', NO_POLICY: 'política de horas não definida',
  HOLIDAY_SCHEDULED: 'feriado com escala a conferir', WORK_ON_ABSENCE: 'trabalho durante ausência',
  ABSENCE_REVIEW: 'ausência com tratamento pendente',
};

export function payrollReviewReason(month: BankMonthRecord, movements: BankManualMovement[], previous?: BankMonthRecord): string | null {
  const reasons = new Set<string>();
  for (const day of month.days) {
    if (day.kind !== 'workday' && !day.workedMinutes && !day.lines.length && !day.issues.includes('ODD_MARKINGS')) continue;
    for (const issue of day.issues) {
      const label = issueLabels[issue];
      if (label) reasons.add(label);
    }
  }
  for (const item of bankLinesWithMovements(previous ? [previous, month] : [month], movements)) {
    if (item.competence !== month.competence || item.line.nature !== 'review') continue;
    reasons.add(item.line.reason === 'pending_approval' ? 'hora extra aguardando aprovação' : 'lançamento aguardando revisão');
  }
  return reasons.size ? [...reasons].join(' · ') : null;
}
