import assert from 'node:assert/strict';
import test from 'node:test';

import { publishDayOffSchema } from '../../src/features/dp/day-offs/schemas';
import { isPredictedDayOffDate } from '../../src/lib/dp-shift-rules';
import { defaultAdminPermissions, defaultGuestPermissions } from '../../src/types/index';

test('segrega a publicação no Bizneo da edição comum da escala', () => {
  assert.equal(defaultGuestPermissions.dp.schedules.publishBizneo, false);
  assert.equal(defaultAdminPermissions.dp.schedules.publishBizneo, true);
});

test('aceita confirmação prevista e lançamento manual de folga', () => {
  for (const source of ['predicted', 'manual', 'retry'] as const) {
    const result = publishDayOffSchema.safeParse({
      userId: 'user-1',
      unitId: 'unit-1',
      date: '2026-09-06',
      source,
    });
    assert.equal(result.success, true);
  }
});

test('rejeita data inexistente e origem desconhecida', () => {
  assert.equal(publishDayOffSchema.safeParse({
    userId: 'user-1',
    unitId: 'unit-1',
    date: '2026-02-30',
    source: 'manual',
  }).success, false);
  assert.equal(publishDayOffSchema.safeParse({
    userId: 'user-1',
    unitId: 'unit-1',
    date: '2026-09-06',
    source: 'automatic',
  }).success, false);
});

test('prevê folga somente ao final de cada bloco completo de seis dias', () => {
  const sixDays = new Set([
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
  ]);
  assert.equal(isPredictedDayOffDate(sixDays, '2026-09-07'), true);

  const sevenDays = new Set([...sixDays, '2026-09-07']);
  assert.equal(isPredictedDayOffDate(sevenDays, '2026-09-08'), false);

  const twelveDays = new Set(Array.from({ length: 12 }, (_, index) => (
    `2026-09-${String(index + 1).padStart(2, '0')}`
  )));
  assert.equal(isPredictedDayOffDate(twelveDays, '2026-09-13'), true);
});
