/**
 * Aviso de intervalo da faixa de registro (plano mestre 3.6.1). Calculado na tela com a hora oficial e o turno
 * escalado de hoje, pela ordem das batidas: 1ª entrada; depois pares saída/volta; ímpar = trabalhando, par = em pausa.
 * Só orienta: nunca bloqueia a batida (art. 74) e não é apuração.
 */
import { fiscalClock, minutesOf, type DayMarking, type DayShift } from "./day-model";

// Antecedência dos avisos: provisória até decisão do programador.
export const BREAK_INFO_AHEAD_MINUTES = 15;
export const BREAK_WARN_AHEAD_MINUTES = 10;

export type BreakLevel = "neutral" | "info" | "warn" | "danger" | "ok";
export type BreakStatus = {
  level: BreakLevel;
  headline: string;
  detail: string | null;
  usedMinutes: number;
  totalMinutes: number;
  pausesDone: number;
  plannedPauses: number | null;
  inPause: boolean;
};

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const inMinutes = (value: number) => value <= 0 ? "agora" : `em ${value} min`;
const left = (value: number) => value === 1 ? "falta 1 min" : `faltam ${value} min`;

/** Pausas previstas: fixo intercalado = horários; várias pausas = quantidade (ou em aberto); demais = 1. */
export function plannedPausesOf(shift: DayShift) {
  if (shift.breakType === "fixed") return shift.breakSegments?.length ?? 1;
  if (shift.breakSplit === "multiple") return shift.breakPauseCount ?? null;
  return 1;
}

export function breakStatus(shift: DayShift | null, markings: Pick<DayMarking, "markedAt">[], now: number): BreakStatus | null {
  if (!shift || shift.type !== "work" || shift.breakType === "none" || !shift.endTime) return null;
  const total = shift.breakDurationMinutes ?? 0;
  if (!total) return null;
  const times = markings.map((marking) => minutesOf(fiscalClock(marking.markedAt)));
  const closed: { start: number; end: number }[] = [];
  for (let index = 1; index + 1 < times.length; index += 2) closed.push({ start: times[index], end: times[index + 1] });
  const inPause = times.length >= 2 && times.length % 2 === 0;
  const pauseStart = inPause ? times[times.length - 1] : null;
  const closedUsed = closed.reduce((sum, pause) => sum + pause.end - pause.start, 0);
  const used = closedUsed + (pauseStart !== null ? Math.max(0, now - pauseStart) : 0);
  const remaining = Math.max(0, total - used);
  const planned = plannedPausesOf(shift);
  const base = { usedMinutes: used, totalMinutes: total, pausesDone: closed.length, plannedPauses: planned, inPause };
  const progress = planned === 1 ? null
    : `Usados ${used} de ${total} min · ${closed.length}${planned ? ` de ${planned}` : ""} ${closed.length === 1 && !planned ? "pausa" : "pausas"}`;
  const above = shift.breakToleranceAboveMinutes;
  if (above != null && used > total + above) {
    return { ...base, level: "danger", headline: `Intervalo passou de ${total} min (${used} min)`, detail: `Tolerância de ${above} min do turno excedida.` };
  }

  // Fixo (único ou intercalado): proximidade do início e do fim de cada horário.
  if (shift.breakType === "fixed") {
    const segments = shift.breakSegments?.length ? shift.breakSegments
      : shift.breakStart && shift.breakEnd ? [{ start: shift.breakStart, end: shift.breakEnd }] : [];
    if (!segments.length) return null;
    if (closed.length >= segments.length && !inPause) return { ...base, level: "ok", headline: `Intervalo feito · ${used} min`, detail: null };
    const index = Math.min(closed.length, segments.length - 1);
    const segment = segments[index];
    const start = minutesOf(segment.start);
    const end = minutesOf(segment.end);
    const label = segments.length > 1 ? `${index + 1}ª pausa ` : "Intervalo ";
    if (inPause) {
      const back = end - now;
      return { ...base, level: back < -(above ?? 0) ? "danger" : back <= 2 ? "warn" : "info",
        headline: back < 0 ? `Passou do fim do intervalo há ${-back} min` : `Em intervalo · volte às ${segment.end} (${left(back)})`, detail: progress };
    }
    if (now > end) return { ...base, level: "danger", headline: `${label}${segment.start}–${segment.end} não foi feita`, detail: "Registre a saída para o intervalo assim que puder." };
    if (now >= start) return { ...base, level: "warn", headline: `${label}começou às ${segment.start} · termina às ${segment.end}`, detail: "Registre a saída para o intervalo." };
    const ahead = start - now;
    return { ...base, level: ahead <= BREAK_INFO_AHEAD_MINUTES ? "info" : "neutral", headline: `${label}${segment.start}–${segment.end} · começa ${inMinutes(ahead)}`, detail: progress };
  }

  // Livre e janela: limite para iniciar = fim do turno/janela − o que ainda falta de intervalo.
  if (remaining === 0 && !inPause) return { ...base, level: "ok", headline: `Intervalo feito · ${used} min`, detail: null };
  const windowStart = shift.breakType === "staggered" && shift.breakWindowStart ? minutesOf(shift.breakWindowStart) : null;
  const windowEnd = shift.breakType === "staggered" && shift.breakWindowEnd ? minutesOf(shift.breakWindowEnd) : null;
  // Janela que passa do fim do turno vale até o fim do turno.
  const limit = Math.min(windowEnd ?? Number.POSITIVE_INFINITY, minutesOf(shift.endTime)) - remaining;
  const where = windowEnd !== null ? "dentro da janela" : "antes do fim do turno";
  if (inPause && pauseStart !== null) {
    const back = pauseStart + (total - closedUsed) - now;
    return { ...base, level: back <= 2 ? "warn" : "info",
      headline: planned === 1 ? `Em intervalo · volte às ${hhmm(now + Math.max(0, back))} (${left(Math.max(0, back))})`
        : `Em pausa há ${now - pauseStart} min · restam ${remaining} min de intervalo`,
      detail: progress };
  }
  if (windowStart !== null && now < windowStart) {
    const ahead = windowStart - now;
    return { ...base, level: ahead <= BREAK_INFO_AHEAD_MINUTES ? "info" : "neutral",
      headline: `Janela ${shift.breakWindowStart}–${shift.breakWindowEnd} abre ${inMinutes(ahead)}`, detail: `Inicie o intervalo até ${hhmm(limit)}.` };
  }
  const toLimit = limit - now;
  if (toLimit < 0) {
    return { ...base, level: "danger",
      headline: windowEnd !== null && now > windowEnd ? "A janela fechou sem o intervalo completo" : `Limite para iniciar passou (era ${hhmm(limit)})`,
      detail: `Faltam ${remaining} min de intervalo.` };
  }
  return { ...base, level: toLimit <= BREAK_WARN_AHEAD_MINUTES ? "warn" : windowEnd !== null ? "info" : "neutral",
    headline: `${closed.length ? `Faltam ${remaining} min de intervalo` : `Faça ${total} min de intervalo`} · inicie até ${hhmm(limit)}`,
    detail: toLimit <= BREAK_WARN_AHEAD_MINUTES ? `Faltam ${toLimit} min para o limite ${where}.` : progress ?? `Limite ${where}.` };
}
