import assert from 'node:assert/strict';
import test from 'node:test';

import { canReadScheduleUnit } from '../../src/features/dp/schedules/read-service.server';
import type { ServerUserContext } from '../../src/lib/auth-server';

const context = (userDoc: Record<string, unknown>, isDefaultAdmin = false) =>
  ({ userDoc, isDefaultAdmin }) as unknown as ServerUserContext;

test('escala legada sem unitId só é legível por quem acessa todas as unidades', () => {
  assert.equal(canReadScheduleUnit(context({ unitAccessScope: 'all' }), undefined, ''), true);
  assert.equal(canReadScheduleUnit(context({}, true), undefined, ''), true);
  assert.equal(canReadScheduleUnit(context({ unitAccessScope: 'selected', unitAccessUnitIds: ['u1'] }), undefined, ''), false);
});

test('escala por unidade continua exigindo acesso à unidade', () => {
  const selected = context({ unitAccessScope: 'selected', unitAccessUnitIds: ['u1'] });
  assert.equal(canReadScheduleUnit(selected, 'u1', ''), true);
  assert.equal(canReadScheduleUnit(selected, 'u2', ''), false);
  assert.equal(canReadScheduleUnit(selected, 'u2', 'u1'), true);
});
