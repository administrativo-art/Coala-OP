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
  assert.equal(result.get('ana')?.scheduledDays, 2);
  assert.equal(result.get('ana')?.scheduledTurnCount, 2);
  assert.equal(result.get('bia')?.scheduledDays, 1);
  assert.equal(result.get('bia')?.scheduledTurnCount, 1);
});

test('remove meta anterior quando a nova escala oficial não contém turnos elegíveis', () => {
  const result = calculateScheduledTargets({ targetValue: 100 }, [goal('ana', 'ana-id')], [], '2027-11-01', '2027-11-30');
  assert.deepEqual(result.get('ana'), { targetValue: 0, fraction: 0, scheduledDays: 0, scheduledTurnCount: 0 });
});

test('dias distintos e turnos cobertos seguem a escala publicada', () => {
  const period = { targetValue: 100, shifts: [{ id: 'period', fraction: 1, label: 'Mensal' }] };
  const goals = [goal('sara', 'sara-id', 'period')];
  const shifts = [shift('one', 'sara-id', '2027-11-01'),
    shift('two', 'sara-id', '2027-11-01'), shift('three', 'sara-id', '2027-11-02')];
  const result = calculateScheduledTargets(period, goals, shifts, '2027-11-01', '2027-11-30');
  assert.equal(result.get('sara')?.scheduledDays, 2);
  assert.equal(result.get('sara')?.scheduledTurnCount, 3);
});

test('grupos com horários diferentes contam apenas o turno correspondente', () => {
  const period = { targetValue: 100, shifts: [
    { id: 'morning', fraction: 0.5, label: 'Manhã (08:00–14:00)' },
    { id: 'evening', fraction: 0.5, label: 'Tarde (14:00–20:00)' },
  ] };
  const result = calculateScheduledTargets(period, [goal('sara', 'sara-id', 'morning')], [
    shift('morning', 'sara-id', '2027-11-01'),
    shift('evening', 'sara-id', '2027-11-02', { startTime: '14:00', endTime: '20:00' }),
  ], '2027-11-01', '2027-11-30');
  assert.equal(result.get('sara')?.scheduledDays, 1);
  assert.equal(result.get('sara')?.scheduledTurnCount, 1);
});
