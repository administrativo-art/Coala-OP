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
  const scopedUnitIds = simulation.kioskIds ?? [];
  if (unitId && scopedUnitIds.length > 0 && !scopedUnitIds.includes(unitId)) {
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

  const contextOverride =
    unitId && channelId
      ? overrides.find(
          (override) => override.unitId === unitId && override.channelId === channelId
        ) ?? null
      : null;

  if (contextOverride) {
    return {
      price: contextOverride.finalPrice ?? simulation.salePrice ?? 0,
      available: contextOverride.available,
      source: 'override:unit+channel',
      override: contextOverride,
    };
  }

  const unitOverride =
    unitId
      ? overrides.find(
          (override) => override.unitId === unitId && override.channelId === null
        ) ?? null
      : null;

  if (unitOverride && !unitOverride.available) {
    return {
      price: unitOverride.finalPrice ?? simulation.salePrice ?? 0,
      available: false,
      source: 'override:unit',
      override: unitOverride,
    };
  }

  const unitPrice = unitOverride?.finalPrice ?? simulation.salePrice ?? 0;

  if (unitOverride && channel?.defaultPriceRule?.mode === 'markup') {
    return {
      price: unitPrice * (1 + channel.defaultPriceRule.value),
      available: true,
      source: 'channel-default-rule',
      override: null,
    };
  }

  if (unitOverride) {
    return {
      price: unitPrice,
      available: true,
      source: 'override:unit',
      override: unitOverride,
    };
  }

  const channelOverride =
    channelId
      ? overrides.find(
          (override) => override.unitId === null && override.channelId === channelId
        ) ?? null
      : null;

  if (channelOverride) {
    return {
      price: channelOverride.finalPrice ?? simulation.salePrice ?? 0,
      available: channelOverride.available,
      source: 'override:channel',
      override: channelOverride,
    };
  }

  if (channel?.defaultPriceRule?.mode === 'markup') {
    return {
      price: unitPrice * (1 + channel.defaultPriceRule.value),
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
