import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveEffectivePrice } from '../../src/lib/pricing-context';
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

  assert.equal(result.price, 16.326);
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

  assert.ok(Math.abs((previousResult.price ?? 0) - 16.326) < 0.000001);
  assert.ok(Math.abs((updatedResult.price ?? 0) - 17.6865) < 0.000001);
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
