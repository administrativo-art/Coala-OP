import { repPInstantMs } from "./time-zones";

/**
 * Leitura do mês no Registro de ponto: junta escala, batidas originais e ausências por dia e calcula uma
 * prévia (total, intervalo, desvios e alertas). Nada aqui é apuração nem classifica marcação: o REP-P guarda
 * só o instante, e entrada/intervalo/saída e saldo oficial pertencem ao tratamento do ponto (PTRP).
 */

export type DayShift = {
  type: "work" | "day_off";
  startTime: string | null;
  endTime: string | null;
  shiftName: string | null;
  unitName: string | null;
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
};

export type DayMarking = { receiptId: string; markedAt: string; nsr: number; executionUnitId: string; receiptStatus: "available" | "pending" };

export type DayAbsence = { id: string; typeName: string; status: string; startDate: string; endDate: string; approvedByInaction?: boolean };

export type DayIncident = "missing" | "odd" | "late_exit" | "short_break" | "long_break" | "other_unit";

export type DayView = {
  date: string;
  shift: DayShift | null;
  markings: DayMarking[];
  absence: DayAbsence | null;
  incidents: DayIncident[];
  workedMinutes: number;
  breakMinutes: number | null;
  /** Diferença prévia entre o trabalhado e o previsto; null quando não dá para comparar. */
  balanceMinutes: number | null;
  /** Desvio da saída (ou da entrada) acima do limite de aviso, em minutos com sinal. */
  deviation: { edge: "start" | "end"; minutes: number } | null;
};

// Valores provisórios até o cadastro do turno ter tolerância própria (plano mestre 3.6.1).
export const BREAK_TOLERANCE_MINUTES = 5;
export const DEVIATION_NOTICE_MINUTES = 10;

/** Ausência que vale para o dia: aprovada ou em análise; rascunho, recusada e cancelada não contam. */
const ACTIVE_ABSENCE = new Set(["approved", "in_review", "submitted"]);

export function minutesOf(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
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

function shiftMinutes(shift: DayShift) {
  if (!shift.startTime || !shift.endTime) return 0;
  const span = minutesOf(shift.endTime) - minutesOf(shift.startTime);
  return Math.max(0, (span < 0 ? span + 1440 : span) - (shift.breakDurationMinutes ?? 0));
}

export function buildDayView(input: { date: string; today: string; shift: DayShift | null; markings: DayMarking[]; absences: DayAbsence[] }): DayView {
  const markings = [...input.markings].sort((left, right) => repPInstantMs(left.markedAt) - repPInstantMs(right.markedAt) || left.nsr - right.nsr);
  const absence = input.absences.find((item) => ACTIVE_ABSENCE.has(item.status) && item.startDate <= input.date && item.endDate >= input.date) ?? null;
  const shift = input.shift && input.shift.type === "work" ? input.shift : null;
  const past = input.date < input.today;
  const worked = workedMinutes(markings);
  const breakMinutes = breakTaken(markings);
  const incidents: DayIncident[] = [];
  let deviation: DayView["deviation"] = null;

  // Jornada que atravessa a meia-noite tem batidas em dois dias civis: sem tratamento, só o total é mostrado.
  if (shift?.overnight) {
    return { date: input.date, shift: input.shift, markings, absence, incidents, workedMinutes: worked, breakMinutes, balanceMinutes: null, deviation };
  }
  if (past && shift && !markings.length && !absence) incidents.push("missing");
  if (past && markings.length % 2 === 1) incidents.push("odd");
  if (shift && markings.length >= 2 && markings.length % 2 === 0 && shift.startTime && shift.endTime) {
    const endDiff = minutesOf(fiscalClock(markings[markings.length - 1].markedAt)) - minutesOf(shift.endTime);
    const startDiff = minutesOf(fiscalClock(markings[0].markedAt)) - minutesOf(shift.startTime);
    if (Math.abs(endDiff) > DEVIATION_NOTICE_MINUTES) deviation = { edge: "end", minutes: endDiff };
    else if (Math.abs(startDiff) > DEVIATION_NOTICE_MINUTES) deviation = { edge: "start", minutes: startDiff };
    if (endDiff > DEVIATION_NOTICE_MINUTES) incidents.push("late_exit");
  }
  const expectedBreak = shift?.breakDurationMinutes ?? null;
  if (breakMinutes !== null && expectedBreak) {
    if (breakMinutes < expectedBreak - BREAK_TOLERANCE_MINUTES) incidents.push("short_break");
    if (breakMinutes > expectedBreak + BREAK_TOLERANCE_MINUTES) incidents.push("long_break");
  }
  // Unidade fixa da escala: batida em outra unidade não é bloqueada, só fica a conferir pelo DP.
  if (shift?.unitId && shift.executionUnitPolicy !== "free" && markings.some((marking) => marking.executionUnitId !== shift.unitId)) {
    incidents.push("other_unit");
  }
  const balanceMinutes = past && shift && !absence && markings.length % 2 === 0 ? worked - shiftMinutes(shift) : null;
  return { date: input.date, shift: input.shift, markings, absence, incidents, workedMinutes: worked, breakMinutes, balanceMinutes, deviation };
}

export function monthDates(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

export function buildMonthView(input: { month: string; today: string; shifts: (DayShift & { date: string })[]; markings: (DayMarking & { workDate: string })[]; absences: DayAbsence[] }) {
  return monthDates(input.month).map((date) => {
    const shifts = input.shifts.filter((shift) => shift.date === date);
    // Com duas linhas no dia (troca ou cobertura), vale o turno de trabalho.
    const shift = shifts.find((item) => item.type === "work") ?? shifts[0] ?? null;
    return buildDayView({ date, today: input.today, shift, markings: input.markings.filter((marking) => marking.workDate === date), absences: input.absences });
  });
}

export const INCIDENT_SEVERITY: Record<DayIncident, "danger" | "warn"> = {
  missing: "danger", odd: "danger", short_break: "danger", late_exit: "warn", long_break: "warn", other_unit: "warn",
};
