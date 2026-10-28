import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coverageJourneyIssues,
  evaluateCoverageAgenda,
  summarizeCoverageEligibility,
} from '../../src/features/dp/absences/coverage/core';

const target = { date: '2026-11-05', startTime: '14:00', endTime: '22:00' };

test('pessoa sem turno no dia é elegível', () => {
  const issues = evaluateCoverageAgenda(target, []);
  assert.deepEqual(issues, []);
  assert.deepEqual(summarizeCoverageEligibility(issues, [], target), { eligible: true, summary: 'Sem turno nesse dia', issues: [] });
});

test('folga confirmada no dia bloqueia', () => {
  const agenda = [{ date: '2026-11-05', startTime: '00:00', endTime: '23:59', type: 'day_off' as const }];
  const result = summarizeCoverageEligibility(evaluateCoverageAgenda(target, agenda), agenda, target);
  assert.equal(result.eligible, false);
  assert.equal(result.summary, 'Folga confirmada nesse dia');
});

test('choque de horário bloqueia e mostra o turno existente', () => {
  const agenda = [{ date: '2026-11-05', startTime: '10:00', endTime: '18:00', type: 'work' as const }];
  const issues = evaluateCoverageAgenda(target, agenda);
  assert.equal(issues[0].code, 'OVERLAP');
  assert.equal(issues[0].message, 'Já trabalha das 10:00 às 18:00 nesse dia');
  assert.equal(issues.some((issue) => issue.code === 'REST_UNDER_11_HOURS'), false);
});

test('turno noturno do dia anterior que invade a cobertura conta como choque', () => {
  const issues = evaluateCoverageAgenda({ date: '2026-11-05', startTime: '06:00', endTime: '14:00' },
    [{ date: '2026-11-04', startTime: '22:00', endTime: '07:00', type: 'work' }]);
  assert.equal(issues[0].message, 'Já trabalha das 22:00 às 07:00 em 04/11');
});

test('descanso menor que 11h entre turnos bloqueia', () => {
  const issues = evaluateCoverageAgenda(target, [{ date: '2026-11-06', startTime: '06:00', endTime: '14:00', type: 'work' }]);
  assert.deepEqual(issues, [{ code: 'REST_UNDER_11_HOURS', blocking: true, message: 'Descanso de 8h entre turnos; o mínimo é 11h' }]);
});

test('descanso de exatamente 11h é permitido', () => {
  const issues = evaluateCoverageAgenda(target, [{ date: '2026-11-06', startTime: '09:00', endTime: '15:00', type: 'work' }]);
  assert.deepEqual(issues, []);
});

test('só culpa a cobertura pelas violações de jornada que ela cria', () => {
  const before = [{ code: 'MAX_CONSECUTIVE_DAYS_EXCEEDED' as const, userId: 'u', date: '2026-11-01', blocking: true,
    message: '7 dias consecutivos; a jornada permite no máximo 6.' }];
  const after = [...before, { code: 'MAX_CONSECUTIVE_DAYS_EXCEEDED' as const, userId: 'u', date: '2026-11-05', blocking: true,
    message: '7 dias consecutivos; a jornada permite no máximo 6.' }];
  assert.deepEqual(coverageJourneyIssues(before, after), [
    { code: 'MAX_CONSECUTIVE_DAYS_EXCEEDED', blocking: true, message: 'Seria o 7º dia seguido; a jornada permite 6' },
  ]);
});

test('revisão manual da jornada avisa sem bloquear', () => {
  const issues = coverageJourneyIssues([], [{ code: 'JOURNEY_MANUAL_REVIEW', userId: 'u', date: '2026-11-05', blocking: false, message: 'x' }]);
  const result = summarizeCoverageEligibility(issues, [], target);
  assert.equal(result.eligible, true);
  assert.equal(result.summary, 'Jornada em revisão manual: confira a escala antes');
});
