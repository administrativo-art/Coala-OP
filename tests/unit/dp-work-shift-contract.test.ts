import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  bulkWorkShiftRouteSchema,
  bulkWorkShiftSchema,
  manualJourneyDraftSchema,
  saveWorkShiftSchema,
  workShiftRouteSchema,
} from '../../src/features/dp/shifts/schemas';

const workShiftServiceSource = readFileSync('src/features/dp/shifts/service.server.ts', 'utf8');
const bulkShiftServiceSource = readFileSync('src/features/dp/shifts/bulk-service.server.ts', 'utf8');

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
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, exceptionReason: 'Cobertura por ausência pontual.' }).success, true);
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, countsTowardGoals: false }).success, false);
});

test('rejeita horário inválido ou sem duração e encaminha noturno para validação do servidor', () => {
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, startTime: '9:00' }).success, false);
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, startTime: '16:00', endTime: '16:00' }).success, false);
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, startTime: '22:00', endTime: '06:00', shiftDefinitionId: 'night' }).success, true);
});

test('aceita intervalo local dentro do período de uma jornada manual', () => {
  const manual = { ...validShift, shiftDefinitionId: undefined,
    manualDay: { mode: 'flexible', expectedWorkMinutes: 480, expectedBreakMinutes: 60 } };
  assert.equal(saveWorkShiftSchema.safeParse({ ...manual, manualBreak: { start: '12:00', end: '13:00' } }).success, true);
  assert.equal(saveWorkShiftSchema.safeParse({ ...manual, travelFromPreviousMinutes: 25 }).success, true);
  assert.equal(saveWorkShiftSchema.safeParse({ ...manual, travelFromPreviousMinutes: -1 }).success, false);
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, travelFromPreviousMinutes: 25 }).success, false);
  assert.equal(saveWorkShiftSchema.safeParse({ ...manual, manualBreak: { start: '08:00', end: '09:00' } }).success, false);
  assert.equal(saveWorkShiftSchema.safeParse({ ...validShift, manualBreak: { start: '12:00', end: '13:00' } }).success, false);
  assert.equal(saveWorkShiftSchema.safeParse(manual).success, true);
});

test('valida os identificadores da rota', () => {
  assert.equal(workShiftRouteSchema.safeParse({ scheduleId: 'schedule-1', shiftId: 'shift-1' }).success, true);
  assert.equal(workShiftRouteSchema.safeParse({ scheduleId: '', shiftId: 'shift-1' }).success, false);
});

test('aceita troca e remoção atômica de turnos em lote', () => {
  assert.equal(bulkWorkShiftSchema.safeParse({
    action: 'replace',
    shiftIds: ['shift-1', 'shift-2'],
    patch: { userId: 'user-2' },
  }).success, true);
  assert.equal(bulkWorkShiftSchema.safeParse({
    action: 'replace',
    shiftIds: ['shift-1'],
    patch: { shiftDefinitionId: null, startTime: '10:00', endTime: '18:00' },
  }).success, true);
  assert.equal(bulkWorkShiftSchema.safeParse({
    action: 'delete',
    shiftIds: ['shift-1'],
  }).success, true);
  assert.equal(bulkWorkShiftRouteSchema.safeParse({ scheduleId: 'schedule-1' }).success, true);
});

test('rejeita edição em lote ambígua, duplicada ou fora do limite', () => {
  assert.equal(bulkWorkShiftSchema.safeParse({
    action: 'replace',
    shiftIds: ['shift-1'],
    patch: {},
  }).success, false);
  assert.equal(bulkWorkShiftSchema.safeParse({
    action: 'replace',
    shiftIds: ['shift-1'],
    patch: { startTime: '10:00' },
  }).success, false);
  assert.equal(bulkWorkShiftSchema.safeParse({
    action: 'replace',
    shiftIds: ['shift-1'],
    patch: { startTime: '18:00', endTime: '18:00' },
  }).success, false);
  assert.equal(bulkWorkShiftSchema.safeParse({
    action: 'delete',
    shiftIds: ['shift-1', 'shift-1'],
  }).success, false);
  assert.equal(bulkWorkShiftSchema.safeParse({
    action: 'delete',
    shiftIds: Array.from({ length: 201 }, (_, index) => `shift-${index}`),
  }).success, false);
});

test('submete atribuição individual e troca em lote à jornada resolvida', () => {
  for (const source of [workShiftServiceSource, bulkShiftServiceSource]) {
    assert.match(source, /resolveDPJourney/);
    assert.match(source, /DP_SHIFT_JOURNEY_NOT_FOUND/);
    assert.match(source, /DP_SHIFT_JOURNEY_AMBIGUOUS/);
    assert.match(source, /journeyResolution/);
    assert.match(source, /journeyValidationVersion/);
  }
});

test('aceita trechos da jornada em mais de uma escala e rejeita alvos repetidos', () => {
  const segment = { scheduleId: 'matriz-dezembro', shiftId: 'manha', expectedDraftVersion: 3,
    expectedDraftGenerationId: 'initial', expectedOperationalVersion: 0, existing: true, unitId: 'matriz', startTime: '07:00', endTime: '09:30' };
  const day = { userId: 'user-1', date: '2026-12-04', manualDay: { mode: 'fixed', expectedBreakMinutes: 60 } };
  const destination = { ...segment, scheduleId: 'tirirical-dezembro', unitId: 'tirirical',
    shiftId: 'tarde', existing: false, startTime: '10:00', endTime: '16:30',
    manualBreak: { start: '12:00', end: '13:00' } };
  assert.equal(manualJourneyDraftSchema.safeParse({ ...day, segments: [segment, destination] }).success, true);
  assert.equal(manualJourneyDraftSchema.safeParse({ ...day, segments: [segment, segment] }).success, false);
  assert.equal(manualJourneyDraftSchema.safeParse({
    ...day, segments: [{ ...segment, expectedDraftVersion: -1 }],
  }).success, false);
});

test('aceita fixo e flexível sem janela no mesmo rascunho e valida retiradas', () => {
  const version = { expectedDraftVersion: 3, expectedDraftGenerationId: 'initial', expectedOperationalVersion: 0 };
  const first = { ...version, scheduleId: 'x', shiftId: 'first', unitId: 'x', existing: true,
    startTime: '', endTime: '', manualDay: { mode: 'flexible', expectedWorkMinutes: 240, expectedBreakMinutes: 0 } };
  const second = { ...version, scheduleId: 'y', shiftId: 'second', unitId: 'y', existing: false,
    startTime: '13:00', endTime: '17:00', manualDay: { mode: 'fixed', expectedBreakMinutes: 0 } };
  const day = { userId: 'user-1', date: '2026-12-04', segments: [first, second] };
  assert.equal(manualJourneyDraftSchema.safeParse({ ...day, removals: [{ ...version, scheduleId: 'x', shiftId: 'old' }] }).success, true);
  assert.equal(manualJourneyDraftSchema.safeParse({ ...day, removals: [{ ...version, scheduleId: 'x', shiftId: 'first' }] }).success, false);
  assert.equal(manualJourneyDraftSchema.safeParse({ ...day, segments: [{ ...first, startTime: '08:00' }, second] }).success, false);
});
