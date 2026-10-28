"use client";

import { useCallback, useEffect, useState } from "react";

import { buildDayView, type DayMarking, type DayShift, type DayView } from "./day-model";
import type { useRepPMarking } from "./use-rep-p-marking";

type Marking = ReturnType<typeof useRepPMarking>;
type MonthPayload = { shifts: (DayShift & { date: string })[] };
type HistoryPayload = { markings: (DayMarking & { workDate: string })[] };

export const EMPTY_DAY = (date: string): DayView => ({ date, shift: null, markings: [], allMarkings: [], absence: null, incidents: [],
  workedMinutes: 0, breakMinutes: null, plannedWorkMinutes: null, nightMinutes: 0, balanceMinutes: null, deviation: null });

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
    Promise.all([
      request<MonthPayload>(`/api/dp/time-recording/month?month=${today.slice(0, 7)}`, { fallbackError: "Não foi possível carregar sua escala." }),
      request<HistoryPayload>(`/api/dp/time-recording/markings?${new URLSearchParams({ startDate: today, endDate: today })}`,
        { fallbackError: "Não foi possível carregar as batidas." }),
    ]).then(([month, history]) => {
      if (cancelled) return;
      const shifts = month.shifts.filter((shift) => shift.date === today);
      const shift = shifts.find((item) => item.type === "work") ?? shifts[0] ?? null;
      setDay(buildDayView({ date: today, today, shift, markings: history.markings.filter((item) => item.workDate === today), absences: [] }));
      setLoaded(true);
    }).catch(() => {
      // Sem a leitura, a batida continua possível; só a sugestão da próxima finalidade fica sem base.
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [enabled, request, today, reloadKey]);

  return { day, loaded, reload };
}
