import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDPShiftReference } from '../../src/lib/dp-shift-reference';
import type { DPJourney, DPShiftDefinition } from '../../src/types';

const journey = {
  id: 'j1', lineageId: 'jl1', version: 3, name: 'Escala 6x1', validFrom: '2026-01-01',
  weeklyMinutes: 2640, cycleLengthDays: 7,
  days: [{ dayIndex: 0, plannedMinutes: 440, isRestDay: false }],
  weeklyRest: { placement: 'fixed_cycle', maxConsecutiveWorkDays: 6 },
  expectedBreakMinutes: 60,
  allowedShiftDefinitionIds: ['t1'],
} as DPJourney;
const definition = {
  id: 't1', name: 'Manhã', code: 'MANHA', startTime: '08:00', endTime: '16:20',
  breakType: 'fixed', breakStart: '12:00', breakEnd: '13:00',
  daysOfWeek: [1, 2, 3, 4, 5],
} as DPShiftDefinition;

test('captura plano independente das mutações posteriores dos cadastros', () => {
  const localJourney = structuredClone(journey);
  const localDefinition = structuredClone(definition);
  const user = {
    unitId: 'lotacao', unitIds: ['lotacao', 'cobertura'],
    employerUnitId: 'empregador', employerCnpj: '12345678000199',
    jobRoleId: 'cargo', jobFunctionIds: ['funcao'], employmentCycleVersion: 4,
  };
  const reference = buildDPShiftReference({
    collaboratorId: 'u1', user, journey: localJourney, resolvedBy: 'job_role', definition: localDefinition,
    executionUnitId: 'cobertura', date: '2026-10-20',
    startTime: '08:00', endTime: '16:20', capturedAt: '2026-10-17T00:00:00.000Z',
  });
  user.unitId = 'outra-lotacao';
  user.employerUnitId = 'outro-empregador';
  user.jobFunctionIds.push('nova-funcao');
  localJourney.days[0].plannedMinutes = 100;
  localDefinition.breakStart = '11:00';
  assert.equal(reference.collaborator.unitId, 'lotacao');
  assert.equal(reference.collaboratorId, 'u1');
  assert.equal(reference.collaborator.employerUnitId, 'empregador');
  assert.equal(reference.collaborator.employerCnpj, '12345678000199');
  assert.equal(reference.collaborator.employmentCycleStatus, 'captured');
  assert.equal(reference.executionUnitId, 'cobertura');
  assert.deepEqual(reference.collaborator.jobFunctionIds, ['funcao']);
  assert.equal(reference.journey.days[0].plannedMinutes, 440);
  assert.equal(reference.shiftDefinition?.breakStart, '12:00');
});

test('cadastro fiscal pendente não usa unidade de lotação ou execução como empregador', () => {
  const reference = buildDPShiftReference({
    collaboratorId: 'u2', user: { unitId: 'lotacao', unitIds: ['execucao'] }, journey,
    resolvedBy: 'company', definition: null, executionUnitId: 'execucao',
    date: '2026-10-20', startTime: '08:00', endTime: '16:20', capturedAt: '2026-10-17T00:00:00.000Z',
  });
  assert.equal(reference.collaborator.employerUnitId, null);
  assert.equal(reference.collaborator.employerCnpj, null);
  assert.equal(reference.collaborator.fiscalStatus, 'pending');
  assert.equal(reference.collaborator.employmentCycleVersion, null);
  assert.equal(reference.collaborator.employmentCycleStatus, 'pending');
  assert.equal(reference.journey.useDefinedShiftWhenShorter, null);
  assert.equal(reference.collaborator.employmentCycleVersion, null);
  assert.equal(reference.collaborator.employmentCycleStatus, 'pending');
});
