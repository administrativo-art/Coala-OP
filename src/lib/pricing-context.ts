import type { EffectivePriceResolution, PriceOverride, ProductSimulation, SalesChannel } from '@/types';

export function buildPriceOverrideId(simulationId: string, unitId: string | null, channelId: string | null) {
  return `simulation:${simulationId}__unit:${unitId ?? 'all'}__channel:${channelId ?? 'all'}`;
}

export function resolveEffectivePrice(
  simulation: Pick<ProductSimulation, 'salePrice' | 'kioskIds'>,
  unitId: string | null,
  channelId: string | null,
  channels: SalesChannel[],
  overrides: PriceOverride[]
): EffectivePriceResolution {
  if (unitId && !(simulation.kioskIds ?? []).includes(unitId)) {
    return {
      price: null,
      available: false,
      source: 'unit-disabled',
      override: null,
    };
  }

  const channel = channelId ? channels.find((entry) => entry.id === channelId) ?? null : null;

  if (channelId && (!channel || !channel.active)) {
    return {
      price: null,
      available: false,
      source: 'channel-inactive',
      override: null,
    };
  }

  const candidates: Array<{
    source: EffectivePriceResolution['source'];
    unitId: string | null;
    channelId: string | null;
  }> = [
    { source: 'override:unit+channel', unitId, channelId },
    { source: 'override:unit', unitId, channelId: null },
    { source: 'override:channel', unitId: null, channelId },
  ];

  for (const candidate of candidates) {
    if (
      (candidate.source === 'override:unit+channel' && (!candidate.unitId || !candidate.channelId)) ||
      (candidate.source === 'override:unit' && !candidate.unitId) ||
      (candidate.source === 'override:channel' && !candidate.channelId)
    ) {
      continue;
    }

    const match =
      overrides.find(
        (override) =>
          override.unitId === candidate.unitId && override.channelId === candidate.channelId
      ) ?? null;

    if (!match) {
      continue;
    }

    return {
      price: match.finalPrice ?? simulation.salePrice ?? 0,
      available: match.available,
      source: candidate.source,
      override: match,
    };
  }

  if (channel?.defaultPriceRule?.mode === 'markup') {
    return {
      price: (simulation.salePrice ?? 0) * (1 + channel.defaultPriceRule.value),
      available: true,
      source: 'channel-default-rule',
      override: null,
    };
  }

  return {
    price: simulation.salePrice ?? 0,
    available: true,
    source: 'global',
    override: null,
  };
}

export function calculateSimulationMetrics(
  salePrice: number,
  totalCmv: number,
  taxPercent: number,
  feePercent: number
) {
  const netRevenue = salePrice * (1 - taxPercent / 100 - feePercent / 100);
  const profitValue = netRevenue - totalCmv;
  const profitPercentage = salePrice > 0 ? (profitValue / salePrice) * 100 : 0;
  const markup = totalCmv > 0 ? salePrice / totalCmv : 0;
  const grossMargin = salePrice - totalCmv;
  const grossMarginPct = salePrice > 0 ? (grossMargin / salePrice) * 100 : 0;

  return {
    netRevenue,
    profitValue,
    profitPercentage,
    markup,
    grossMargin,
    grossMarginPct,
  };
}
