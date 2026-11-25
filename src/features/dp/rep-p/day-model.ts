import { applyTreatments } from "@/features/dp/time-adjustments/effective";
import { pairedNightMinutes } from "@/features/dp/time-bank/core";

import { repPInstantMs } from "./time-zones";

/**
 * Leitura do mês no Registro de ponto: junta escala, batidas originais e ausências por dia e calcula uma
 * prévia (total, intervalo, desvios e alertas). Nada aqui é apuração nem classifica marcação: o REP-P guarda
 * só o instante, e entrada/intervalo/saída e saldo oficial pertencem ao tratamento do ponto (PTRP).
 */

export type DayShift = {
  manualOrder?: number;
  manualMode?: 'fixed' | 'flexible';
  manualWorkMinutes?: number;
  type: "work" | "day_off";
  startTime: string | null;
  endTime: string | null;
  shiftName: string | null;
  unitName: string | null;
  assignmentKind?: 'regular' | 'external_coverage';
  breakType: "none" | "fixed" | "flexible" | "staggered";
  breakStart: string | null;
  breakEnd: string | null;
  breakDurationMinutes: number | null;
  breakWindowStart: string | null;
  breakWindowEnd: string | null;
  expectedPunches: number | null;
  overnight?: boolean;
  unitId?: string | null;
  executionUnitPolicy?: "scheduled" | "free";
  /** O detalhe só apresenta o resultado geográfico quando o turno daquele dia pediu coleta. */
  locationTrackingPolicy?: "disabled" | "punch_only" | "workday";
  breakSegments?: { start: string; end: string }[] | null;
  breakSplit?: "single" | "multiple";
  breakPauseCount?: number | null;
  breakMinPauseMinutes?: number | null;
  /** Tolerância única da jornada do dia (minutos); ausente = sem tolerância. */
  toleranceMinutes?: number | null;
  /** Política de jornada de cobertura, congelada na escrita do turno. */
  coverage?: boolean;
  /** Carga da jornada no dia (referência do banco); a cobertura estende o dia até ela. */
  referenceMinutes?: number | null;
};

export type DayMarking = { receiptId: string; markedAt: string; nsr: number; executionUnitId: string; receiptStatus: "available" | "pending";
  classification?: { purpose: "journey_start" | "break_start" | "break_end" | "journey_end"; source: string; status: string } | null;
  /** Ensaio pré-homologação: visível na conferência e prévia, mas fora do fechamento oficial. */
  pilot?: boolean;
  /** Tratamento aprovado (PTRP): original, desconsiderada (continua listada) ou incluída por ajuste. */
  treatment?: "original" | "discarded" | "included"; adjustmentId?: string;
  /** Resultado da localização na batida (sem coordenadas); vem só para quem pode ver e quando o turno coletou. */
  location?: { evaluation: "inside" | "outside" | "indeterminate"; distanceMeters: number | null;
    physicalUnitId?: string | null; physicalUnitName?: string | null } | null };

export type DayTreatment = { type: "discard" | "inclusion"; workDate: string; adjustmentId: string;
  originalReceiptId: string | null; markedAt: string | null; executionUnitId: string | null };

export type DayAbsence = { id: string; typeName: string; status: string; startDate: string; endDate: string; approvedByInaction?: boolean };

export type DayIncident = "missing" | "odd" | "missing_break" | "late_exit" | "short_break" | "long_break" | "other_unit"
  | "late_start" | "early_exit" | "coverage_early_exit";

export type DayView = {
  date: string;
  shift: DayShift | null;
  manualSegments?: DayShift[];
  markings: DayMarking[];
  absence: DayAbsence | null;
  incidents: DayIncident[];
  /** Todas as batidas do dia, inclusive desconsideradas e incluídas, para o painel. `markings` traz só as efetivas. */
  allMarkings: DayMarking[];
  workedMinutes: number;
  breakMinutes: number | null;
  /** Carga líquida prevista no turno, descontado o intervalo cadastrado. */
  plannedWorkMinutes: number | null;
  /** Tempo físico trabalhado na faixa urbana 22h–5h; não inclui hora reduzida nem adicional de folha. */
  nightMinutes: number;
  /** Diferença prévia entre o trabalhado e o previsto, zerada dentro da tolerância da jornada; null quando não dá para comparar. */
  balanceMinutes: number | null;
  /** Desvio da saída (ou da entrada) acima da tolerância da jornada, em minutos com sinal. */
  deviation: { edge: "start" | "end"; minutes: number } | null;
  /**
   * Política de jornada de cobertura: até quando a pessoa pode estender o dia (início + carga + 1h de intervalo).
   * Só informativo; a ocorrência usa os minutos trabalhados. Null fora da política.
   */
  extendUntil?: string | null;
  /** Intervalo esperado efetivamente usado na comparação (o do turno, ou 1h na cobertura acima de 6h). */
  expectedBreakMinutes?: number | null;
};

/** Acima de 6h trabalhadas, o intervalo mínimo é 1h (CLT art. 71); até 6h vale o do turno. */
export const COVERAGE_LONG_DAY_MINUTES = 360;
export const COVERAGE_LONG_DAY_BREAK_MINUTES = 60;

function clockOf(minutes: number) {
  const value = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** Dia na Política de jornada de cobertura: turno de trabalho comum, com carga conhecida maior que o turno. */
export function coverageOf(shift: DayShift | null, manualSegments: DayShift[]) {
  if (!shift || shift.type !== "work" || !shift.coverage || shift.overnight || manualSegments.length) return null;
  const reference = shift.referenceMinutes ?? null;
  const planned = plannedWorkMinutesOf(shift);
  if (!shift.startTime || reference === null || planned === null || reference <= planned) return null;
  return { reference, planned, extendUntil: clockOf(minutesOf(shift.startTime) + reference + COVERAGE_LONG_DAY_BREAK_MINUTES) };
}

/** Tolerância única do dia, cadastrada na jornada (decisão do programador): vale para desvios, intervalo e saldo. */
export function toleranceOf(shift: DayShift | null) {
  return shift?.toleranceMinutes ?? 0;
}

/** Ausência que vale para o dia: aprovada ou em análise; rascunho, recusada e cancelada não contam. */
const ACTIVE_ABSENCE = new Set(["approved", "in_review", "submitted"]);

export function minutesOf(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function clockSpan(start: string, end: string) {
  const span = minutesOf(end) - minutesOf(start);
  return span < 0 ? span + 1440 : span;
}

/** Duração prevista, inclusive para turnos fixos legados que guardam somente os horários. */
export function plannedBreakMinutesOf(shift: DayShift | null) {
  if (!shift || shift.type !== "work" || shift.breakType === "none") return 0;
  if (typeof shift.breakDurationMinutes === "number" && shift.breakDurationMinutes > 0) return shift.breakDurationMinutes;
  if (shift.breakType !== "fixed") return 0;
  if (shift.breakSegments?.length) return shift.breakSegments.reduce((sum, segment) => sum + clockSpan(segment.start, segment.end), 0);
  return shift.breakStart && shift.breakEnd ? clockSpan(shift.breakStart, shift.breakEnd) : 0;
}

/** HH:MM do instante fiscal (AAAA-MM-DDThh:mm:00±hhmm), já no fuso do estabelecimento. */
export function fiscalClock(markedAt: string) {
  return markedAt.slice(11, 16);
}

export function workedMinutes(markings: Pick<DayMarking, "markedAt">[], nowMinutes?: number) {
  let total = 0;
  for (let index = 0; index < markings.length; index += 2) {
    const start = minutesOf(fiscalClock(markings[index].markedAt));
    const next = markings[index + 1];
    const end = next ? minutesOf(fiscalClock(next.markedAt)) : nowMinutes;
    if (end !== undefined) total += Math.max(0, end - start);
  }
  return total;
}

/** Soma das pausas entre pares (2ª→3ª, 4ª→5ª…); null sem pausa fechada. */
export function breakTaken(markings: Pick<DayMarking, "markedAt">[]) {
  if (markings.length < 3) return null;
  let total = 0;
  for (let index = 1; index + 1 < markings.length; index += 2) {
    total += minutesOf(fiscalClock(markings[index + 1].markedAt)) - minutesOf(fiscalClock(markings[index].markedAt));
  }
  return total;
}

/** Duração de cada pausa fechada (2ª→3ª, 4ª→5ª…). */
export function pauseLengths(markings: Pick<DayMarking, "markedAt">[]) {
  const lengths: number[] = [];
  for (let index = 1; index + 1 < markings.length; index += 2) {
    lengths.push(minutesOf(fiscalClock(markings[index + 1].markedAt)) - minutesOf(fiscalClock(markings[index].markedAt)));
  }
  return lengths;
}

export function plannedWorkMinutesOf(shift: DayShift | null) {
  if (!shift || shift.type !== "work") return null;
  if (!shift.startTime || !shift.endTime) return 0;
  const span = minutesOf(shift.endTime) - minutesOf(shift.startTime);
  return Math.max(0, (span < 0 ? span + 1440 : span) - plannedBreakMinutesOf(shift));
}

export function currentManualSegment(segments: DayShift[], markings: DayMarking[]) {
  let index = 0;
  for (const marking of markings) {
    if (marking.executionUnitId === segments[index]?.unitId && marking.classification?.purpose === 'journey_end') index++;
  }
  return segments[index] ?? null;
}

export function buildDayView(input: { date: string; today: string; shift: DayShift | null; shifts?: DayShift[]; markings: DayMarking[]; absences: DayAbsence[]; treatments?: DayTreatment[] }): DayView {
  const allMarkings = applyTreatments(input.markings, (input.treatments ?? []).filter((item) => item.workDate === input.date),
    (item) => ({ receiptId: `ajuste-${item.adjustmentId}`, markedAt: item.markedAt, nsr: 0, executionUnitId: item.executionUnitId ?? "",
      receiptStatus: "available" as const }))
    .sort((left, right) => repPInstantMs(left.markedAt) - repPInstantMs(right.markedAt) || left.nsr - right.nsr);
  const markings = allMarkings.filter((marking) => marking.treatment !== "discarded");
  const absence = input.absences.find((item) => ACTIVE_ABSENCE.has(item.status) && item.startDate <= input.date && item.endDate >= input.date) ?? null;
  const shift = input.shift && input.shift.type === "work" ? input.shift : null;
  const manualSegments = (input.shifts ?? []).filter((segment) => segment.manualOrder != null)
    .sort((left, right) => (left.manualOrder ?? 0) - (right.manualOrder ?? 0));
  const past = input.date < input.today;
  const worked = workedMinutes(markings);
  const breakMinutes = breakTaken(markings);
  const plannedWorkMinutes = manualSegments.length
    ? manualSegments.reduce((total, segment) => total + (segment.manualWorkMinutes ?? plannedWorkMinutesOf(segment) ?? 0), 0)
    : plannedWorkMinutesOf(shift);
  const nightMinutes = pairedNightMinutes(markings.map((marking) => marking.markedAt));
  const tolerance = toleranceOf(shift);
  const incidents: DayIncident[] = [];
  let deviation: DayView["deviation"] = null;
  const coverage = coverageOf(shift, manualSegments);

  // Jornada que atravessa a meia-noite tem batidas em dois dias civis: sem tratamento, só o total é mostrado.
  if (shift?.overnight) {
    return { date: input.date, shift: input.shift, manualSegments, markings, allMarkings, absence, incidents, workedMinutes: worked, breakMinutes,
      plannedWorkMinutes, nightMinutes, balanceMinutes: null, deviation };
  }
  if (past && shift && !markings.length && !absence) incidents.push("missing");
  if (past && markings.length % 2 === 1) incidents.push("odd");
  if (shift && !manualSegments.length && markings.length >= 2 && markings.length % 2 === 0 && shift.startTime && shift.endTime) {
    const endDiff = minutesOf(fiscalClock(markings[markings.length - 1].markedAt)) - minutesOf(shift.endTime);
    const startDiff = minutesOf(fiscalClock(markings[0].markedAt)) - minutesOf(shift.startTime);
    // Tolerância só no início e no fim da jornada (decisão de 25/11/2026). Na cobertura, ficar além do turno até
    // completar a carga é esperado: a saída tardia conta pelos minutos trabalhados acima da carga.
    const lateBeyondCoverage = coverage ? worked > coverage.reference + tolerance : endDiff > tolerance;
    const endDeviates = endDiff < -tolerance || (coverage ? lateBeyondCoverage : endDiff > tolerance);
    if (endDeviates) deviation = { edge: "end", minutes: coverage && endDiff > 0 ? worked - coverage.reference : endDiff };
    else if (Math.abs(startDiff) > tolerance) deviation = { edge: "start", minutes: startDiff };
    if (lateBeyondCoverage) incidents.push("late_exit");
    if (startDiff > tolerance) incidents.push("late_start");
    if (endDiff < -tolerance) incidents.push(coverage ? "coverage_early_exit" : "early_exit");
  }
  // Na cobertura, acima de 6h trabalhadas o intervalo esperado é 1h; até 6h, o do turno.
  const longCoverageDay = Boolean(coverage) && worked > COVERAGE_LONG_DAY_MINUTES;
  const expectedBreakValue = longCoverageDay ? COVERAGE_LONG_DAY_BREAK_MINUTES : plannedBreakMinutesOf(shift);
  const expectedBreak = expectedBreakValue > 0 ? expectedBreakValue : null;
  const classificationsComplete = markings.length > 0 && markings.every((marking) => marking.classification?.purpose);
  const journeyEnded = markings.at(-1)?.classification?.purpose === "journey_end";
  const hasBreakStart = markings.some((marking) => marking.classification?.purpose === "break_start");
  const hasBreakEnd = markings.some((marking) => marking.classification?.purpose === "break_end");
  if (shift && expectedBreak && classificationsComplete && journeyEnded && (!hasBreakStart || !hasBreakEnd)) incidents.push("missing_break");
  // Intervalo nunca usa a tolerância da jornada (decisão de 25/11/2026).
  if (breakMinutes !== null && expectedBreak) {
    // Sem fracionamento no cadastro do turno, a 1h da cobertura precisa ser uma pausa só.
    const counted = longCoverageDay && shift?.breakSplit !== "multiple" ? Math.max(0, ...pauseLengths(markings)) : breakMinutes;
    if (counted < expectedBreak) incidents.push("short_break");
    if (breakMinutes > expectedBreak) incidents.push("long_break");
  } else if (longCoverageDay && expectedBreak && breakMinutes === null && markings.length % 2 === 0) {
    incidents.push("short_break");
  }
  if (shift?.breakMinPauseMinutes && pauseLengths(markings).some((length) => length < shift.breakMinPauseMinutes!)) {
    if (!incidents.includes("short_break")) incidents.push("short_break");
  }
  // Unidade fixa da escala: batida em outra unidade não é bloqueada, só fica a conferir pelo DP.
  const scheduledUnits = new Set(manualSegments.length ? manualSegments.map((segment) => segment.unitId) : [shift?.unitId]);
  if (shift?.unitId && shift.executionUnitPolicy !== "free" && markings.some((marking) => !scheduledUnits.has(marking.executionUnitId))) {
    incidents.push("other_unit");
  }
  const comparable = past && shift && !absence && markings.length % 2 === 0 && plannedWorkMinutes !== null;
  // Na cobertura, entre o turno e a carga não há saldo no dia (o banco compara com a carga).
  const difference = !comparable ? null
    : coverage ? (worked < coverage.planned ? worked - coverage.planned : Math.max(0, worked - coverage.reference))
    : worked - plannedWorkMinutes!;
  const balanceMinutes = difference === null ? null : Math.abs(difference) <= tolerance ? 0 : difference;
  return { date: input.date, shift: input.shift, manualSegments, markings, allMarkings, absence, incidents, workedMinutes: worked, breakMinutes,
    plannedWorkMinutes, nightMinutes, balanceMinutes, deviation, extendUntil: coverage?.extendUntil ?? null,
    expectedBreakMinutes: expectedBreak };
}

export function monthDates(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

export function buildMonthView(input: { month: string; today: string; shifts: (DayShift & { date: string })[]; markings: (DayMarking & { workDate: string })[]; absences: DayAbsence[]; treatments?: DayTreatment[] }) {
  return monthDates(input.month).map((date) => {
    const shifts = input.shifts.filter((shift) => shift.date === date);
    // Com duas linhas no dia (troca ou cobertura), vale o turno de trabalho.
    const shift = shifts.find((item) => item.type === "work") ?? shifts[0] ?? null;
    // A existência da evidência congela a decisão vigente na batida. Não releia a definição mutável do turno
    // para esconder ou revelar retroativamente um resultado histórico.
    const markings = input.markings.filter((marking) => marking.workDate === date);
    return buildDayView({ date, today: input.today, shift, shifts, markings, absences: input.absences,
      treatments: input.treatments });
  });
}

export const INCIDENT_SEVERITY: Record<DayIncident, "danger" | "warn"> = {
  missing: "danger", odd: "danger", missing_break: "danger", short_break: "danger", late_exit: "warn", long_break: "warn", other_unit: "warn",
  late_start: "warn", early_exit: "warn", coverage_early_exit: "danger",
};
