/**
 * Apuração do banco de horas por dia (plano mestre 3.10), sobre o mês já fechado. Puro: recebe a escala, a versão da
 * jornada, as batidas efetivas (originais menos desconsideradas, mais incluídas), as ausências aprovadas e a política
 * de hora extra resolvida, e devolve as linhas do extrato com a memória do cálculo.
 *
 * Regras (decisão do programador, 19 e 20/10/2026):
 * - Referência do dia = carga da jornada naquele dia, não a duração do turno (7h20 de jornada com turno de 6h cumprido = −1h20).
 * - Falta de tempo vira débito no banco; tempo a mais segue a faixa de hora extra da política (banco com fator, folha ou revisão).
 * - Dia escalado sem batida, solicitação de ausência ou ajuste recebe falta injustificada automática 24 h após o fim
 *   do turno. Ausência ou ajuste aprovados depois substituem seu efeito sem apagar o histórico automático.
 * - Trabalho em folga, domingo, feriado ou fora da escala segue a faixa correspondente da política (ex.: folha a 100%).
 * - Tolerância única da jornada: até 5 min na entrada e até 5 min na saída, somando no máximo a tolerância da jornada
 *   (art. 58 §1º; pendência (a) do Doc Brown). Dentro dela, entrada e saída contam como no horário; acima, conta tudo.
 *   Intervalo reduzido não herda a tolerância (pendência (b)).
 * - Política com `tolerances` (26/11/2026): as tolerâncias de entrada/saída passam a vir dela, e o que falta dentro de
 *   5/10 min nunca é descontado. Com `intrajornada`, o intervalo exigido segue a duração trabalhada (art. 71); acima da
 *   tolerância TOTAL do intervalo paga todo o suprimido. Sem pausa, pausas fracionadas, turno de 6h estendido, intervalo
 *   reduzido, turno manual ou noturno: nada é lançado e o dia vai para o DP.
 * Feriado com escala de trabalho, batida ímpar e faixa ausente vão para revisão do DP, sem lançamento. Turnos que
 * atravessam a meia-noite são pareados pelo instante fiscal e preservam os minutos noturnos para a folha.
 */
import type { DPAbsenceType, DPOvertimeCategory, DPOvertimePolicy, DPPolicyTolerances } from '@/types';

import { absorbedEdgeMinutes, assessBreak } from '../time-config/policy-rules';

export const TIME_BANK_ALGORITHM_VERSION = 'time-bank-v4' as const;
export type TimeBankAlgorithmVersion = 'time-bank-v3' | typeof TIME_BANK_ALGORITHM_VERSION;
/** Saved calculations remain immutable and readable after an implementation update. */
export function isReadableTimeBankAlgorithmVersion(value: unknown): value is TimeBankAlgorithmVersion {
  return value === 'time-bank-v3' || value === TIME_BANK_ALGORITHM_VERSION;
}
export const MARKING_TOLERANCE_LIMIT = 5;

export type BankJourney = { cycleLengthDays: number; validFrom: string; days: Array<{ dayIndex: number; plannedMinutes: number }>;
  weeklyRest?: { placement: 'fixed_cycle' | 'schedule' } | null };
export type BankShift = {
  type: 'work' | 'day_off'; startTime: string | null; endTime: string | null; workDateRule?: boolean; overnight: boolean;
  /** Só com `DP_TIME_NIGHT_TOLERANCE_ENABLED` ligada, em turno que termina às 22h. */
  nightToleranceRule?: boolean;
  /** Duração líquida prevista do turno (sem o intervalo). */
  plannedMinutes: number | null;
  referenceMinutes: number | null; toleranceMinutes: number | null; journeyId: string | null;
  /** Política de jornada de cobertura congelada no turno: a saída é comparada com início + carga + 1h. */
  coverage?: boolean;
  /** Intervalo previsto do turno e se o cadastro permite várias pausas. */
  breakMinutes?: number | null;
  breakSplit?: 'single' | 'multiple' | null;
  breakMinPauseMinutes?: number | null;
  /** Dia com turno manual em partes. */
  manual?: boolean;
};

/** Mesmo limite do Registro de ponto (`day-model.ts`): início + carga da jornada + 1h de intervalo. */
export const COVERAGE_BREAK_MINUTES = 60;
export type BankAbsence = { id: string; typeName: string; effect: DPAbsenceType['workdayEffect']; unit: 'day' | 'hour'; startDate: string; endDate: string; minutes: number | null };
export type BankPolicy = Pick<DPOvertimePolicy, 'id' | 'version' | 'categories' | 'timeBank' | 'dailyOvertimeLimitMinutes' | 'weeklyOvertimeLimitMinutes' | 'tolerances' | 'intrajornada'>;
export type BankDayInput = { date: string; shift: BankShift | null; markings: string[]; absences: BankAbsence[]; holiday: boolean; policy: BankPolicy | null };

export type BankLineNature = 'bank_credit' | 'bank_debit' | 'payroll_overtime' | 'payroll_discount' | 'payroll_indemnity' | 'review';
export type BankLineReason = 'worked_less' | 'worked_more' | 'missing_day' | 'absence_debit' | 'absence_unexcused' | 'absence_review'
  | 'rest_day_work' | 'sunday_work' | 'holiday_work' | 'unplanned_work' | 'daily_limit_exceeded' | 'weekly_limit_exceeded'
  | 'no_category' | 'needs_review' | 'pending_approval' | 'approved_overtime' | 'manual_compensation' | 'manual_adjustment'
  | 'payroll_settlement' | 'credit_expired' | 'break_suppressed';
export type BankLine = { nature: BankLineNature; minutes: number; reason: BankLineReason; categoryId?: string; ratePercent?: number;
  factor?: number; requiresApproval?: boolean };
export type BankIssue = 'MISSING_DAY' | 'ODD_MARKINGS' | 'NIGHT_SHIFT' | 'NO_JOURNEY' | 'NO_POLICY' | 'TIME_BANK_DISABLED' | 'HOLIDAY_SCHEDULED'
  | 'WORK_ON_ABSENCE' | 'ABSENCE_REVIEW' | 'BREAK_REVIEW';
export type BankDay = {
  date: string; kind: 'workday' | 'rest_day' | 'no_schedule'; holiday: boolean; sunday: boolean;
  referenceMinutes: number | null; plannedMinutes: number | null; workedMinutes: number; consideredMinutes: number | null;
  deltaMinutes: number | null; toleranceApplied: boolean; abonoMinutes: number; nightMinutes: number;
  /** Só o id e o efeito da ausência: o tipo (ex.: atestado) não entra no banco (LGPD art. 11). */
  absences: Array<{ id: string; effect: DPAbsenceType['workdayEffect'] }>;
  /** Ausência injustificada do dia inteiro lançada pelo DP: vai ao AEJ como "2" e à folha como desconto. */
  unjustifiedAbsence: boolean;
  policy: { id: string; version: number; weeklyOvertimeLimitMinutes?: number } | null;
  lines: BankLine[]; issues: BankIssue[];
};

const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** Instante fiscal "AAAA-MM-DDTHH:MM:SS-0300" em milissegundos e a hora local da batida. */
const instantMs = (markedAt: string) => Date.parse(markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
const localMinutes = (markedAt: string) => clockMinutes(markedAt.slice(11, 16));
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const civilDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Minutos efetivamente trabalhados dentro da faixa urbana 22h–5h, sem converter para hora ficta nem calcular adicional. */
export function pairedNightMinutes(markings: string[]) {
  let total = 0;
  const sorted = [...markings].sort((left, right) => instantMs(left) - instantMs(right));
  for (let index = 0; index + 1 < sorted.length; index += 2) {
    const start = instantMs(sorted[index]);
    const end = instantMs(sorted[index + 1]);
    const match = sorted[index].match(/([+-])(\d{2})(\d{2})$/);
    const offset = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) * 60_000 : -3 * 60 * 60_000;
    for (let cursor = start; cursor < end;) {
      const local = new Date(cursor + offset);
      const hour = local.getUTCHours();
      const next = Math.min(end, cursor + 60_000);
      if (hour >= 22 || hour < 5) total += (next - cursor) / 60_000;
      cursor = next;
    }
  }
  return Math.round(total);
}

/**
 * Entrada e saída absorvidas pela tolerância, na conta do saldo. `early` é quanto chegou antes e `late` quanto saiu
 * depois do previsto. Com política vale a dela; sem ela, 5 min por ponta e a soma até a tolerância da jornada.
 */
export function edgeTolerance(early: number, late: number, journeyToleranceMinutes: number | null | undefined,
  policy?: Pick<DPPolicyTolerances, 'markingMinutes' | 'dailyMinutes'>) {
  if (policy) {
    const absorbed = absorbedEdgeMinutes([early, late], policy);
    return { minutes: absorbed.minutes, applied: absorbed.applied, lateAbsorbed: late > 0 && absorbed.applied && absorbed.minutes !== Math.min(0, early) };
  }
  const daily = Math.min(journeyToleranceMinutes ?? 0, 2 * MARKING_TOLERANCE_LIMIT);
  const inside = daily > 0 && Math.abs(early) <= MARKING_TOLERANCE_LIMIT && Math.abs(late) <= MARKING_TOLERANCE_LIMIT
    && Math.abs(early) + Math.abs(late) <= daily;
  return { minutes: inside ? early + late : 0, applied: inside && (early !== 0 || late !== 0), lateAbsorbed: inside && late > 0 };
}

/**
 * Regra de 27/11/2026, só no turno que termina às 22h: se a tolerância absorve a saída, os minutos depois das 22h não
 * são noturnos; passou dela, contam todos. Devolve quantos minutos deixam de contar. Quem chama deixa de fora a
 * cobertura e o dia em trechos.
 */
export function toleratedNightMinutes(markings: string[], shift: { startTime: string | null; endTime: string | null; toleranceMinutes?: number | null },
  policy?: Pick<DPPolicyTolerances, 'markingMinutes' | 'dailyMinutes'>) {
  if (shift.endTime !== '22:00' || !shift.startTime || !markings.length || markings.length % 2) return 0;
  const sorted = [...markings].sort((left, right) => instantMs(left) - instantMs(right));
  const entry = sorted[0];
  const exit = sorted[sorted.length - 1];
  const shiftEnd = clockMinutes(shift.endTime);
  const late = localMinutes(exit) - shiftEnd;
  // Saída em outro dia, ou período que já começou depois do fim do turno, não é atraso de saída.
  if (exit.slice(0, 10) !== entry.slice(0, 10) || late <= 0 || localMinutes(sorted[sorted.length - 2]) >= shiftEnd) return 0;
  return edgeTolerance(clockMinutes(shift.startTime) - localMinutes(entry), late, shift.toleranceMinutes, policy).lateAbsorbed ? late : 0;
}

const previousDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
/** A saída após meia-noite pertence ao turno noturno iniciado no dia anterior. */
export function overnightWorkDate(workDate: string, markedAt: string, shifts: Array<{ date: string; overnight: boolean; endTime: string | null }>) {
  const previous = previousDate(workDate);
  const shift = shifts.find((item) => item.date === previous && item.overnight && item.endTime);
  return shift?.endTime && markedAt.slice(11, 16) <= shift.endTime ? previous : workDate;
}

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

/** Pausas entre os períodos trabalhados, em minutos. */
function pausesOf(markings: string[]) {
  const pauses: number[] = [];
  for (let index = 2; index + 1 < markings.length; index += 2) {
    pauses.push(Math.max(0, Math.round((instantMs(markings[index]) - instantMs(markings[index - 1])) / 60_000)));
  }
  return pauses;
}

/** Cobertura que de fato estende o dia: mesma condição do Registro de ponto. */
const isCoverageShift = (shift: BankShift) => shift.coverage === true && !shift.overnight && !shift.workDateRule && Boolean(shift.referenceMinutes)
  && shift.plannedMinutes !== null && shift.referenceMinutes! > shift.plannedMinutes;

/**
 * Intervalo intrajornada do dia. O pagamento é parcela própria: não entra no banco nem se confunde com a hora extra.
 * Caso com dúvida, ou dia que já foi para conferência, não lança nada: marca o dia para o DP.
 */
function applyIntrajornada(day: BankDay, input: BankDayInput, markings: string[]) {
  const { shift, policy } = input;
  if (shift?.type !== 'work' || !policy?.tolerances || !policy.intrajornada || markings.length < 2 || markings.length % 2) return;
  const assessment = assessBreak({
    workedMinutes: pairedMinutes(markings), pauses: pausesOf(markings), plannedWorkMinutes: shift.plannedMinutes,
    scheduledBreakMinutes: shift.breakMinutes ?? 0, coverage: isCoverageShift(shift), split: shift.breakSplit,
    minPauseMinutes: shift.breakMinPauseMinutes, unsupported: shift.overnight || shift.workDateRule === true || shift.manual === true, tolerances: policy.tolerances,
  });
  if (assessment.status === 'ok') return;
  const blocked = day.issues.some((value) => value !== 'NIGHT_SHIFT' && value !== 'TIME_BANK_DISABLED');
  if (assessment.status === 'review' || blocked) { day.issues.push('BREAK_REVIEW'); return; }
  day.lines = [...day.lines, { nature: 'payroll_indemnity', minutes: assessment.minutes, reason: 'break_suppressed',
    categoryId: policy.intrajornada.code, ratePercent: policy.intrajornada.ratePercent }];
}

export function computeBankDay(input: BankDayInput): BankDay {
  const day = computeWorkedTimeDay(input);
  applyIntrajornada(day, input, [...input.markings].sort((left, right) => instantMs(left) - instantMs(right)));
  return day;
}

function computeWorkedTimeDay(input: BankDayInput): BankDay {
  const shift = input.shift;
  const kind: BankDay['kind'] = shift?.type === 'work' ? 'workday' : shift?.type === 'day_off' ? 'rest_day' : 'no_schedule';
  const sunday = weekday(input.date) === 0;
  const markings = [...input.markings].sort((left, right) => instantMs(left) - instantMs(right));
  const worked = pairedMinutes(markings);
  const day: BankDay = { date: input.date, kind, holiday: input.holiday, sunday, referenceMinutes: kind === 'workday' ? shift?.referenceMinutes ?? null : null,
    plannedMinutes: kind === 'workday' ? shift?.plannedMinutes ?? null : null, workedMinutes: worked, consideredMinutes: null, deltaMinutes: null,
    toleranceApplied: false, abonoMinutes: 0, nightMinutes: pairedNightMinutes(markings)
      - (shift?.type === 'work' && shift.nightToleranceRule && !shift.manual && !isCoverageShift(shift)
        ? toleratedNightMinutes(markings, shift, input.policy?.tolerances) : 0),
    absences: input.absences.map((item) => ({ id: item.id, effect: item.effect })), unjustifiedAbsence: false,
    policy: input.policy ? { id: input.policy.id, version: input.policy.version,
      ...(input.policy.weeklyOvertimeLimitMinutes ? { weeklyOvertimeLimitMinutes: input.policy.weeklyOvertimeLimitMinutes } : {}) } : null, lines: [], issues: [] };
  const issue = (value: BankIssue) => { if (!day.issues.includes(value)) day.issues.push(value); };
  if (day.nightMinutes) issue('NIGHT_SHIFT');
  const policy = input.policy;
  if (markings.length % 2) issue('ODD_MARKINGS');
  if (!policy) issue('NO_POLICY');
  else if (!policy.timeBank.enabled) issue('TIME_BANK_DISABLED');
  const dayAbsences = input.absences.filter((item) => item.unit === 'day');
  const hourAbsences = input.absences.filter((item) => item.unit === 'hour');
  if (input.absences.some((item) => item.effect === 'manual_review')) issue('ABSENCE_REVIEW');

  if (kind !== 'workday') {
    // Folga ou dia sem escala: só há o que lançar se houve trabalho; ausência em dia sem trabalho previsto não muda nada.
    if (!worked || day.issues.some((value) => ['ODD_MARKINGS', 'NO_POLICY'].includes(value))) return finish(day);
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
  if (day.issues.some((value) => value !== 'TIME_BANK_DISABLED' && value !== 'NIGHT_SHIFT')) return finish(day);
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
  const policyTolerances = policy?.tolerances;
  const tolerance = Math.min(shift!.toleranceMinutes ?? 0, 2 * MARKING_TOLERANCE_LIMIT);
  if (markings.length && shift!.startTime && shift!.endTime && (policyTolerances || tolerance > 0)) {
    // Turno que passa da meia-noite: 00:02 contra um fim às 23:59 são 3 minutos, não quase um dia.
    const nearest = (minutes: number) => shift!.workDateRule ? ((minutes + 720) % 1440 + 1440) % 1440 - 720 : minutes;
    const early = nearest(clockMinutes(shift!.startTime) - localMinutes(markings[0]));
    // Na cobertura, ficar até completar a carga é esperado: a tolerância da saída compara com o limite de extensão.
    const coverageEnd = shift!.coverage && !shift!.overnight && !shift!.workDateRule && shift!.referenceMinutes && shift!.plannedMinutes !== null
      && shift!.referenceMinutes > shift!.plannedMinutes
      ? clockMinutes(shift!.startTime) + shift!.referenceMinutes + COVERAGE_BREAK_MINUTES : null;
    const late = nearest(localMinutes(markings[markings.length - 1]) - (coverageEnd ?? clockMinutes(shift!.endTime)));
    const absorbed = edgeTolerance(early, late, shift!.toleranceMinutes, policyTolerances);
    considered = worked - absorbed.minutes;
    day.toleranceApplied = absorbed.applied;
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

export type BankMonthTotals = { credit: number; debit: number; payroll: number; discount: number; indemnity?: number; review: number; balance: number; reviewDays: number };
export function monthTotals(days: BankDay[]): BankMonthTotals {
  const sum = (nature: BankLineNature) => days.reduce((total, day) => total + day.lines.filter((line) => line.nature === nature).reduce((acc, line) => acc + line.minutes, 0), 0);
  const credit = sum('bank_credit');
  const debit = sum('bank_debit');
  return { credit, debit, payroll: sum('payroll_overtime'), discount: sum('payroll_discount'), indemnity: sum('payroll_indemnity'), review: sum('review'), balance: credit - debit, reviewDays: days.filter((day) => day.issues.length).length };
}

const overtimeReasons = new Set<BankLineReason>(['worked_more', 'rest_day_work', 'sunday_work', 'holiday_work', 'unplanned_work', 'pending_approval']);
const weekKey = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  const mondayOffset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - mondayOffset);
  return value.toISOString().slice(0, 10);
};
const sourceMinutesOf = (line: BankLine) => line.nature === 'bank_credit' && line.factor ? Math.round(line.minutes / line.factor) : line.minutes;
const destinationMinutesOf = (line: BankLine, sourceMinutes: number) => line.nature === 'bank_credit' && line.factor
  ? Math.round(sourceMinutes * line.factor) : sourceMinutes;

/** Aplica o teto semanal depois do cálculo diário, preservando a parte admitida e mandando só o excedente à revisão. */
export function applyWeeklyOvertimeLimits(days: BankDay[]) {
  const used = new Map<string, number>();
  return days.map((day) => {
    const policy = day.policy;
    const limit = policy?.weeklyOvertimeLimitMinutes;
    if (!policy || !limit) return day;
    const key = `${policy.id}:${policy.version}:${weekKey(day.date)}`;
    let consumed = used.get(key) ?? 0;
    const lines: BankLine[] = [];
    for (const line of day.lines) {
      if (!line.categoryId || !overtimeReasons.has(line.reason) || line.reason === 'pending_approval') {
        lines.push(line);
        if (line.reason === 'pending_approval') consumed += sourceMinutesOf(line);
        continue;
      }
      const source = sourceMinutesOf(line);
      const within = Math.max(0, Math.min(source, limit - consumed));
      if (within) lines.push({ ...line, minutes: destinationMinutesOf(line, within) });
      if (within < source) lines.push({ nature: 'review', minutes: source - within, reason: 'weekly_limit_exceeded',
        categoryId: line.categoryId, ratePercent: line.ratePercent });
      consumed += source;
    }
    used.set(key, consumed);
    return { ...day, lines };
  });
}

export type BankManualMovement = {
  id: string; uid: string; date: string; competence: string; status: 'active' | 'reversed'; kind: 'overtime_approval' | 'compensation' | 'adjustment' | 'payroll';
  minutes: number; reason: string; createdAt: string; createdBy: string; reversedAt?: string; reversedBy?: string; reversalReason?: string;
  operationId?: string; requestHash?: string; categoryId?: string; replacesMinutes?: number; sourceClosureVersion?: number;
  settlementCycle?: { start: string; end: string }; line: BankLine; counterLine?: BankLine;
};

export type BankSettlement = { uid: string; cycle: { start: string; end: string }; minutes: number; destination: 'carry' | 'payroll' | 'review' | 'forfeit';
  policy: { id: string; version: number }; closureVersions: Record<string, number>; settledBy: string; settledAt: string; movementId?: string };
export type BankMonthRecord = { competence: string; closureVersion: number; days: BankDay[]; totals: BankMonthTotals };
export type BankStatementLine = { date: string; competence: string; closureVersion: number; line: BankLine };
export type BankStatement = {
  cycle: { start: string; end: string; index: number } | null;
  openingMinutes: number; balanceMinutes: number; credit: number; debit: number; payroll: number; discount: number; review: number; nightMinutes: number;
  lines: BankStatementLine[]; reviewDays: Array<{ date: string; issues: BankIssue[] }>;
  /** Base de cada dia de trabalho apurado: jornada contratual (referência do banco) e escala. Permite mostrar a conta do dia. */
  dayBases: Array<{ date: string; referenceMinutes: number | null; plannedMinutes: number | null; workedMinutes: number; consideredMinutes: number | null }>;
  /** Competências do período sem apuração gravada (mês aberto ou ainda não apurado). */
  missing: string[];
  ended: boolean; residual: null | { minutes: number; destination: 'carry' | 'payroll' | 'review' | 'forfeit' };
  /** Encerramento gravado pelo DP para este ciclo (o residual não muda o extrato; só registra o destino dado). */
  settlement: BankSettlement | null;
  /** Mês reaberto e refechado depois do encerramento: o saldo atual difere do registrado (estorno ainda é pendência). */
  settlementOutdated: boolean;
  limits: { positiveExceeded: boolean; negativeExceeded: boolean; negativeNotAllowed: boolean };
  movements: BankManualMovement[];
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

/** Linhas efetivas, incluindo movimentos manuais e descartando aprovações de uma versão antiga do fechamento. */
export function bankLinesWithMovements(months: BankMonthRecord[], movements: BankManualMovement[] = []) {
  const lines: BankStatementLine[] = [];
  const days = months.flatMap((month) => month.days.map((day) => ({ month, day })))
    .sort((left, right) => left.day.date.localeCompare(right.day.date));
  // Reaplicar sobre a sequência completa preserva o teto na semana que atravessa duas competências.
  const limited = applyWeeklyOvertimeLimits(days.map((item) => item.day));
  limited.forEach((day, index) => {
    const month = days[index].month;
    for (const line of day.lines) lines.push({ date: day.date, competence: month.competence, closureVersion: month.closureVersion, line });
  });
  for (const movement of movements.filter((item) => item.status === 'active').sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (movement.kind === 'overtime_approval') {
      const index = lines.findIndex((item) => item.date === movement.date && item.line.reason === 'pending_approval'
        && item.line.categoryId === movement.categoryId && item.line.minutes === movement.replacesMinutes
        && (movement.sourceClosureVersion === undefined || item.closureVersion === movement.sourceClosureVersion));
      // Reabertura/refechamento invalida a aprovação vinculada à versão anterior: ela fica só no histórico.
      if (index < 0) continue;
      lines.splice(index, 1);
    }
    lines.push({ date: movement.date, competence: movement.competence, closureVersion: 0, line: movement.line });
    if (movement.counterLine) lines.push({ date: movement.date, competence: movement.competence, closureVersion: 0, line: movement.counterLine });
  }
  return lines.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Extrato do ciclo: linhas de banco dos dias dentro do período, saldo de abertura (transportado de ciclos anteriores
 * quando o destino é "transportar") e o residual a liquidar quando o ciclo terminou. Derivado só das apurações
 * gravadas por versão de fechamento; reabrir e refechar troca a versão sem somar duas vezes.
 */
export function buildStatement(input: {
  period: { start: string; end: string; index: number } | null; today: string; months: BankMonthRecord[]; missing: string[]; openingMinutes: number;
  /** Primeiro dia cujo saldo pode ser transportado. Nulo reinicia o saldo no começo do ciclo. */
  carryFrom?: string | null;
  settlement?: BankSettlement | null;
  movements?: BankManualMovement[];
  timeBank: Pick<DPOvertimePolicy['timeBank'], 'allowNegativeBalance' | 'positiveLimitMinutes' | 'negativeLimitMinutes' | 'cycle'>
    & Partial<Pick<DPOvertimePolicy['timeBank'], 'expirationDays' | 'expiredBalanceDestination'>>;
}): BankStatement {
  const inPeriod = (date: string) => !input.period || (date >= input.period.start && date <= input.period.end);
  const relevantFrom = input.period ? (input.carryFrom ?? input.period.start) : null;
  // Um mês carregado pode conter dias do ciclo anterior quando o marco não cai no dia 1. Esses dias só participam
  // quando a política manda transportar e nunca podem anteceder o marco/vigência de carryFrom.
  const allLines = bankLinesWithMovements(input.months, input.movements)
    .filter((item) => !relevantFrom || item.date >= relevantFrom);
  const reviewDays: BankStatement['reviewDays'] = [];
  for (const month of input.months) for (const day of month.days) {
    if (!inPeriod(day.date)) continue;
    if (day.issues.length) reviewDays.push({ date: day.date, issues: day.issues });
  }
  const dayBases: BankStatement['dayBases'] = input.months.flatMap((month) => month.days)
    .filter((day) => inPeriod(day.date) && day.kind === 'workday')
    .map((day) => ({ date: day.date, referenceMinutes: day.referenceMinutes, plannedMinutes: day.plannedMinutes, workedMinutes: day.workedMinutes, consideredMinutes: day.consideredMinutes }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const expirationDays = input.timeBank.expirationDays;
  if (expirationDays) {
    const lots: Array<{ date: string; expires: string; remaining: number; reported: boolean }> = [];
    const expirationLines: BankStatementLine[] = [];
    const configuredDestination = input.timeBank.expiredBalanceDestination ?? 'review';
    const destination = configuredDestination === 'forfeit' ? 'review' : configuredDestination;
    const expireBefore = (date: string) => {
      for (const lot of lots.filter((item) => item.remaining > 0 && !item.reported && item.expires < date)) {
        if (destination === 'payroll') {
          expirationLines.push({ date: lot.expires, competence: lot.expires.slice(0, 7), closureVersion: 0,
            line: { nature: 'bank_debit', minutes: lot.remaining, reason: 'credit_expired' } });
          expirationLines.push({ date: lot.expires, competence: lot.expires.slice(0, 7), closureVersion: 0,
            line: { nature: 'payroll_overtime', minutes: lot.remaining, reason: 'credit_expired' } });
          lot.remaining = 0;
        } else {
          expirationLines.push({ date: lot.expires, competence: lot.expires.slice(0, 7), closureVersion: 0,
            line: { nature: 'review', minutes: lot.remaining, reason: 'credit_expired' } });
        }
        lot.reported = true;
      }
    };
    for (const item of allLines) {
      expireBefore(item.date);
      if (item.line.nature === 'bank_credit') {
        const expires = new Date(`${item.date}T00:00:00Z`); expires.setUTCDate(expires.getUTCDate() + expirationDays);
        lots.push({ date: item.date, expires: expires.toISOString().slice(0, 10), remaining: item.line.minutes, reported: false });
      }
      if (item.line.nature === 'bank_debit') {
        let debit = item.line.minutes;
        for (const lot of lots) { const used = Math.min(lot.remaining, debit); lot.remaining -= used; debit -= used; if (!debit) break; }
      }
    }
    const expirationCutoff = input.period && input.period.end < input.today ? input.period.end : input.today;
    expireBefore(expirationCutoff);
    allLines.push(...expirationLines);
    allLines.sort((left, right) => left.date.localeCompare(right.date));
  }
  const lines = allLines.filter((item) => inPeriod(item.date));
  const historical = allLines.filter((item) => input.period && input.carryFrom && item.date < input.period.start);
  const openingMinutes = input.openingMinutes + historical.reduce((total, item) => total
    + (item.line.nature === 'bank_credit' ? item.line.minutes : item.line.nature === 'bank_debit' ? -item.line.minutes : 0), 0);
  const sum = (nature: BankLineNature) => lines.filter((item) => item.line.nature === nature).reduce((total, item) => total + item.line.minutes, 0);
  const credit = sum('bank_credit');
  const debit = sum('bank_debit');
  const balance = openingMinutes + credit - debit;
  const activeMovements = (input.movements ?? []).filter((item) => item.status === 'active' && inPeriod(item.date));
  const settlementMovement = input.settlement?.movementId
    ? activeMovements.find((movement) => movement.id === input.settlement!.movementId) : null;
  const balanceBeforeSettlement = balance - (settlementMovement
    ? (settlementMovement.line.nature === 'bank_credit' ? settlementMovement.line.minutes
      : settlementMovement.line.nature === 'bank_debit' ? -settlementMovement.line.minutes : 0) : 0);
  const ended = Boolean(input.period && input.period.end < input.today && !input.missing.length);
  const cycle = input.timeBank.cycle;
  return {
    cycle: input.period, openingMinutes, balanceMinutes: balance, credit, debit, payroll: sum('payroll_overtime'), discount: sum('payroll_discount'), review: sum('review'),
    nightMinutes: input.months.flatMap((month) => month.days).filter((day) => inPeriod(day.date)).reduce((total, day) => total + day.nightMinutes, 0),
    lines, reviewDays, dayBases, missing: input.missing, ended, settlement: input.settlement ?? null, movements: input.movements ?? [],
    settlementOutdated: Boolean(input.settlement && (input.settlement.minutes !== balanceBeforeSettlement
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
