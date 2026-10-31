import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateScheduledTargets } from '../../functions/src/schedule-goals.ts';

const goal = (id, employeeId, shiftId = null) => ({ id, get: (key) => ({ employeeId, shiftId, fraction: 0 }[key]) });
const shift = (id, userId, date, extra = {}) => ({ id, scheduleId: 'schedule', userId, unitId: 'unit',
  date, type: 'work', startTime: '08:00', endTime: '14:00', ...extra });

test('recalcula metas a partir dos turnos oficiais, sem contar cobertura externa', () => {
  const period = { targetValue: 300, shifts: [{ id: 'morning', fraction: 1, label: 'Manhã (08:00–14:00)' }] };
  const goals = [goal('ana', 'ana-id', 'morning'), goal('bia', 'bia-id', 'morning')];
  const shifts = [shift('one', 'ana-id', '2027-11-01'), shift('two', 'bia-id', '2027-11-01'),
    shift('three', 'ana-id', '2027-11-02'), shift('external', 'bia-id', '2027-11-02', { countsTowardGoals: false })];
  const result = calculateScheduledTargets(period, goals, shifts, '2027-11-01', '2027-11-30');
  assert.equal(result.get('ana')?.targetValue, 225);
  assert.equal(result.get('bia')?.targetValue, 75);
  assert.equal(result.get('ana')?.fraction, 0.75);
  assert.equal(result.get('bia')?.fraction, 0.25);
});

test('remove meta anterior quando a nova escala oficial não contém turnos elegíveis', () => {
  const result = calculateScheduledTargets({ targetValue: 100 }, [goal('ana', 'ana-id')], [], '2027-11-01', '2027-11-30');
  assert.deepEqual(result.get('ana'), { targetValue: 0, fraction: 0 });
});
