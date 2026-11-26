import { INCIDENT_SEVERITY, type DayIncident, type DayView } from '@/features/dp/rep-p/day-model';

/**
 * Revisão antecipada das batidas (plano de revisão antecipada do ponto). O pedido é organizacional: pede que a
 * própria colaboradora revise o dia; nunca cria, altera ou desconsidera batida, NSR, AFD, AEJ ou espelho.
 */
export const TIME_REVIEW_COLLECTION = 'dp_timeReviewRequests';

/** Motivos do DP: sem horário nem valor, para não induzir a correção (Doc Brown, 25/11/2026). */
export const DP_REVIEW_REASONS = {
  check_markings: 'Confira as batidas deste dia',
  check_exit: 'Confira a saída deste dia',
  check_break: 'Confira o intervalo deste dia',
  check_unit: 'Confira a unidade das batidas',
  check_absence: 'Confira se houve ausência neste dia',
} as const;
export type DPReviewReason = keyof typeof DP_REVIEW_REASONS;

export type TimeReviewStatus = 'open' | 'reviewed' | 'resolved';
export type TimeReviewResolution = 'incident_cleared' | 'adjustment' | 'absence';

export type TimeReviewRequest = {
  workspaceId: string;
  /** Titular do dia (namespace main.users). */
  employeeUid: string;
  date: string;
  unitIds: string[];
  status: TimeReviewStatus;
  origin: 'system' | 'dp';
  reason: DPReviewReason | null;
  /** Ator do pedido manual (DP); null quando a rotina abriu. */
  requestedBy: string | null;
  incidents: DayIncident[];
  algorithmVersion: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  resolvedAt: string | null;
  resolution: TimeReviewResolution | null;
};

export type TimeReviewView = Pick<TimeReviewRequest, 'date' | 'status' | 'origin' | 'reason' | 'incidents' | 'createdAt' | 'reviewedAt'>
  & { id: string; reasonLabel: string | null };

/** Só ocorrências graves abrem pedido e geram aviso; as leves ficam na lista (decisão de 25/11/2026). */
export function seriousIncidents(day: Pick<DayView, 'incidents'>) {
  return day.incidents.filter((incident) => INCIDENT_SEVERITY[incident] === 'danger');
}

/**
 * Dia ímpar ou sem batidas não se resolve com "Revisei": precisa de ajuste ou ausência, e o fechamento continua
 * travado nesses casos (Doc Brown, R5).
 */
export function canMarkReviewed(day: Pick<DayView, 'incidents'>) {
  return !day.incidents.includes('odd') && !day.incidents.includes('missing');
}

/** O pedido some quando há ajuste em análise ou decidido, ausência, ou (só os da rotina) quando o erro sumiu. */
export function resolutionOf(request: Pick<TimeReviewRequest, 'origin'>, day: Pick<DayView, 'incidents' | 'absence'>,
  adjustmentStatuses: string[]): TimeReviewResolution | null {
  if (adjustmentStatuses.some((status) => status === 'in_review' || status === 'approved')) return 'adjustment';
  if (day.absence) return 'absence';
  if (request.origin === 'system' && !seriousIncidents(day).length) return 'incident_cleared';
  return null;
}

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Quais avisos a rotina diária (08:00) emite na data do negócio: sempre o do dia anterior; sábado e dia 1º somam. */
export function triggersFor(businessDate: string) {
  return { daily: true, weekly: weekdayOf(businessDate) === 6, monthly: businessDate.endsWith('-01') };
}

/** Semana do lembrete de sábado: segunda a sexta anteriores. */
export function reminderWeek(businessDate: string) {
  const offset = (weekdayOf(businessDate) + 6) % 7;
  const monday = addDays(businessDate, -offset);
  return { start: monday, end: addDays(monday, 4) };
}

export function previousMonth(businessDate: string) {
  const [year, month] = businessDate.slice(0, 7).split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 2, 1));
  return value.toISOString().slice(0, 7);
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const short = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const long = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** Horário de Brasília (UTC−3) para o texto; o prazo vem de `automaticAbsenceDeadline`. */
function dueLabel(dueAtIso: string) {
  const at = new Date(Date.parse(dueAtIso) - 3 * 3_600_000).toISOString();
  return `${long(at.slice(0, 10))}, ${at.slice(11, 16)}`;
}

/** Prazo da falta automática do dia, da mesma função da rotina de falta; `expired` quando já passou. */
export type AbsenceDue = { dueAt: string; expired: boolean } | null;

/**
 * Textos dos avisos: informativos, sem imperativo e sem prazo para agir fora do expediente (Doc Brown, 25/11/2026).
 * Dia sem batidas cita o prazo da falta automática, nunca uma falta já registrada (R6).
 */
export function dailyNoticeBody(days: Array<{ date: string; incidents: DayIncident[]; automaticAbsence?: AbsenceDue }>) {
  const missing = days.length === 1 && days[0].incidents.includes('missing') ? days[0].automaticAbsence : null;
  if (missing && !missing.expired) {
    return `Não há batidas em ${short(days[0].date)}. Se houve motivo, a ausência ou o ajuste pode ser registrado até ${dueLabel(missing.dueAt)}; depois disso a falta é registrada.`;
  }
  if (missing?.expired) {
    return `Não há batidas em ${short(days[0].date)} e o prazo para justificar já passou. Se houve motivo, ainda é possível solicitar ausência ou ajuste.`;
  }
  const dates = days.map((day) => short(day.date)).join(', ');
  return `Há ${days.length === 1 ? 'um dia' : 'dias'} para revisar no Registro de ponto (${dates}). A revisão pode ser feita em horário de trabalho.`;
}

/** Pedido reaberto porque o ajuste ou a ausência que o resolveu caiu, ou o erro voltou. */
export function reopenedNoticeBody(date: string) {
  return `O dia ${short(date)} voltou a ter um ponto a revisar no Registro de ponto. A revisão pode ser feita em horário de trabalho.`;
}

export function weeklyNoticeBody(count: number) {
  return `${count === 1 ? 'Há 1 dia' : `Há ${count} dias`} desta semana para revisar no Registro de ponto. A revisão pode ser feita em horário de trabalho.`;
}

export function monthlyNoticeBody(count: number, month: string) {
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  return `${count === 1 ? 'Há 1 dia' : `Há ${count} dias`} de ${name} para revisar antes do fechamento. A revisão pode ser feita em horário de trabalho.`;
}

export function toReviewView(id: string, request: TimeReviewRequest): TimeReviewView {
  return { id, date: request.date, status: request.status, origin: request.origin, reason: request.reason,
    reasonLabel: request.reason ? DP_REVIEW_REASONS[request.reason] : null, incidents: request.incidents,
    createdAt: request.createdAt, reviewedAt: request.reviewedAt };
}
