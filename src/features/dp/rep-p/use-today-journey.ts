"use client";

import { useCallback, useEffect, useState } from "react";

import { attributeWorkDate } from "../time-bank/work-date";
import { buildDayView, type DayMarking, type DayShift, type DayView } from "./day-model";
import type { useRepPMarking } from "./use-rep-p-marking";

type Marking = ReturnType<typeof useRepPMarking>;
type MonthPayload = { shifts: (DayShift & { date: string })[]; nightShift?: boolean };
type HistoryPayload = { markings: (DayMarking & { workDate: string })[] };

export const EMPTY_DAY = (date: string): DayView => ({ date, shift: null, markings: [], allMarkings: [], absence: null, incidents: [],
  workedMinutes: 0, breakMinutes: null, plannedWorkMinutes: null, nightMinutes: 0, balanceMinutes: null, deviation: null });

function journeyDate(today: string, yesterday: string, shifts: MonthPayload["shifts"], now: Date) {
  if (!shifts.some((shift) => shift.date === yesterday && shift.workDateRule)) return today;
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return attributeWorkDate(today, `${today}T${clock}`, shifts.map((shift) => ({ date: shift.date, type: shift.type === "day_off" ? "day_off" : "work",
    startTime: shift.startTime ?? null, endTime: shift.endTime ?? null, overnight: shift.overnight })));
}

/**
 * Jornada de hoje para os atalhos de batida fora do Registro de ponto (painel do colaborador e barra superior):
 * turno do dia e batidas de hoje, numa leitura do mês e outra das batidas do dia. `enabled` falso adia a leitura
 * (a barra só lê ao abrir a janela, para não consultar a cada página).
 */
export function useTodayJourney(marking: Marking, enabled: boolean) {
  const { request, today } = marking;
  const [day, setDay] = useState<DayView>(() => EMPTY_DAY(today));
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const readMonth = (month: string) => request<MonthPayload>(`/api/dp/time-recording/month?month=${month}`, { fallbackError: "Não foi possível carregar sua escala." });
    const readHistory = (date: string) => request<HistoryPayload>(`/api/dp/time-recording/markings?${new URLSearchParams({ startDate: date, endDate: date })}`,
      { fallbackError: "Não foi possível carregar as batidas." });
    const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const load = async () => {
      const [month, todayHistory] = await Promise.all([readMonth(today.slice(0, 7)), readHistory(today)]);
      // Só com a regra ligada a jornada pode ser a de ontem; no dia 1º a escala dela está no mês anterior.
      const previousMonth = month.nightShift && yesterday.slice(0, 7) !== today.slice(0, 7)
        ? await readMonth(yesterday.slice(0, 7)).catch(() => null) : null;
      const allShifts = [...(previousMonth?.shifts ?? []), ...month.shifts];
      // Turno da véspera que passa da meia-noite (só vem marcado com a regra ligada): até o limite, a jornada é a dele.
      const date = month.nightShift ? journeyDate(today, yesterday, allShifts, new Date()) : today;
      const history = date === today ? todayHistory : await readHistory(date);
      if (cancelled) return;
      const shifts = allShifts.filter((shift) => shift.date === date);
      const shift = shifts.find((item) => item.type === "work") ?? shifts[0] ?? null;
      setDay(buildDayView({ date, today, shift, shifts, markings: history.markings.filter((item) => item.workDate === date), absences: [] }));
      setLoaded(true);
    };
    load().catch(() => {
      // Sem a leitura, a batida continua possível; só a sugestão da próxima finalidade fica sem base.
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [enabled, request, today, reloadKey]);

  return { day, loaded, reload };
}
