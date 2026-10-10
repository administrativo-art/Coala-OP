import type { User } from "@firebase/auth";

import { authenticatedJson } from "./upload";

export type SchedulePerson = { name: string; role: string; isMe: boolean; avatarUrl: string | null };
export type ScheduleShift = { person: number; date: string; startTime: string; endTime: string; type: "work" | "day_off"; shiftName: string };
export type ScheduleUnit = { id: string; name: string; people: SchedulePerson[]; shifts: ScheduleShift[] };
export type MonthSchedule = { today: string; year: number; month: number; published: boolean; units: ScheduleUnit[] };

export function loadMonthSchedule(user: User, year: number, month: number) {
  return authenticatedJson<MonthSchedule>(user, `/api/dp/mobile-schedule?year=${year}&month=${month}`);
}

const DAY_MS = 86_400_000;
const toTime = (key: string) => Date.parse(`${key}T12:00:00.000Z`);
export const shiftDay = (key: string, days: number) => new Date(toTime(key) + days * DAY_MS).toISOString().slice(0, 10);
export const monthKey = (key: string) => key.slice(0, 7);
export const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
export const weekdayOf = (key: string) => new Date(toTime(key)).getUTCDay();

/** Semana de segunda a domingo que contém o dia. */
export function weekOf(key: string) {
  const monday = shiftDay(key, -((weekdayOf(key) + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDay(monday, index));
}

export function createSimulationSchedule(year: number, month: number, today: string): MonthSchedule {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const lastDay = new Date(year, month, 0).getDate();
  const people: SchedulePerson[] = [
    { name: "Ana (simulação)", role: "Atendente", isMe: true, avatarUrl: null },
    { name: "Bia (simulação)", role: "Atendente", isMe: false, avatarUrl: null },
    { name: "Caio (simulação)", role: "Folguista", isMe: false, avatarUrl: null },
  ];
  const shifts: ScheduleShift[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${prefix}-${String(day).padStart(2, "0")}`;
    // Rodízio simples: cada pessoa folga um dia a cada três; as outras duas cobrem manhã e tarde.
    const off = day % 3;
    people.forEach((_, person) => {
      if (person === off) shifts.push({ person, date, startTime: "", endTime: "", type: "day_off", shiftName: "Folga" });
      else {
        const morning = (person + 3 - off) % 3 === 1;
        shifts.push({ person, date, startTime: morning ? "08:00" : "14:00", endTime: morning ? "14:00" : "20:00", type: "work", shiftName: morning ? "Manhã" : "Tarde" });
      }
    });
  }
  return { today, year, month, published: true, units: [{ id: "simulation-unit", name: "Unidade de simulação", people, shifts }] };
}
