import assert from 'node:assert/strict';
import test from 'node:test';

import { saveWorkShiftSchema, workShiftRouteSchema } from '../../src/features/dp/shifts/schemas';

const validShift = {
  userId: 'user-1',
  userName: 'Maria Edna',
  unitId: 'shopping',
  date: '2026-09-03',
  shiftDefinitionId: 'morning',
  startTime: '09:00',
  endTime: '15:15',
  type: 'work' as const,
};

test('aceita somente o contrato completo de turno de trabalho', () => {
  assert.equal(saveWorkShiftSchema.safeParse(validShift).success, true);
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, type: 'day_off' }).success, false);
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, hasConflict: true }).success, false);
});

test('rejeita horário inválido ou invertido', () => {
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, startTime: '9:00' }).success, false);
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, startTime: '16:00', endTime: '15:00' }).success, false);
});

test('valida os identificadores da rota', () => {
  assert.equal(workShiftRouteSchema.safeParse({ scheduleId: 'schedule-1', shiftId: 'shift-1' }).success, true);
  assert.equal(workShiftRouteSchema.safeParse({ scheduleId: '', shiftId: 'shift-1' }).success, false);
});
