import {
  type GoalBonusTierConfig,
  type GoalIncentiveMessageRule,
  type GoalMethodConfig,
  type GoalMethodSnapshot,
} from '@/types';

export const DEFAULT_KIOSK_MEDIUM_GOAL_METHOD_ID = 'tiered-kiosk-medium-v1';

export const DEFAULT_KIOSK_MEDIUM_GOAL_METHOD: GoalMethodSnapshot = {
  id: DEFAULT_KIOSK_MEDIUM_GOAL_METHOD_ID,
  name: 'Quiosque médio por faixas',
  type: 'tiered_unit_bonus',
  active: true,
  unitProfile: 'Quiosque médio',
  targetPeriod: 'monthly',
  referenceRevenue: 29000,
  description:
    'Modelo baseado na metodologia Meta | Quiosque Médio: bônus por faixas acumuladas, com valor fixo por faixa e percentual sobre o excedente do piso.',
  tiers: [
    {
      id: 'target',
      label: 'Meta Alvo',
      fromAmount: 29000,
      toAmount: 32000,
      displayTargetAmount: 32000,
      fixedBonusAmount: 100,
      excessPercent: 8,
      description: 'Faixa inicial para superar a média histórica do quiosque.',
    },
    {
      id: 'up',
      label: 'Meta UP',
      fromAmount: 32000,
      toAmount: 35000,
      displayTargetAmount: 35000,
      fixedBonusAmount: 100,
      excessPercent: 10,
      description: 'Faixa de performance superior da unidade.',
    },
    {
      id: 'top',
      label: 'Meta TOP',
      fromAmount: 35000,
      toAmount: null,
      displayTargetAmount: 36000,
      fixedBonusAmount: 100,
      excessPercent: 12,
      description: 'Faixa aberta para resultado acima do patamar máximo da metodologia.',
    },
  ],
  teamBonus: {
    enabled: true,
    splitMode: 'equal',
    eligibleCollaboratorRule: 'all_goal_participants',
    prorateByAttendance: false,
    reliefWorker: {
      enabled: true,
      splitMode: 'proportional_by_covered_shifts',
      turnsPerDay: 2,
      fixedCollaboratorRule: 'remaining_equal_split',
      description:
        'Quando houver folguista, separa a parte proporcional aos turnos cobertos e divide o restante igualmente entre as colaboradoras fixas.',
    },
  },
  leadershipBonus: {
    enabled: true,
    factorNumerator: 1,
    factorDenominator: 3,
  },
  incentiveMessages: [
    {
      id: 'near-next-tier',
      label: 'Perto da próxima faixa',
      triggerType: 'distance_to_next_tier_percent',
      thresholdPercent: 10,
      message: 'Falta pouco para {tierLabel}: R$ {remainingAmount}.',
      tone: 'info',
    },
    {
      id: 'very-near-next-tier',
      label: 'Arrancada final',
      triggerType: 'distance_to_next_tier_percent',
      thresholdPercent: 3,
      message: 'Última arrancada: faltam R$ {remainingAmount} para {tierLabel}.',
      tone: 'warning',
    },
    {
      id: 'tier-reached',
      label: 'Faixa atingida',
      triggerType: 'tier_reached',
      message: '{tierLabel} batida. Bonificação estimada por colaborador: R$ {perCollaboratorBonus}.',
      tone: 'success',
    },
  ],
};

export const DEFAULT_GOAL_METHOD_CONFIGS: GoalMethodSnapshot[] = [
  DEFAULT_KIOSK_MEDIUM_GOAL_METHOD,
];

export interface GoalMethodTargets {
  targetValue: number;
  upValue: number;
  topValue: number;
}

export interface GoalTierBonusResult {
  tier: GoalBonusTierConfig;
  excessAmount: number;
  fixedBonusAmount: number;
  variableBonusAmount: number;
  totalBonusAmount: number;
}

export interface GoalMethodBonusResult {
  revenue: number;
  eligibleCollaboratorCount: number;
  achievedTiers: GoalTierBonusResult[];
  totalTeamBonus: number;
  perCollaboratorBonus: number;
  leadershipBonus: number;
  reliefWorkerSplit: GoalReliefWorkerBonusSplit | null;
  highestAchievedTier: GoalBonusTierConfig | null;
  nextTier: GoalBonusTierConfig | null;
  nextTierThreshold: number | null;
  remainingToNextTier: number | null;
  incentiveMessage: {
    rule: GoalIncentiveMessageRule;
    message: string;
    tone: GoalIncentiveMessageRule['tone'];
  } | null;
}

export interface GoalBonusCalculationOptions {
  reliefWorkerCoveredTurns?: number;
  reliefWorkerCount?: number;
  reliefWorkerCoveredTurnsByPerson?: number[];
  totalPeriodTurns?: number;
  fixedCollaboratorCount?: number;
}

export interface GoalReliefWorkerBonusSplit {
  enabled: boolean;
  totalPeriodTurns: number;
  coveredTurns: number;
  reliefWorkerCount: number;
  reliefWorkerBonuses: number[];
  fixedCollaboratorCount: number;
  reliefWorkerBonus: number;
  totalReliefWorkerBonus: number;
  remainingFixedBonus: number;
  perFixedCollaboratorBonus: number;
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function formatCurrencyBRL(value: number): string {
  return roundMoney(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildGoalMethodSnapshot(config: GoalMethodConfig | GoalMethodSnapshot): GoalMethodSnapshot {
  return {
    id: config.id,
    name: config.name,
    type: config.type,
    active: config.active,
    description: config.description ?? '',
    unitProfile: config.unitProfile ?? '',
    targetPeriod: config.targetPeriod,
    referenceRevenue: config.referenceRevenue,
    tiers: config.tiers.map(tier => ({ ...tier })),
    teamBonus: {
      ...config.teamBonus,
      reliefWorker: config.teamBonus.reliefWorker ? { ...config.teamBonus.reliefWorker } : undefined,
    },
    leadershipBonus: { ...config.leadershipBonus },
    incentiveMessages: config.incentiveMessages.map(rule => ({ ...rule })),
  };
}

export function getTargetsFromGoalMethod(config: GoalMethodConfig | GoalMethodSnapshot): GoalMethodTargets {
  const sorted = [...config.tiers].sort((a, b) => a.fromAmount - b.fromAmount);
  const first = sorted[0];
  const second = sorted[1];
  const third = sorted[2];

  return {
    targetValue: first?.displayTargetAmount ?? first?.toAmount ?? first?.fromAmount ?? 0,
    upValue: second?.displayTargetAmount ?? second?.toAmount ?? second?.fromAmount ?? 0,
    topValue: third?.displayTargetAmount ?? third?.toAmount ?? third?.fromAmount ?? 0,
  };
}

export function applyRevenueTargetsToGoalMethod(
  config: GoalMethodConfig | GoalMethodSnapshot,
  targets: GoalMethodTargets
): GoalMethodSnapshot {
  const targetValue = roundMoney(targets.targetValue);
  const upValue = roundMoney(targets.upValue);
  const topValue = roundMoney(targets.topValue);
  const thresholds = [
    { fromAmount: targetValue, toAmount: upValue, displayTargetAmount: targetValue },
    { fromAmount: upValue, toAmount: topValue, displayTargetAmount: upValue },
    { fromAmount: topValue, toAmount: null, displayTargetAmount: topValue },
  ];

  return {
    ...buildGoalMethodSnapshot(config),
    referenceRevenue: targetValue,
    tiers: config.tiers.map((tier, index) => {
      const threshold = thresholds[index] ?? {
        fromAmount: targetValue,
        toAmount: null,
        displayTargetAmount: targetValue,
      };

      return {
        ...tier,
        ...threshold,
      };
    }),
  };
}

function getNextTier(config: GoalMethodConfig | GoalMethodSnapshot, revenue: number): { tier: GoalBonusTierConfig | null; threshold: number | null } {
  const sorted = [...config.tiers].sort((a, b) => a.fromAmount - b.fromAmount);
  const tier = sorted.find(item => revenue < item.fromAmount) ?? null;
  return { tier, threshold: tier?.fromAmount ?? null };
}

function interpolateMessage(template: string, result: Omit<GoalMethodBonusResult, 'incentiveMessage'>): string {
  const replacements: Record<string, string> = {
    tierLabel: result.nextTier?.label ?? result.highestAchievedTier?.label ?? 'meta',
    remainingAmount: formatCurrencyBRL(result.remainingToNextTier ?? 0),
    currentAmount: formatCurrencyBRL(result.revenue),
    thresholdAmount: formatCurrencyBRL(result.nextTierThreshold ?? 0),
    teamBonus: formatCurrencyBRL(result.totalTeamBonus),
    perCollaboratorBonus: formatCurrencyBRL(result.perCollaboratorBonus),
    leadershipBonus: formatCurrencyBRL(result.leadershipBonus),
  };

  return template.replace(/\{(\w+)\}/g, (_, key: string) => replacements[key] ?? '');
}

function resolveIncentiveMessage(
  config: GoalMethodConfig | GoalMethodSnapshot,
  result: Omit<GoalMethodBonusResult, 'incentiveMessage'>
): GoalMethodBonusResult['incentiveMessage'] {
  const candidateRules = [...(config.incentiveMessages ?? [])].sort((a, b) => {
    const aPercent = a.thresholdPercent ?? Number.POSITIVE_INFINITY;
    const bPercent = b.thresholdPercent ?? Number.POSITIVE_INFINITY;
    return aPercent - bPercent;
  });

  if (result.nextTier && result.nextTierThreshold && result.remainingToNextTier !== null) {
    const remainingPercent = result.nextTierThreshold > 0
      ? (result.remainingToNextTier / result.nextTierThreshold) * 100
      : 0;

    const distanceRule = candidateRules.find(rule => {
      if (rule.tierId && rule.tierId !== result.nextTier?.id) return false;
      if (rule.triggerType === 'distance_to_next_tier_amount') {
        return result.remainingToNextTier !== null && result.remainingToNextTier <= (rule.thresholdAmount ?? 0);
      }
      if (rule.triggerType === 'distance_to_next_tier_percent') {
        return remainingPercent <= (rule.thresholdPercent ?? 0);
      }
      return false;
    });

    if (distanceRule) {
      return {
        rule: distanceRule,
        message: interpolateMessage(distanceRule.message, result),
        tone: distanceRule.tone,
      };
    }
  }

  if (result.highestAchievedTier) {
    const reachedRule = candidateRules.find(rule => {
      if (rule.triggerType !== 'tier_reached') return false;
      return !rule.tierId || rule.tierId === result.highestAchievedTier?.id;
    });

    if (reachedRule) {
      return {
        rule: reachedRule,
        message: interpolateMessage(reachedRule.message, result),
        tone: reachedRule.tone,
      };
    }
  }

  return null;
}

export function calculateTieredGoalBonus(
  config: GoalMethodConfig | GoalMethodSnapshot | null | undefined,
  revenue: number,
  eligibleCollaboratorCount: number,
  options: GoalBonusCalculationOptions = {}
): GoalMethodBonusResult | null {
  if (!config || config.type !== 'tiered_unit_bonus') return null;

  const sortedTiers = [...config.tiers].sort((a, b) => a.fromAmount - b.fromAmount);
  const achievedTiers = sortedTiers
    .filter(tier => revenue >= tier.fromAmount)
    .map(tier => {
      const upperBound = tier.toAmount === null ? revenue : Math.min(revenue, tier.toAmount);
      const excessAmount = Math.max(upperBound - tier.fromAmount, 0);
      const variableBonusAmount = excessAmount * (tier.excessPercent / 100);
      const totalBonusAmount = tier.fixedBonusAmount + variableBonusAmount;
      return {
        tier,
        excessAmount: roundMoney(excessAmount),
        fixedBonusAmount: roundMoney(tier.fixedBonusAmount),
        variableBonusAmount: roundMoney(variableBonusAmount),
        totalBonusAmount: roundMoney(totalBonusAmount),
      };
    });

  const totalTeamBonus = roundMoney(
    config.teamBonus.enabled
      ? achievedTiers.reduce((sum, item) => sum + item.totalBonusAmount, 0)
      : 0
  );
  const safeEligibleCount = Math.max(eligibleCollaboratorCount, 0);
  const perCollaboratorBonus = safeEligibleCount > 0 ? roundMoney(totalTeamBonus / safeEligibleCount) : 0;
  const reliefWorkerConfig = config.teamBonus.reliefWorker;
  const reliefWorkerSplit = reliefWorkerConfig?.enabled ? (() => {
    const totalPeriodTurns = Math.max(options.totalPeriodTurns ?? 0, 0);
    const configuredReliefWorkerCount = Math.max(Math.floor(options.reliefWorkerCount ?? 0), 0);
    const coveredTurnsByPerson = options.reliefWorkerCoveredTurnsByPerson && options.reliefWorkerCoveredTurnsByPerson.length > 0
      ? options.reliefWorkerCoveredTurnsByPerson.map(value => Math.max(value, 0))
      : Array.from({ length: configuredReliefWorkerCount || (options.reliefWorkerCoveredTurns && options.reliefWorkerCoveredTurns > 0 ? 1 : 0) }, () =>
          Math.max(options.reliefWorkerCoveredTurns ?? 0, 0)
        );
    const reliefWorkerCount = coveredTurnsByPerson.length;
    const rawCoveredTurns = coveredTurnsByPerson.reduce((sum, value) => sum + value, 0);
    const coveredTurns = totalPeriodTurns > 0 ? Math.min(rawCoveredTurns, totalPeriodTurns) : rawCoveredTurns;
    const fixedCollaboratorCount = Math.max(options.fixedCollaboratorCount ?? Math.max(safeEligibleCount - 1, 0), 0);

    if (totalPeriodTurns <= 0 || coveredTurns <= 0 || reliefWorkerCount <= 0) {
      return {
        enabled: true,
        totalPeriodTurns,
        coveredTurns,
        reliefWorkerCount,
        reliefWorkerBonuses: Array.from({ length: reliefWorkerCount }, () => 0),
        fixedCollaboratorCount,
        reliefWorkerBonus: 0,
        totalReliefWorkerBonus: 0,
        remainingFixedBonus: totalTeamBonus,
        perFixedCollaboratorBonus: fixedCollaboratorCount > 0 ? roundMoney(totalTeamBonus / fixedCollaboratorCount) : 0,
      };
    }

    const totalReliefWorkerBonus = roundMoney((coveredTurns / totalPeriodTurns) * totalTeamBonus);
    const reliefWorkerBonuses = coveredTurnsByPerson.map(value =>
      roundMoney(totalReliefWorkerBonus * (rawCoveredTurns > 0 ? value / rawCoveredTurns : 0))
    );
    const reliefWorkerBonus = reliefWorkerBonuses[0] ?? 0;
    const remainingFixedBonus = roundMoney(totalTeamBonus - totalReliefWorkerBonus);
    return {
      enabled: true,
      totalPeriodTurns,
      coveredTurns,
      reliefWorkerCount,
      reliefWorkerBonuses,
      fixedCollaboratorCount,
      reliefWorkerBonus,
      totalReliefWorkerBonus,
      remainingFixedBonus,
      perFixedCollaboratorBonus: roundMoney(remainingFixedBonus / fixedCollaboratorCount),
    };
  })() : null;
  const leadershipBonus = config.leadershipBonus.enabled && config.leadershipBonus.factorDenominator > 0
    ? roundMoney(totalTeamBonus * (config.leadershipBonus.factorNumerator / config.leadershipBonus.factorDenominator))
    : 0;
  const highestAchievedTier = achievedTiers.at(-1)?.tier ?? null;
  const next = getNextTier(config, revenue);
  const baseResult = {
    revenue: roundMoney(revenue),
    eligibleCollaboratorCount: safeEligibleCount,
    achievedTiers,
    totalTeamBonus,
    perCollaboratorBonus,
    leadershipBonus,
    reliefWorkerSplit,
    highestAchievedTier,
    nextTier: next.tier,
    nextTierThreshold: next.threshold,
    remainingToNextTier: next.threshold === null ? null : roundMoney(Math.max(next.threshold - revenue, 0)),
  };

  return {
    ...baseResult,
    incentiveMessage: resolveIncentiveMessage(config, baseResult),
  };
}
