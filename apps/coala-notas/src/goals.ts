import type { User } from "@firebase/auth";

import { authenticatedJson } from "./upload";

export type GoalLevel = { id: "target" | "up" | "top"; label: string; amount: number; reached: boolean };
export type UnitGoal = {
  id: string;
  typeLabel: string;
  startDate: string;
  endDate: string;
  summary: {
    currentValue: number;
    levels: GoalLevel[];
    percentOfTarget: number;
    nextLevel: { label: string; remaining: number } | null;
    totalDays: number;
    elapsedDays: number;
    remainingDays: number;
    cumulative: boolean;
    projection: number | null;
    neededDaily: number | null;
    dailyTarget: number | null;
  };
  days: Array<{ date: string; value: number; reachedDailyTarget: boolean | null }>;
  team: Array<{ name: string; avatarUrl?: string | null; isMe: boolean; role: "fixed" | "relief" | "leader"; currentValue: number; targetValue: number; percent: number; prize: number | null }>;
  prize: null | {
    methodName: string;
    tiers: Array<{ label: string; fromAmount: number; fixedBonusAmount: number; excessPercent: number; reached: boolean }>;
    highestTierLabel: string | null;
    nextTier: { label: string; remaining: number } | null;
    totalTeamBonus: number;
    leadershipBonus: number;
    message: string | null;
  };
};
export type GoalUnit = { id: string; name: string };
export type UnitGoals = { kioskId: string; today: string; goals: UnitGoal[] };

export function loadGoalUnits(user: User) {
  return authenticatedJson<{ units: GoalUnit[] }>(user, "/api/goals/mobile");
}

export function loadUnitGoals(user: User, kioskId: string) {
  return authenticatedJson<UnitGoals>(user, `/api/goals/mobile?kioskId=${encodeURIComponent(kioskId)}`);
}

/** Valores de meta chegam em reais; no cartão principal os centavos só atrapalham. */
export const formatMoney = (value: number, cents = false) => {
  const rounded = cents ? Math.round(value * 100) / 100 : Math.round(value);
  const [whole, fraction] = rounded.toFixed(cents ? 2 : 0).split(".");
  return `R$ ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${fraction ? `,${fraction}` : ""}`;
};

export const simulationGoalUnits: GoalUnit[] = [{ id: "simulation-unit", name: "Unidade de simulação" }];

export function createSimulationUnitGoals(): UnitGoals {
  const today = new Date();
  const key = (day: number) => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const elapsed = Math.max(today.getDate(), 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: elapsed }, (_, index) => {
    const value = 1500 + ((index * 937) % 1100);
    return { date: key(elapsed - index), value, reachedDailyTarget: value >= 2000 };
  });
  const currentValue = days.reduce((sum, day) => sum + day.value, 0);
  const target = lastDay * 2000;
  return {
    kioskId: "simulation-unit", today: key(elapsed),
    goals: [{
      id: "simulation-goal", typeLabel: "Faturamento", startDate: key(1), endDate: key(lastDay),
      summary: {
        currentValue,
        levels: [{ id: "target", label: "Meta", amount: target, reached: currentValue >= target }, { id: "up", label: "UP", amount: target * 1.2, reached: false }, { id: "top", label: "TOP", amount: target * 1.4, reached: false }],
        percentOfTarget: Math.round((currentValue / target) * 100),
        nextLevel: currentValue < target ? { label: "Meta", remaining: target - currentValue } : { label: "UP", remaining: target * 1.2 - currentValue },
        totalDays: lastDay, elapsedDays: elapsed, remainingDays: lastDay - elapsed, cumulative: true,
        projection: (currentValue / elapsed) * lastDay,
        neededDaily: lastDay > elapsed ? Math.max(target - currentValue, 0) / (lastDay - elapsed) : null,
        dailyTarget: 2000,
      },
      days,
      team: [
        { name: "Ana (simulação)", isMe: true, role: "fixed", currentValue: currentValue * 0.36, targetValue: target * 0.34, percent: 71, prize: 120 },
        { name: "Bia (simulação)", isMe: false, role: "fixed", currentValue: currentValue * 0.34, targetValue: target * 0.34, percent: 66, prize: 120 },
        { name: "Caio (simulação)", isMe: false, role: "relief", currentValue: currentValue * 0.3, targetValue: target * 0.32, percent: 62, prize: 60 },
      ],
      prize: {
        methodName: "Método de simulação",
        tiers: [{ label: "Meta", fromAmount: target, fixedBonusAmount: 300, excessPercent: 2, reached: currentValue >= target }, { label: "UP", fromAmount: target * 1.2, fixedBonusAmount: 500, excessPercent: 3, reached: false }],
        highestTierLabel: currentValue >= target ? "Meta" : null,
        nextTier: { label: currentValue >= target ? "UP" : "Meta", remaining: (currentValue >= target ? target * 1.2 : target) - currentValue },
        totalTeamBonus: 300, leadershipBonus: 0, message: "Valores de exemplo: nada aqui vem do Coala One.",
      },
    }],
  };
}
