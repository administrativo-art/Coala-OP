import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScheduleRestPreview } from '../../src/lib/dp-schedule-rest-preview';

test('mostra repousos lançados na competência sem depender de jornada configurada', () => {
  const preview = buildScheduleRestPreview({
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    shifts: [
      { userId: 'ana', date: '2026-11-01', type: 'work' },
      { userId: 'ana', date: '2026-11-02', type: 'day_off' },
      { userId: 'ana', date: '2026-11-02', type: 'day_off' },
      { userId: 'ana', date: '2026-11-03', type: 'day_off' },
      { userId: 'ana', date: '2026-11-03', type: 'work' },
      { userId: 'ana', date: '2026-11-04', type: 'day_off' },
      { userId: 'ana', date: '2026-10-31', type: 'day_off' },
      { userId: 'bia', date: '2026-11-05', type: 'work' },
    ],
    siblingWorkShifts: [{ userId: 'ana', date: '2026-11-04', type: 'work' }],
  });

  assert.deepEqual([...preview.userIds].sort(), ['ana', 'bia']);
  assert.deepEqual(preview.datesByUser.get('ana'), ['2026-11-02']);
  assert.equal(preview.datesByUser.has('bia'), false);
});

test('não inventa repousos numa escala vazia', () => {
  const preview = buildScheduleRestPreview({
    periodStart: '2026-11-01', periodEnd: '2026-11-30', shifts: [], siblingWorkShifts: [],
  });
  assert.equal(preview.userIds.size, 0);
  assert.equal(preview.datesByUser.size, 0);
});
