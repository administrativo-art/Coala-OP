import type { EmployeeGoal, GoalParticipantRole, GoalPeriodDoc } from '@/types';

export interface EmployeeEarningsRow {
  employeeId: string;
  /** Períodos encerrados em que a pessoa participou. */
  periodCount: number;
  /** Períodos encerrados com premiação apurada em que a pessoa aparece. */
  prizedPeriodCount: number;
  revenue: number;
  target: number;
  /** Premiação recebida (apurada no encerramento). */
  prize: number;
  /** Média simples do atingimento individual por período (%). */
  avgAttainment: number;
  bestAttainment: number;
  role: GoalParticipantRole | null;
  kioskIds: string[];
  /** Pontos percentuais: média das últimas 3 metas menos a média das 3 anteriores. Nulo com menos de 4 metas. */
  trend: number | null;
}

/**
 * Consolida o que cada colaborador faturou e ganhou de premiação nos períodos informados.
 * Só períodos encerrados contam; a premiação vem do snapshot gravado no encerramento,
 * então períodos sem apuração entram com premiação zero.
 */
export function buildEmployeeEarnings(periods: GoalPeriodDoc[], employeeGoals: EmployeeGoal[]): EmployeeEarningsRow[] {
  const closed = new Map(periods.filter(period => period.status === 'closed').map(period => [period.id, period]));
  const byEmployee = new Map<string, {
    perPeriod: Map<string, { revenue: number; target: number; endsAt: number }>;
    prize: number;
    prizedPeriods: Set<string>;
    role: GoalParticipantRole | null;
    kioskIds: Set<string>;
  }>();

  for (const goal of employeeGoals) {
    const period = closed.get(goal.periodId);
    if (!period) continue;
    let entry = byEmployee.get(goal.employeeId);
    if (!entry) {
      entry = { perPeriod: new Map(), prize: 0, prizedPeriods: new Set(), role: null, kioskIds: new Set() };
      byEmployee.set(goal.employeeId, entry);
    }
    const slot = entry.perPeriod.get(period.id) ?? { revenue: 0, target: 0, endsAt: period.endDate?.toDate?.()?.getTime?.() ?? 0 };
    slot.revenue += goal.currentValue ?? 0;
    slot.target += goal.targetValue ?? 0;
    entry.perPeriod.set(period.id, slot);
    entry.kioskIds.add(period.kioskId);
    if (goal.participantRole === 'leader') entry.role = 'leader';
    else if (goal.participantRole === 'relief' && entry.role !== 'leader') entry.role = 'relief';
    else if (!entry.role) entry.role = 'fixed';
  }

  for (const period of closed.values()) {
    for (const participant of period.closureSnapshot?.bonus?.participants ?? []) {
      const entry = byEmployee.get(participant.employeeId);
      if (!entry) continue;
      entry.prize += participant.bonusAmount;
      entry.prizedPeriods.add(period.id);
    }
  }

  return [...byEmployee.entries()]
    .map(([employeeId, entry]) => {
      const attainments = [...entry.perPeriod.values()].map(slot => (slot.target > 0 ? (slot.revenue / slot.target) * 100 : 0));
      return {
        employeeId,
        periodCount: entry.perPeriod.size,
        prizedPeriodCount: entry.prizedPeriods.size,
        revenue: [...entry.perPeriod.values()].reduce((sum, slot) => sum + slot.revenue, 0),
        target: [...entry.perPeriod.values()].reduce((sum, slot) => sum + slot.target, 0),
        prize: Math.round(entry.prize * 100) / 100,
        avgAttainment: attainments.length ? attainments.reduce((sum, value) => sum + value, 0) / attainments.length : 0,
        bestAttainment: attainments.length ? Math.max(...attainments) : 0,
        role: entry.role,
        kioskIds: [...entry.kioskIds],
        trend: computeTrend([...entry.perPeriod.values()].sort((a, b) => a.endsAt - b.endsAt).map(slot => (slot.target > 0 ? (slot.revenue / slot.target) * 100 : 0))),
      };
    })
    .sort((a, b) => b.prize - a.prize || b.revenue - a.revenue);
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** `attainments` em ordem cronológica. */
export function computeTrend(attainments: number[]): number | null {
  if (attainments.length < 4) return null;
  const recent = attainments.slice(-3);
  const previous = attainments.slice(Math.max(0, attainments.length - 6), -3);
  return Math.round((mean(recent) - mean(previous)) * 10) / 10;
}

/** Faixa alcançada pelo realizado, pelos valores do próprio período. */
export function reachedTier(period: Pick<GoalPeriodDoc, 'currentValue' | 'targetValue' | 'upValue' | 'topValue'>): 'top' | 'up' | 'target' | 'below' {
  if (period.topValue && period.currentValue >= period.topValue) return 'top';
  if (period.upValue && period.currentValue >= period.upValue) return 'up';
  if (period.targetValue > 0 && period.currentValue >= period.targetValue) return 'target';
  return 'below';
}

/** Totais de premiação de um conjunto de períodos (só encerrados com apuração gravada). */
export function summarizePrizes(periods: GoalPeriodDoc[]) {
  const tiered = periods.filter(period => period.status === 'closed' && period.goalMethodSnapshot?.type === 'tiered_unit_bonus');
  const apurated = tiered.filter(period => period.closureSnapshot?.bonus);
  return {
    totalPrize: Math.round(apurated.reduce((sum, period) => sum + (period.closureSnapshot?.bonus?.totalPrize ?? 0), 0) * 100) / 100,
    apuratedCount: apurated.length,
    pendingCount: tiered.length - apurated.length,
  };
}
