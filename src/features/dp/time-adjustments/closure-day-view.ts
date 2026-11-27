/** Apresentação do dia no modal do fechamento: linha do dia e rótulo na fila. Puro e só de leitura. */
import { fiscalClock, plannedBreakMinutesOf, type DayView } from "../rep-p/day-model";

import type { ClosureDayRow } from "./closure-person-record-model";

const OPEN_ABSENCE = ["submitted", "in_review", "adjustments_requested"];
const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const toClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}h`;

export type DayTimeline = {
  shift: { left: number; width: number } | null;
  segments: Array<{ left: number; width: number }>;
  marks: Array<{ key: string; time: string; left: number; included: boolean }>;
  ticks: string[];
};

/**
 * Posições em porcentagem. Turno que atravessa a meia-noite não é desenhado: as batidas dele caem em dois dias.
 * Só pares fechados viram trecho; batida sem par fica apenas marcada.
 */
export function dayTimeline(day: DayView): DayTimeline | null {
  const work = day.shift?.type === "work" ? day.shift : null;
  // Jornada em trechos também fica de fora: o turno do dia descreve só o primeiro trecho.
  if (work?.overnight || day.manualSegments?.length) return null;
  const marks = day.markings.map((marking) => ({ key: marking.receiptId, time: fiscalClock(marking.markedAt), included: marking.treatment === "included" }));
  const shift = work?.startTime && work.endTime && work.endTime > work.startTime ? [toMinutes(work.startTime), toMinutes(work.endTime)] as const : null;
  const points = [...marks.map((mark) => toMinutes(mark.time)), ...(shift ?? [])];
  if (!points.length) return null;
  const start = Math.max(0, Math.floor((Math.min(...points) - 60) / 60) * 60);
  const end = Math.min(24 * 60, Math.ceil((Math.max(...points) + 60) / 60) * 60);
  const place = (minutes: number) => ((minutes - start) / (end - start)) * 100;
  const segments: DayTimeline["segments"] = [];
  for (let index = 0; index + 1 < marks.length; index += 2) {
    const left = place(toMinutes(marks[index].time));
    segments.push({ left, width: Math.max(0, place(toMinutes(marks[index + 1].time)) - left) });
  }
  const step = Math.max(60, Math.ceil((end - start) / 6 / 60) * 60);
  return {
    shift: shift ? { left: place(shift[0]), width: place(shift[1]) - place(shift[0]) } : null,
    segments,
    marks: marks.map((mark) => ({ ...mark, left: place(toMinutes(mark.time)) })),
    ticks: Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, index) => toClock(start + index * step)),
  };
}

/**
 * O quadro "previsto × feito" só aparece quando o alerta de intervalo vem dessa mesma conta. Intrajornada pela política,
 * cobertura, pausa mínima, jornada em trechos e turno da noite comparam outra coisa e poderiam contradizer o alerta.
 */
export function breakSummary(day: DayView) {
  const work = day.shift?.type === "work" ? day.shift : null;
  const expected = day.expectedBreakMinutes ?? plannedBreakMinutesOf(work);
  if (!work || work.intrajornada || work.coverage || work.breakMinPauseMinutes || work.overnight || day.manualSegments?.length) return null;
  if (day.markings.length % 2 === 1 || day.markings.length < 4 || day.breakMinutes === null || expected <= 0) return null;
  if (!day.incidents.some((incident) => incident === "short_break" || incident === "long_break")) return null;
  return { expected, done: day.breakMinutes, difference: day.breakMinutes - expected };
}

export type QueueTag = { label: "pedido" | "ausência" | "alerta" | "liberado" | "aviso" | "noite"; tone: "warn" | "info" | "danger" | "neutral" };

/** Rótulo da fila a partir da situação que o registro já calculou com a resposta do servidor. */
export function queueTag(row: Pick<ClosureDayRow, "kind" | "released" | "day">): QueueTag {
  if (row.kind === "request") return row.day.absence && OPEN_ABSENCE.includes(row.day.absence.status) ? { label: "ausência", tone: "info" } : { label: "pedido", tone: "warn" };
  if (row.released) return { label: "liberado", tone: "neutral" };
  if (row.kind === "alert") return { label: "alerta", tone: "danger" };
  if (row.kind === "overnight") return { label: "noite", tone: "warn" };
  return { label: "aviso", tone: "neutral" };
}
