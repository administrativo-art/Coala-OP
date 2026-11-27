import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculateAutomaticChannelPrice, calculateSimulationMetrics, resolveEffectivePrice } from '../../src/lib/pricing-context';
import type { PriceOverride, SalesChannel } from '../../src/types';

const ifoodChannel: SalesChannel = {
  id: 'ifood',
  name: 'iFood',
  type: 'ifood',
  active: true,
  defaultPriceRule: { mode: 'markup', value: 0.3605 },
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
};

function override(
  id: string,
  unitId: string | null,
  channelId: string | null,
  finalPrice: number | null,
  available = true
): PriceOverride {
  return {
    id,
    simulationId: 'produto-1',
    unitId,
    channelId,
    finalPrice,
    available,
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    createdBy: { userId: 'teste', username: 'Teste' },
    updatedBy: { userId: 'teste', username: 'Teste' },
  };
}

test('regra do canal acompanha o preço vigente da unidade', () => {
  const simulation = { salePrice: 10, kioskIds: ['joao-paulo'] };
  const unitOverride = override('unit-price', 'joao-paulo', null, 12);

  const result = resolveEffectivePrice(
    simulation,
    'joao-paulo',
    'ifood',
    [ifoodChannel],
    [unitOverride]
  );

  assert.equal(result.price, 16);
  assert.equal(result.available, true);
  assert.equal(result.source, 'channel-default-rule');
});

test('regra do canal não congela o preço quando a unidade é reajustada', () => {
  const simulation = { salePrice: 10, kioskIds: ['joao-paulo'] };
  const previous = override('unit-price', 'joao-paulo', null, 12);
  const updated = override('unit-price', 'joao-paulo', null, 13);

  const previousResult = resolveEffectivePrice(
    simulation,
    'joao-paulo',
    'ifood',
    [ifoodChannel],
    [previous]
  );
  const updatedResult = resolveEffectivePrice(
    simulation,
    'joao-paulo',
    'ifood',
    [ifoodChannel],
    [updated]
  );

  assert.equal(previousResult.price, 16);
  assert.equal(updatedResult.price, 18);
});

test('preço específico da unidade no canal continua tendo prioridade', () => {
  const simulation = { salePrice: 10, kioskIds: ['joao-paulo'] };
  const unitOverride = override('unit-price', 'joao-paulo', null, 12);
  const contextOverride = override('ifood-price', 'joao-paulo', 'ifood', 18.9);

  const result = resolveEffectivePrice(
    simulation,
    'joao-paulo',
    'ifood',
    [ifoodChannel],
    [unitOverride, contextOverride]
  );

  assert.equal(result.price, 18.9);
  assert.equal(result.source, 'override:unit+channel');
});

test('preço automático usa o corte de quarenta centavos após normalizar a moeda', () => {
  for (const [calculated, expected] of [
    [30, 30], [30.01, 30], [30.39, 30], [30.40, 31], [30.99, 31],
    [30.394, 30], [30.395, 31], [30.399, 31], [0, 0], [1234.40, 1235],
  ]) {
    assert.equal(calculateAutomaticChannelPrice(calculated, 0), expected, `${calculated} deve resultar em ${expected}`);
  }
  assert.equal(calculateAutomaticChannelPrice(10, 2.04), 31);
  assert.equal(calculateAutomaticChannelPrice(20, 0.3605), 27);
});

test('regra global do iFood e métricas usam o preço arredondado efetivo', () => {
  const result = resolveEffectivePrice({ salePrice: 20 }, null, 'ifood', [ifoodChannel], []);
  assert.equal(result.price, 27);
  assert.equal(result.source, 'channel-default-rule');
  const metrics = calculateSimulationMetrics(result.price!, 5.61, 0, 0);
  assert.equal(Math.round(metrics.grossMargin * 100), 2139);
  assert.equal(metrics.grossMarginPct.toFixed(1), '79.2');
});

test('preço manual de canal, preço de balcão e preço de unidade sem regra mantêm centavos', () => {
  const simulation = { salePrice: 30.40 };
  const manualChannel = resolveEffectivePrice(simulation, null, 'ifood', [ifoodChannel], [override('manual', null, 'ifood', 29.90)]);
  assert.equal(manualChannel.price, 29.90);
  assert.equal(manualChannel.source, 'override:channel');
  const counter = resolveEffectivePrice(simulation, null, null, [ifoodChannel], []);
  assert.equal(counter.price, 30.40);
  assert.equal(counter.source, 'global');
  const noRule = resolveEffectivePrice(simulation, 'joao-paulo', 'ifood', [{ ...ifoodChannel, defaultPriceRule: null }], [override('unit', 'joao-paulo', null, 30.39)]);
  assert.equal(noRule.price, 30.39);
  assert.equal(noRule.source, 'override:unit');
});

test('arredondamento não reativa canal inativo ou unidade fora do escopo', () => {
  const unavailableChannel = resolveEffectivePrice({ salePrice: 20 }, null, 'ifood', [{ ...ifoodChannel, active: false }], []);
  assert.equal(unavailableChannel.price, null);
  assert.equal(unavailableChannel.available, false);
  assert.equal(unavailableChannel.source, 'channel-inactive');
  const unavailableUnit = resolveEffectivePrice({ salePrice: 20, kioskIds: ['tirirical'] }, 'joao-paulo', 'ifood', [ifoodChannel], []);
  assert.equal(unavailableUnit.price, null);
  assert.equal(unavailableUnit.available, false);
  assert.equal(unavailableUnit.source, 'unit-disabled');
});

test('indisponibilidade específica da unidade no canal não é anulada pela regra', () => {
  const simulation = { salePrice: 10, kioskIds: ['joao-paulo'] };
  const unitOverride = override('unit-price', 'joao-paulo', null, 12);
  const unavailable = override('ifood-disabled', 'joao-paulo', 'ifood', null, false);

  const result = resolveEffectivePrice(
    simulation,
    'joao-paulo',
    'ifood',
    [ifoodChannel],
    [unitOverride, unavailable]
  );

  assert.equal(result.available, false);
  assert.equal(result.source, 'override:unit+channel');
});

test('prévia da configuração do canal usa o preço final normalizado', () => {
  assert.equal(calculateAutomaticChannelPrice(12, 0.3605), 16);
  assert.equal(calculateAutomaticChannelPrice(12, 0.37), 17);
});
