/**
 * Registro do mês de uma pessoa no fechamento do ponto: situação de cada dia, indicadores e totais. Puro e só de
 * leitura: usa os dias já calculados pelo contrato central. Quem decide o que trava o fechamento é o servidor
 * (`closures?alerts=1`); sem essa resposta, a tela diz "a conferir" e não afirma que o dia trava.
 */
import { INCIDENT_SEVERITY, type DayIncident, type DayView } from "../rep-p/day-model";
import type { BankStatementLine } from "../time-bank/core";

import type { ClosurePerson } from "./closure-core";
import type { AdjustmentView } from "./types";

const OPEN_ABSENCE = ["submitted", "in_review", "adjustments_requested"];

export type ClosureDayKind = "future" | "today" | "request" | "automatic_absence" | "alert" | "warning" | "overnight" | "absence" | "day_off" | "unscheduled" | "clear";
export type ClosureDayTone = "ok" | "warn" | "danger" | "neutral" | "info";

/** Alerta devolvido pelo servidor para a pessoa: trava enquanto não tiver decisão. */
export type ServerDayAlert = { date: string; released: boolean };
/** `null` = o servidor não informou (mês em andamento, falha ou alerta fora do escopo de quem consulta). */
export type PersonServerAlerts = ServerDayAlert[] | null;

export type ClosureDayRow = { day: DayView; kind: ClosureDayKind; blocks: boolean; released: boolean; needsTreatment: boolean };

/**
 * Datas com falta lançada pelo sistema. Vêm da declaração do fechamento: a consulta do ponto de um colaborador lê só os
 * pedidos de ausência, então o cruzamento é pela data, não pelo identificador.
 */
export function automaticAbsenceDates(person: Pick<ClosurePerson, "absences">) {
  return new Set(person.absences.filter((item) => item.automatic).map((item) => item.startDate));
}

const isAutomaticAbsenceDay = (day: DayView, dates: Set<string>) => dates.has(day.date) && !day.markings.length && !day.absence;

/** Como o servidor: o dia com falta automática já está explicado e não é "dia sem batidas". */
export function applyAutomaticAbsences(days: DayView[], dates: Set<string>) {
  return days.map((day) => isAutomaticAbsenceDay(day, dates)
    ? { ...day, incidents: day.incidents.filter((incident) => incident !== "missing"), balanceMinutes: null } : day);
}

/** Dia que pede ação do DP: alerta, ajuste em análise ou ausência sem decisão; hoje e futuro nunca. */
export function dayNeedsTreatment(day: DayView, adjustments: AdjustmentView[], today: string) {
  if (day.date >= today) return false;
  return day.incidents.length > 0
    || adjustments.some((item) => item.workDate === day.date && item.status === "in_review")
    || Boolean(day.absence && OPEN_ABSENCE.includes(day.absence.status));
}

const hasDanger = (incidents: DayIncident[]) => incidents.some((incident) => INCIDENT_SEVERITY[incident] === "danger");

export function closureDayRow(day: DayView, input: { today: string; adjustments: AdjustmentView[]; automaticDates: Set<string>; alerts: PersonServerAlerts }): ClosureDayRow {
  const alert = input.alerts?.find((item) => item.date === day.date) ?? null;
  const pendingRequest = input.adjustments.some((item) => item.workDate === day.date && item.status === "in_review")
    || Boolean(day.absence && OPEN_ABSENCE.includes(day.absence.status));
  // Alerta já liberado pelo RH não volta para a fila, a não ser que haja pedido sem decisão no dia.
  const base = { day, blocks: Boolean(alert && !alert.released), released: Boolean(alert?.released),
    needsTreatment: dayNeedsTreatment(day, input.adjustments, input.today) && (!alert?.released || pendingRequest) };
  const row = (kind: ClosureDayKind): ClosureDayRow => ({ ...base, kind });
  if (day.date > input.today) return row("future");
  if (day.date === input.today) return row("today");
  if (pendingRequest) return row("request");
  if (isAutomaticAbsenceDay(day, input.automaticDates)) return row("automatic_absence");
  // Com a resposta do servidor, só é alerta o que ele aponta; o que a tela calcula a mais vira aviso.
  if (alert || (input.alerts === null && hasDanger(day.incidents))) return row("alert");
  if (day.incidents.length) return row("warning");
  if (day.absence) return row("absence");
  // O cálculo do dia não gera falta nem batida ímpar em turno que atravessa a meia-noite: sem alerta não é "sem ocorrência".
  if (day.shift?.type === "work" && (day.shift.overnight || day.shift.workDateRule)) return row("overnight");
  if (day.shift?.type === "day_off") return row("day_off");
  if (!day.shift) return row(day.markings.length ? "clear" : "unscheduled");
  return row("clear");
}

/** Dias que seguram a etapa de saneamento. Pedido sem decisão é contado à parte pela trilha. */
export function closureTrailProblemDays(rows: ClosureDayRow[]) {
  return rows.filter((item) => item.blocks || (item.kind === "alert" && !item.released)).length;
}

/** Mesmo critério do servidor para "mês terminado": a data de Rio Branco, um dia atrás. */
export function closureMonthEnded(competence: string, now: Date) {
  const reference = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Rio_Branco", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(now.getTime() - 86_400_000));
  return competence < reference.slice(0, 7);
}

export function closureRecordIndicators(rows: ClosureDayRow[], person: Pick<ClosurePerson, "adjustments" | "absences" | "shiftSwaps">) {
  const past = rows.filter((item) => item.kind !== "future" && item.kind !== "today");
  const scheduled = past.filter((item) => item.day.shift?.type === "work");
  const count = (kind: ClosureDayKind) => past.filter((item) => item.kind === kind).length;
  return {
    scheduledDays: scheduled.length,
    clearDays: scheduled.filter((item) => item.kind === "clear").length,
    alertDays: count("alert"),
    blockingDays: past.filter((item) => item.blocks).length,
    warningDays: count("warning") + count("overnight"),
    automaticAbsences: person.absences.filter((item) => item.automatic).length,
    openRequests: person.adjustments.filter((item) => item.status === "in_review").length
      + person.absences.filter((item) => OPEN_ABSENCE.includes(item.status)).length
      + person.shiftSwaps.filter((item) => item.status === "pending").length,
    approvedAbsences: person.absences.filter((item) => !item.automatic && item.status === "approved").length,
    toTreat: past.filter((item) => item.needsTreatment).length,
    withoutOccurrence: past.filter((item) => item.kind === "clear").length,
  };
}

/** Horas do mês, em prévia: dias do contrato central e lançamentos do extrato na competência. */
export function closureRecordHours(rows: ClosureDayRow[], lines: Array<{ competence: string; line: BankStatementLine["line"] }> | null, competence: string) {
  const past = rows.filter((item) => item.kind !== "future" && item.kind !== "today");
  const sum = (items: ClosureDayRow[], pick: (day: DayView) => number) => items.reduce((total, item) => total + pick(item.day), 0);
  const month = lines?.filter((item) => item.competence === competence) ?? null;
  const bank = (nature: BankStatementLine["line"]["nature"]) => month?.filter((item) => item.line.nature === nature).reduce((total, item) => total + item.line.minutes, 0) ?? 0;
  return {
    plannedMinutes: sum(past.filter((item) => item.day.shift?.type === "work"), (day) => day.plannedWorkMinutes ?? 0),
    workedMinutes: sum(past, (day) => day.workedMinutes),
    nightMinutes: sum(past, (day) => day.nightMinutes),
    automaticAbsenceMinutes: sum(past.filter((item) => item.kind === "automatic_absence"), (day) => day.plannedWorkMinutes ?? 0),
    payrollOvertimeMinutes: month ? bank("payroll_overtime") : null,
    bankBalanceMinutes: month ? bank("bank_credit") - bank("bank_debit") : null,
  };
}

export type ClosurePersonFlags = { requests: number; alerts: number | null; automaticAbsences: number };

/** Falta automática fica marcada na pessoa, mas não há o que decidir nela: não conta como pendência. */
export const hasSomethingToTreat = (flags: ClosurePersonFlags) => flags.requests > 0 || (flags.alerts ?? 0) > 0;

/** Quem abre ao entrar no mês: a primeira da lista (alfabética) com algo a tratar; sem ninguém, a primeira. */
export function firstPersonToOpen(people: Array<{ uid: string; flags: ClosurePersonFlags }>) {
  return (people.find((item) => hasSomethingToTreat(item.flags)) ?? people[0])?.uid ?? null;
}

export type ServerAlertsResponse = { alerts: Array<{ employeeUid: string; date: string; decision: unknown }>; pendingOutsideScope: number };

/** Com alerta fora do escopo, não dá para saber de quem é: ninguém recebe contagem do servidor. */
export function alertsByPerson(response: ServerAlertsResponse | null): ((uid: string) => PersonServerAlerts) {
  if (!response || response.pendingOutsideScope > 0) return () => null;
  return (uid) => response.alerts.filter((item) => item.employeeUid === uid).map((item) => ({ date: item.date, released: Boolean(item.decision) }));
}
