import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthenticatedApiError } from '../../src/lib/authenticated-api-client';
import { isAmbiguousMarkingFailure, markingFailureOutcome, parsePendingAttempt, PENDING_ATTEMPT_TTL_MS } from '../../src/features/dp/rep-p/use-rep-p-marking';
import { buildDayView, type DayMarking, type DayShift } from '../../src/features/dp/rep-p/day-model';
import { journeyState, nextMarkingOf } from '../../src/features/dp/rep-p/record-strip';

test('só uma recusa explícita do servidor encerra a tentativa; falha de rede, 408, 429 e 5xx guardam a mesma tentativa', () => {
  assert.equal(isAmbiguousMarkingFailure(new TypeError('Failed to fetch')), true);
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isAmbiguousMarkingFailure(new AuthenticatedApiError('x', status, null)), true, String(status));
  for (const status of [400, 401, 403, 409, 422]) assert.equal(isAmbiguousMarkingFailure(new AuthenticatedApiError('x', status, null)), false, String(status));
});

const shift: DayShift = { type: 'work', startTime: '08:00', endTime: '17:00', shiftName: 'Manhã', unitName: 'Doca', breakType: 'flexible',
  breakStart: null, breakEnd: null, breakDurationMinutes: 60, breakWindowStart: null, breakWindowEnd: null, expectedPunches: 4 };
const mark = (time: string, purpose: NonNullable<DayMarking['classification']>['purpose'] | null, nsr: number): DayMarking => ({
  receiptId: `r${nsr}`, markedAt: `2026-10-27T${time}:00-0300`, nsr, executionUnitId: 'u1', receiptStatus: 'available',
  classification: purpose ? { purpose, source: 'declared', status: 'applied' } : null });

const apiError = (status: number, code?: string) => new AuthenticatedApiError('x', status, code ? { error: { code, message: 'x' } } : null);

test('reenvio só termina em 409 ou num código que prova que nada foi gravado; 401/403 mantêm a mesma tentativa (como no Coala Go)', () => {
  // Primeira tentativa: resposta explícita do servidor prova que nada foi gravado com o identificador novo.
  assert.equal(markingFailureOutcome(apiError(403, 'REP_P_MARKING_DISABLED'), false), 'not_recorded');
  assert.equal(markingFailureOutcome(new TypeError('Failed to fetch'), false), 'keep');
  assert.equal(markingFailureOutcome(apiError(503), false), 'keep');
  // Reenvio: verificações anteriores à leitura da tentativa não provam que ela não foi gravada.
  for (const [status, code] of [[401, undefined], [403, 'REP_P_MARKING_PROFILE_DISABLED'], [400, 'REP_P_INPUT_INVALID'], [422, undefined]] as const) {
    assert.equal(markingFailureOutcome(apiError(status, code), true), 'keep', `${status} ${code}`);
  }
  assert.equal(markingFailureOutcome(apiError(409, 'REP_P_ATTEMPT_CONFLICT'), true), 'conflict');
  assert.equal(markingFailureOutcome(apiError(400, 'REP_P_WORK_DATE_MISMATCH'), true), 'not_recorded');
  assert.equal(markingFailureOutcome(apiError(503, 'REP_P_TIME_UNAVAILABLE'), true), 'keep');
  assert.equal(markingFailureOutcome(apiError(500), true), 'keep');
});

test('a tentativa guardada expira e ignora conteúdo corrompido', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const stored = { attemptId: 'a1', workDate: '2026-10-27', unitId: 'u1', purpose: 'break_start', firstTriedAt: null, location: null, savedAt: now - 1000 };
  assert.deepEqual(parsePendingAttempt(JSON.stringify(stored), now), stored);
  assert.equal(parsePendingAttempt(JSON.stringify({ ...stored, savedAt: now - PENDING_ATTEMPT_TTL_MS - 1 }), now), null);
  assert.equal(parsePendingAttempt('{quebrado', now), null);
  assert.equal(parsePendingAttempt(JSON.stringify({ attemptId: 'a1' }), now), null);
  assert.equal(parsePendingAttempt(null, now), null);
});

test('a faixa mostra o estado da jornada e a próxima batida pela última finalidade', () => {
  const empty = buildDayView({ date: '2026-10-27', today: '2026-10-27', shift, markings: [], absences: [] });
  assert.equal(journeyState(empty), 'Jornada não iniciada');
  assert.deepEqual({ ...nextMarkingOf(empty) }, { expected: 4, index: 0, purpose: 'journey_start', reliable: true, position: '1ª de 4', extra: false });

  const started = buildDayView({ date: '2026-10-27', today: '2026-10-27', shift, markings: [mark('07:58', 'journey_start', 1)], absences: [] });
  assert.equal(journeyState(started), 'Em jornada desde 07:58');
  assert.equal(nextMarkingOf(started).position, '2ª de 4');
  assert.equal(nextMarkingOf(started).purpose, 'break_start');

  const onBreak = buildDayView({ date: '2026-10-27', today: '2026-10-27', shift,
    markings: [mark('07:58', 'journey_start', 1), mark('12:01', 'break_start', 2)], absences: [] });
  assert.equal(journeyState(onBreak), 'Em intervalo desde 12:01');

  // Batida sem classificação: a sugestão não é confiável e a pessoa escolhe a finalidade.
  const unclassified = buildDayView({ date: '2026-10-27', today: '2026-10-27', shift, markings: [mark('07:58', null, 1)], absences: [] });
  assert.equal(nextMarkingOf(unclassified).reliable, false);

  const full = buildDayView({ date: '2026-10-27', today: '2026-10-27', shift, markings: [mark('07:58', 'journey_start', 1),
    mark('12:00', 'break_start', 2), mark('13:00', 'break_end', 3), mark('17:02', 'journey_end', 4)], absences: [] });
  assert.equal(journeyState(full), 'Jornada encerrada às 17:02');
  assert.equal(nextMarkingOf(full).extra, true);
});
