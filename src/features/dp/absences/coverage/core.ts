import type { DPJourneyValidationIssue } from '@/features/dp/journey-validation/core';

/** Descanso mínimo entre jornadas (CLT art. 66). */
export const MIN_REST_MINUTES = 11 * 60;
/** Janela de turnos lida antes e depois da data para dias seguidos e descanso. */
export const COVERAGE_HISTORY_DAYS = 13;

export type CoverageMode = 'cover' | 'closed' | 'understaffed';

export type CoverageShiftTime = { date: string; startTime: string; endTime: string };
export type CoverageAgendaShift = CoverageShiftTime & { type: 'work' | 'day_off' };

export type CoverageIssueCode =
  | 'DAY_OFF'
  | 'OVERLAP'
  | 'REST_UNDER_11_HOURS'
  | 'ABSENCE'
  | 'VACATION'
  | 'JOURNEY_NOT_FOUND'
  | 'JOURNEY_AMBIGUOUS'
  | 'JOURNEY_MANUAL_REVIEW'
  | 'MAX_CONSECUTIVE_DAYS_EXCEEDED'
  | 'SHIFT_NOT_ALLOWED'
  | 'SHIFT_SHORTER_THAN_JOURNEY';

export type CoverageIssue = { code: CoverageIssueCode; blocking: boolean; message: string };

export type CoverageEligibility = {
  eligible: boolean;
  /** Primeira razão de bloqueio ou o contexto do dia quando elegível. */
  summary: string;
  issues: CoverageIssue[];
};

const DAY_MINUTES = 1440;

function dayIndex(date: string) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function minutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Intervalo absoluto em minutos; turnos que terminam antes de começar atravessam a meia-noite. */
export function shiftInterval(shift: CoverageShiftTime) {
  const start = dayIndex(shift.date) * DAY_MINUTES + minutes(shift.startTime);
  const rawEnd = dayIndex(shift.date) * DAY_MINUTES + minutes(shift.endTime);
  return { start, end: rawEnd > start ? rawEnd : rawEnd + DAY_MINUTES };
}

export function formatCoverageDate(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function formatGap(value: number) {
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

/** Folga, choque de horário e descanso entre jornadas a partir da agenda já gravada da pessoa. */
export function evaluateCoverageAgenda(target: CoverageShiftTime, agenda: CoverageAgendaShift[]): CoverageIssue[] {
  const issues: CoverageIssue[] = [];
  const wanted = shiftInterval(target);
  if (agenda.some((shift) => shift.type === 'day_off' && shift.date === target.date)) {
    issues.push({ code: 'DAY_OFF', blocking: true, message: 'Folga confirmada nesse dia' });
  }
  const work = agenda.filter((shift) => shift.type === 'work');
  const overlap = work.find((shift) => {
    const current = shiftInterval(shift);
    return current.start < wanted.end && wanted.start < current.end;
  });
  if (overlap) {
    const when = overlap.date === target.date ? 'nesse dia' : `em ${formatCoverageDate(overlap.date)}`;
    issues.push({ code: 'OVERLAP', blocking: true, message: `Já trabalha das ${overlap.startTime} às ${overlap.endTime} ${when}` });
  }
  const shortestGap = work.reduce<number | null>((smallest, shift) => {
    const current = shiftInterval(shift);
    if (current.start < wanted.end && wanted.start < current.end) return smallest;
    const gap = current.end <= wanted.start ? wanted.start - current.end : current.start - wanted.end;
    return smallest === null || gap < smallest ? gap : smallest;
  }, null);
  if (!overlap && shortestGap !== null && shortestGap < MIN_REST_MINUTES) {
    issues.push({ code: 'REST_UNDER_11_HOURS', blocking: true, message: `Descanso de ${formatGap(shortestGap)} entre turnos; o mínimo é 11h` });
  }
  return issues;
}

const journeyMessages: Partial<Record<DPJourneyValidationIssue['code'], string>> = {
  JOURNEY_NOT_FOUND: 'Sem jornada vigente nesse dia',
  JOURNEY_AMBIGUOUS: 'Mais de uma jornada se aplica; corrija o cadastro da jornada',
  JOURNEY_MANUAL_REVIEW: 'Jornada em revisão manual: confira a escala antes',
  SHIFT_NOT_ALLOWED: 'Esse turno não é permitido na jornada da pessoa',
  SHIFT_SHORTER_THAN_JOURNEY: 'O turno é menor que a jornada, e a jornada não aceita turno menor',
};

function journeyIssueKey(issue: DPJourneyValidationIssue) {
  return `${issue.code}:${issue.date ?? ''}`;
}

/**
 * Problemas de jornada causados pela cobertura: compara a validação da escala da pessoa sem e com o turno novo,
 * para não culpar a cobertura por uma violação que já existia.
 */
export function coverageJourneyIssues(before: DPJourneyValidationIssue[], after: DPJourneyValidationIssue[]): CoverageIssue[] {
  const existing = new Set(before.map(journeyIssueKey));
  const seen = new Set<string>();
  return after.flatMap((issue): CoverageIssue[] => {
    if (existing.has(journeyIssueKey(issue)) || seen.has(issue.code)) return [];
    seen.add(issue.code);
    if (issue.code === 'MAX_CONSECUTIVE_DAYS_EXCEEDED') {
      const match = /^(\d+) dias consecutivos; a jornada permite no máximo (\d+)/.exec(issue.message);
      const message = match ? `Seria o ${match[1]}º dia seguido; a jornada permite ${match[2]}` : issue.message;
      return [{ code: issue.code, blocking: true, message }];
    }
    return [{ code: issue.code, blocking: issue.blocking, message: journeyMessages[issue.code] ?? issue.message }];
  });
}

export function summarizeCoverageEligibility(issues: CoverageIssue[], agenda: CoverageAgendaShift[], target: CoverageShiftTime): CoverageEligibility {
  const blocking = issues.find((issue) => issue.blocking);
  if (blocking) return { eligible: false, summary: blocking.message, issues };
  const warning = issues.find((issue) => !issue.blocking);
  const sameDay = agenda.some((shift) => shift.type === 'work' && shift.date === target.date);
  return {
    eligible: true,
    summary: warning?.message ?? (sameDay ? 'Já tem outro turno nesse dia, sem choque' : 'Sem turno nesse dia'),
    issues,
  };
}

export const COVERAGE_MODE_LABELS: Record<CoverageMode, string> = {
  cover: 'Coberto',
  closed: 'Quiosque fechado nesse turno',
  understaffed: 'Desfalque: operação com uma pessoa a menos',
};
