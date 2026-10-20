/**
 * Apuração do banco de horas por dia (plano mestre 3.10), sobre o mês já fechado. Puro: recebe a escala, a versão da
 * jornada, as batidas efetivas (originais menos desconsideradas, mais incluídas), as ausências aprovadas e a política
 * de hora extra resolvida, e devolve as linhas do extrato com a memória do cálculo.
 *
 * Regras (decisão do programador, 19 e 20/10/2026):
 * - Referência do dia = carga da jornada naquele dia, não a duração do turno (7h20 de jornada com turno de 6h cumprido = −1h20).
 * - Falta de tempo vira débito no banco; tempo a mais segue a faixa de hora extra da política (banco com fator, folha ou revisão).
 * - Falta é ato do operador (20/10/2026): dia escalado sem batida e sem ausência fica "a tratar" (revisão), até o DP lançar
 *   a ausência. O tipo decide: justificada ou crédito abonam, injustificada desconta na folha, débito no banco vai ao banco.
 * - Trabalho em folga, domingo, feriado ou fora da escala segue a faixa correspondente da política (ex.: folha a 100%).
 * - Tolerância única da jornada: até 5 min na entrada e até 5 min na saída, somando no máximo a tolerância da jornada
 *   (art. 58 §1º; pendência (a) do Doc Brown). Dentro dela, entrada e saída contam como no horário; acima, conta tudo.
 *   Intervalo reduzido não herda a tolerância (pendência (b)).
 * Turno noturno, feriado com escala de trabalho, batida ímpar e faixa ausente vão para revisão do DP, sem lançamento.
 */
import type { DPAbsenceType, DPOvertimeCategory, DPOvertimePolicy } from '@/types';

export const TIME_BANK_ALGORITHM_VERSION = 'time-bank-v2' as const;
export const MARKING_TOLERANCE_LIMIT = 5;

export type BankJourney = { cycleLengthDays: number; validFrom: string; days: Array<{ dayIndex: number; plannedMinutes: number }>;
  weeklyRest?: { placement: 'fixed_cycle' | 'schedule' } | null };
export type BankShift = {
  type: 'work' | 'day_off'; startTime: string | null; endTime: string | null; overnight: boolean;
  /** Duração líquida prevista do turno (sem o intervalo). */
  plannedMinutes: number | null;
  referenceMinutes: number | null; toleranceMinutes: number | null; journeyId: string | null;
};
export type BankAbsence = { id: string; typeName: string; effect: DPAbsenceType['workdayEffect']; unit: 'day' | 'hour'; startDate: string; endDate: string; minutes: number | null };
export type BankPolicy = Pick<DPOvertimePolicy, 'id' | 'version' | 'categories' | 'timeBank' | 'dailyOvertimeLimitMinutes'>;
export type BankDayInput = { date: string; shift: BankShift | null; markings: string[]; absences: BankAbsence[]; holiday: boolean; policy: BankPolicy | null };

export type BankLineNature = 'bank_credit' | 'bank_debit' | 'payroll_overtime' | 'payroll_discount' | 'review';
export type BankLineReason = 'worked_less' | 'worked_more' | 'missing_day' | 'absence_debit' | 'absence_unexcused' | 'absence_review'
  | 'rest_day_work' | 'sunday_work' | 'holiday_work' | 'unplanned_work' | 'daily_limit_exceeded' | 'no_category' | 'needs_review' | 'pending_approval';
export type BankLine = { nature: BankLineNature; minutes: number; reason: BankLineReason; categoryId?: string; ratePercent?: number;
  factor?: number; requiresApproval?: boolean };
export type BankIssue = 'MISSING_DAY' | 'ODD_MARKINGS' | 'NIGHT_SHIFT' | 'NO_JOURNEY' | 'NO_POLICY' | 'TIME_BANK_DISABLED' | 'HOLIDAY_SCHEDULED'
  | 'WORK_ON_ABSENCE' | 'ABSENCE_REVIEW';
export type BankDay = {
  date: string; kind: 'workday' | 'rest_day' | 'no_schedule'; holiday: boolean; sunday: boolean;
  referenceMinutes: number | null; plannedMinutes: number | null; workedMinutes: number; consideredMinutes: number | null;
  deltaMinutes: number | null; toleranceApplied: boolean; abonoMinutes: number;
  /** Só o id e o efeito da ausência: o tipo (ex.: atestado) não entra no banco (LGPD art. 11). */
  absences: Array<{ id: string; effect: DPAbsenceType['workdayEffect'] }>;
  /** Ausência injustificada do dia inteiro lançada pelo DP: vai ao AEJ como "2" e à folha como desconto. */
  unjustifiedAbsence: boolean;
  policy: { id: string; version: number } | null;
  lines: BankLine[]; issues: BankIssue[];
};

const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** Instante fiscal "AAAA-MM-DDTHH:MM:SS-0300" em milissegundos e a hora local da batida. */
const instantMs = (markedAt: string) => Date.parse(markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
const localMinutes = (markedAt: string) => clockMinutes(markedAt.slice(11, 16));
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const civilDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Carga da jornada no dia: posição fixa do ciclo a partir da vigência, ou a carga única quando a folga é escolhida na escala. */
export function journeyReferenceMinutes(journey: BankJourney | null | undefined, date: string): number | null {
  if (!journey || !Array.isArray(journey.days) || !journey.cycleLengthDays || date < journey.validFrom) return null;
  if (journey.weeklyRest?.placement === 'schedule') {
    const positive = [...new Set(journey.days.map((day) => day.plannedMinutes).filter((value) => value > 0))];
    return positive.length === 1 ? positive[0] : null;
  }
  const index = ((civilDay(date) - civilDay(journey.validFrom)) % journey.cycleLengthDays) + 1;
  return journey.days.find((day) => day.dayIndex === index)?.plannedMinutes ?? null;
}

export function pairedMinutes(markings: string[]) {
  let total = 0;
  for (let index = 0; index + 1 < markings.length; index += 2) total += Math.max(0, Math.round((instantMs(markings[index + 1]) - instantMs(markings[index])) / 60_000));
  return total;
}

/** Faixa da política para o dia: feriado > domingo > folga/fora da escala > dias específicos > dias comuns. */
export function categoryFor(categories: DPOvertimeCategory[], day: { kind: BankDay['kind']; holiday: boolean; sunday: boolean; weekday: number }) {
  const by = (trigger: DPOvertimeCategory['trigger']) => categories.find((category) => category.trigger === trigger);
  if (day.holiday && by('holiday')) return by('holiday')!;
  if (day.sunday && by('sunday')) return by('sunday')!;
  if (day.kind === 'rest_day') return by('rest_day') ?? null;
  if (day.kind === 'no_schedule') return by('unplanned_work') ?? by('rest_day') ?? null;
  return categories.find((category) => category.trigger === 'specific_weekdays' && category.weekdays?.includes(day.weekday)) ?? by('workday') ?? null;
}

function overtimeLines(minutes: number, category: DPOvertimeCategory | null, reason: BankLineReason, limit: number | undefined): BankLine[] {
  if (minutes <= 0) return [];
  if (!category) return [{ nature: 'review', minutes, reason: 'no_category' }];
  // Sem fluxo de aprovação de extra, a faixa que pede aprovação vai para revisão do DP, sem entrar no saldo nem na folha.
  if (category.requiresApproval) return [{ nature: 'review', minutes, reason: 'pending_approval', categoryId: category.id, ratePercent: category.ratePercent, requiresApproval: true }];
  const within = limit && reason === 'worked_more' ? Math.min(minutes, limit) : minutes;
  const lines: BankLine[] = [];
  const base = { categoryId: category.id, ratePercent: category.ratePercent };
  if (category.destination === 'time_bank') lines.push({ nature: 'bank_credit', minutes: Math.round(within * (category.bankCreditFactor ?? 1)), reason, factor: category.bankCreditFactor ?? 1, ...base });
  else if (category.destination === 'payroll') lines.push({ nature: 'payroll_overtime', minutes: within, reason, ...base });
  else lines.push({ nature: 'review', minutes: within, reason, ...base });
  if (within < minutes) lines.push({ nature: 'review', minutes: minutes - within, reason: 'daily_limit_exceeded', ...base });
  return lines;
}

export function computeBankDay(input: BankDayInput): BankDay {
  const shift = input.shift;
  const kind: BankDay['kind'] = shift?.type === 'work' ? 'workday' : shift?.type === 'day_off' ? 'rest_day' : 'no_schedule';
  const sunday = weekday(input.date) === 0;
  const markings = [...input.markings].sort((left, right) => instantMs(left) - instantMs(right));
  const worked = pairedMinutes(markings);
  const day: BankDay = { date: input.date, kind, holiday: input.holiday, sunday, referenceMinutes: kind === 'workday' ? shift?.referenceMinutes ?? null : null,
    plannedMinutes: kind === 'workday' ? shift?.plannedMinutes ?? null : null, workedMinutes: worked, consideredMinutes: null, deltaMinutes: null,
    toleranceApplied: false, abonoMinutes: 0, absences: input.absences.map((item) => ({ id: item.id, effect: item.effect })), unjustifiedAbsence: false,
    policy: input.policy ? { id: input.policy.id, version: input.policy.version } : null, lines: [], issues: [] };
  const issue = (value: BankIssue) => { if (!day.issues.includes(value)) day.issues.push(value); };
  const policy = input.policy;
  if (markings.length % 2) issue('ODD_MARKINGS');
  if (shift?.overnight) issue('NIGHT_SHIFT');
  if (!policy) issue('NO_POLICY');
  else if (!policy.timeBank.enabled) issue('TIME_BANK_DISABLED');
  const dayAbsences = input.absences.filter((item) => item.unit === 'day');
  const hourAbsences = input.absences.filter((item) => item.unit === 'hour');
  if (input.absences.some((item) => item.effect === 'manual_review')) issue('ABSENCE_REVIEW');

  if (kind !== 'workday') {
    // Folga ou dia sem escala: só há o que lançar se houve trabalho; ausência em dia sem trabalho previsto não muda nada.
    if (!worked || day.issues.some((value) => ['ODD_MARKINGS', 'NIGHT_SHIFT', 'NO_POLICY'].includes(value))) return finish(day);
    day.consideredMinutes = worked;
    day.deltaMinutes = worked;
    const reason: BankLineReason = input.holiday ? 'holiday_work' : sunday ? 'sunday_work' : kind === 'rest_day' ? 'rest_day_work' : 'unplanned_work';
    // Dia sem turno na escala oficial (rascunho, férias, cobertura não lançada): o DP confere antes de qualquer lançamento.
    if (kind === 'no_schedule') { day.lines = [{ nature: 'review', minutes: worked, reason }]; return finish(day); }
    day.lines = overtimeLines(worked, categoryFor(policy!.categories, { kind, holiday: input.holiday, sunday, weekday: weekday(input.date) }), reason, undefined);
    return finish(day);
  }

  // Referência zero em dia de trabalho: a escala diverge da jornada (ex.: turno no dia de descanso do ciclo).
  if (!day.referenceMinutes) issue('NO_JOURNEY');
  if (input.holiday) issue('HOLIDAY_SCHEDULED');
  if (dayAbsences.length && markings.length) issue('WORK_ON_ABSENCE');
  if (day.issues.some((value) => value !== 'TIME_BANK_DISABLED')) return finish(day);
  const reference = day.referenceMinutes!;

  // Ausência do dia inteiro: abona (justificada ou crédito), desconta na folha (injustificada) ou debita no banco.
  if (dayAbsences.length) {
    const absence = dayAbsences[0];
    day.consideredMinutes = 0;
    if (absence.effect === 'excused_absence' || absence.effect === 'worked_credit') { day.abonoMinutes = reference; day.deltaMinutes = 0; }
    else if (absence.effect === 'unexcused_absence') { day.deltaMinutes = 0; day.unjustifiedAbsence = true; day.lines = [{ nature: 'payroll_discount', minutes: reference, reason: 'absence_unexcused' }]; }
    else { day.deltaMinutes = -reference; day.lines = [{ nature: 'bank_debit', minutes: reference, reason: 'absence_debit' }]; }
    return finish(day);
  }
  // Sem batida: as horas de ausência lançadas seguem o tipo; o resto do dia fica a tratar pelo DP (nada vai ao banco sozinho).
  if (!markings.length) {
    let covered = 0;
    for (const absence of hourAbsences.filter((item) => item.effect !== 'manual_review' && item.minutes)) {
      covered += absence.minutes!;
      if (absence.effect === 'unexcused_absence') day.lines.push({ nature: 'payroll_discount', minutes: absence.minutes!, reason: 'absence_unexcused' });
      else if (absence.effect === 'time_bank_debit') day.lines.push({ nature: 'bank_debit', minutes: absence.minutes!, reason: 'absence_debit' });
      else day.abonoMinutes += absence.minutes!;
    }
    day.consideredMinutes = 0;
    if (covered < reference) { issue('MISSING_DAY'); day.lines.push({ nature: 'review', minutes: reference - covered, reason: 'missing_day' }); }
    return finish(day);
  }

  // Tolerância: entrada e saída dentro de 5 min cada e da tolerância da jornada somadas contam como no horário.
  let considered = worked;
  const tolerance = Math.min(shift!.toleranceMinutes ?? 0, 2 * MARKING_TOLERANCE_LIMIT);
  if (markings.length && shift!.startTime && shift!.endTime && tolerance > 0) {
    const early = clockMinutes(shift!.startTime) - localMinutes(markings[0]);
    const late = localMinutes(markings[markings.length - 1]) - clockMinutes(shift!.endTime);
    if (Math.abs(early) <= MARKING_TOLERANCE_LIMIT && Math.abs(late) <= MARKING_TOLERANCE_LIMIT && Math.abs(early) + Math.abs(late) <= tolerance) {
      considered = worked - early - late;
      day.toleranceApplied = early !== 0 || late !== 0;
    }
  }
  // Ausência em horas: a justificada ou com crédito soma ao considerado; a com débito deixa a falta aparecer.
  // Ausência em horas: justificada ou crédito somam ao considerado; injustificada soma e vai à folha como desconto;
  // débito no banco deixa a falta aparecer como débito.
  const discounts: BankLine[] = [];
  for (const absence of hourAbsences) {
    if (absence.effect === 'excused_absence' || absence.effect === 'worked_credit') { day.abonoMinutes += absence.minutes ?? 0; considered += absence.minutes ?? 0; }
    if (absence.effect === 'unexcused_absence' && absence.minutes) { considered += absence.minutes; discounts.push({ nature: 'payroll_discount', minutes: absence.minutes, reason: 'absence_unexcused' }); }
  }
  day.consideredMinutes = considered;
  day.deltaMinutes = considered - reference;
  if (day.deltaMinutes < 0) day.lines = [...discounts, { nature: 'bank_debit', minutes: -day.deltaMinutes, reason: 'worked_less' }];
  else day.lines = [...discounts, ...overtimeLines(day.deltaMinutes, categoryFor(policy!.categories, { kind, holiday: false, sunday, weekday: weekday(input.date) }), 'worked_more', policy!.dailyOvertimeLimitMinutes)];
  return finish(day);
}

/** Com o banco desligado na política, o que iria ao banco vai para revisão: nada é lançado sem a regra permitir. */
function finish(day: BankDay) {
  if (day.issues.includes('TIME_BANK_DISABLED')) day.lines = day.lines.map((line) => line.nature === 'bank_credit' || line.nature === 'bank_debit' ? { ...line, nature: 'review', reason: 'needs_review' } : line);
  return day;
}

export type BankMonthTotals = { credit: number; debit: number; payroll: number; discount: number; review: number; balance: number; reviewDays: number };
export function monthTotals(days: BankDay[]): BankMonthTotals {
  const sum = (nature: BankLineNature) => days.reduce((total, day) => total + day.lines.filter((line) => line.nature === nature).reduce((acc, line) => acc + line.minutes, 0), 0);
  const credit = sum('bank_credit');
  const debit = sum('bank_debit');
  return { credit, debit, payroll: sum('payroll_overtime'), discount: sum('payroll_discount'), review: sum('review'), balance: credit - debit, reviewDays: days.filter((day) => day.issues.length).length };
}

export type BankSettlement = { uid: string; cycle: { start: string; end: string }; minutes: number; destination: 'carry' | 'payroll' | 'review' | 'forfeit';
  policy: { id: string; version: number }; closureVersions: Record<string, number>; settledBy: string; settledAt: string };
export type BankMonthRecord = { competence: string; closureVersion: number; days: BankDay[]; totals: BankMonthTotals };
export type BankStatementLine = { date: string; competence: string; closureVersion: number; line: BankLine };
export type BankStatement = {
  cycle: { start: string; end: string; index: number } | null;
  openingMinutes: number; balanceMinutes: number; credit: number; debit: number; payroll: number; discount: number; review: number;
  lines: BankStatementLine[]; reviewDays: Array<{ date: string; issues: BankIssue[] }>;
  /** Competências do período sem apuração gravada (mês aberto ou ainda não apurado). */
  missing: string[];
  ended: boolean; residual: null | { minutes: number; destination: 'carry' | 'payroll' | 'review' | 'forfeit' };
  /** Encerramento gravado pelo DP para este ciclo (o residual não muda o extrato; só registra o destino dado). */
  settlement: BankSettlement | null;
  /** Mês reaberto e refechado depois do encerramento: o saldo atual difere do registrado (estorno ainda é pendência). */
  settlementOutdated: boolean;
  limits: { positiveExceeded: boolean; negativeExceeded: boolean; negativeNotAllowed: boolean };
};

/** Competências (AAAA-MM) que tocam o intervalo de datas. */
export function competencesBetween(start: string, end: string) {
  const list: string[] = [];
  for (let cursor = start.slice(0, 7); cursor <= end.slice(0, 7);) {
    list.push(cursor);
    const [year, month] = cursor.split('-').map(Number);
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  }
  return list;
}

/**
 * Extrato do ciclo: linhas de banco dos dias dentro do período, saldo de abertura (transportado de ciclos anteriores
 * quando o destino é "transportar") e o residual a liquidar quando o ciclo terminou. Derivado só das apurações
 * gravadas por versão de fechamento; reabrir e refechar troca a versão sem somar duas vezes.
 */
export function buildStatement(input: {
  period: { start: string; end: string; index: number } | null; today: string; months: BankMonthRecord[]; missing: string[]; openingMinutes: number;
  settlement?: BankSettlement | null;
  timeBank: Pick<DPOvertimePolicy['timeBank'], 'allowNegativeBalance' | 'positiveLimitMinutes' | 'negativeLimitMinutes' | 'cycle'>;
}): BankStatement {
  const inPeriod = (date: string) => !input.period || (date >= input.period.start && date <= input.period.end);
  const lines: BankStatementLine[] = [];
  const reviewDays: BankStatement['reviewDays'] = [];
  for (const month of input.months) for (const day of month.days) {
    if (!inPeriod(day.date)) continue;
    for (const line of day.lines) lines.push({ date: day.date, competence: month.competence, closureVersion: month.closureVersion, line });
    if (day.issues.length) reviewDays.push({ date: day.date, issues: day.issues });
  }
  lines.sort((left, right) => left.date.localeCompare(right.date));
  const sum = (nature: BankLineNature) => lines.filter((item) => item.line.nature === nature).reduce((total, item) => total + item.line.minutes, 0);
  const credit = sum('bank_credit');
  const debit = sum('bank_debit');
  const balance = input.openingMinutes + credit - debit;
  const ended = Boolean(input.period && input.period.end < input.today && !input.missing.length);
  const cycle = input.timeBank.cycle;
  return {
    cycle: input.period, openingMinutes: input.openingMinutes, balanceMinutes: balance, credit, debit, payroll: sum('payroll_overtime'), discount: sum('payroll_discount'), review: sum('review'),
    lines, reviewDays, missing: input.missing, ended, settlement: input.settlement ?? null,
    settlementOutdated: Boolean(input.settlement && (input.settlement.minutes !== balance
      || input.months.some((month) => month.competence in input.settlement!.closureVersions && input.settlement!.closureVersions[month.competence] !== month.closureVersion))),
    // Zerar só perdoa saldo negativo; crédito do empregado nunca é extinto (art. 9º da CLT): vai para revisão do DP.
    residual: ended && cycle && balance !== 0 ? { minutes: balance, destination: cycle.residualDestination === 'forfeit' && balance > 0 ? 'review' : cycle.residualDestination } : null,
    limits: {
      positiveExceeded: Boolean(input.timeBank.positiveLimitMinutes && balance > input.timeBank.positiveLimitMinutes),
      negativeExceeded: Boolean(input.timeBank.negativeLimitMinutes && -balance > input.timeBank.negativeLimitMinutes),
      negativeNotAllowed: balance < 0 && !input.timeBank.allowNegativeBalance,
    },
  };
}
