import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewSplitJourney } from '../../src/features/dp/schedules/split-journey';

const first = { id: '1', unitId: 'matriz', startTime: '08:00', endTime: '09:30' };
const second = { id: '2', unitId: 'tirirical', startTime: '10:00', endTime: '16:30',
  travelFromPreviousMinutes: 25, manualBreak: { start: '12:00', end: '13:00' } };
const third = { id: '3', unitId: 'shopping', startTime: '17:00', endTime: '18:00', travelFromPreviousMinutes: 30 };
const fourth = { id: '4', unitId: 'matriz', startTime: '18:20', endTime: '19:00', travelFromPreviousMinutes: 20 };

test('ordena três unidades e contabiliza o retorno à matriz, a pausa e os deslocamentos', () => {
  const review = reviewSplitJourney([fourth, second, first, third]);
  assert.deepEqual(review.issues, []);
  assert.deepEqual(review.segments.map(({ id }) => id), ['1', '2', '3', '4']);
  assert.equal(review.workMinutes, 520);
  assert.equal(review.breakMinutes, 60);
  assert.equal(review.travelMinutes, 75);
  assert.equal(review.journeyMinutes, 595);
});

test('identifica a transição quando o deslocamento excede o tempo disponível', () => {
  const [issue] = reviewSplitJourney([first, { ...second, travelFromPreviousMinutes: 35 }]).issues;
  assert.equal(issue?.code, 'insufficient_travel');
  assert.equal(issue?.previousSegmentId, first.id);
  assert.equal(issue?.segmentId, second.id);
});

test('detecta sobreposição mesmo quando um trecho intermediário acaba antes do primeiro', () => {
  const enclosing = { ...first, endTime: '18:00' };
  const { issues } = reviewSplitJourney([enclosing, second, third]);
  assert.deepEqual(issues.map((issue) => [issue.code, issue.previousSegmentId, issue.segmentId]),
    [['overlap', '1', '2'], ['overlap', '1', '3']]);
});

test('distingue deslocamento ausente de zero minutos e rejeita deslocamento na mesma unidade', () => {
  const { travelFromPreviousMinutes: _, ...withoutTravel } = second;
  assert.equal(reviewSplitJourney([first, withoutTravel]).issues[0]?.code, 'invalid_travel');
  assert.deepEqual(reviewSplitJourney([first, { ...second, travelFromPreviousMinutes: 0 }]).issues, []);
  assert.equal(reviewSplitJourney([first, { ...second, unitId: first.unitId }]).issues[0]?.code, 'invalid_travel');
});

test('sinaliza pausa fora do trecho e horário de fim no dia seguinte', () => {
  const review = reviewSplitJourney([
    { ...first, manualBreak: { start: '07:30', end: '08:15' } },
    { ...second, endTime: '06:00' },
  ]);
  assert.deepEqual(review.issues.map(({ code }) => code), ['invalid_break', 'invalid_time']);
});

test('inclui os 30 minutos de deslocamento da matriz ao Tirirical na jornada', () => {
  const review = reviewSplitJourney([
    { ...first, startTime: '07:00' },
    { ...second, travelFromPreviousMinutes: 30, manualBreak: null },
  ]);
  assert.deepEqual(review.issues, []);
  assert.equal(review.workMinutes, 540);
  assert.equal(review.travelMinutes, 30);
  assert.equal(review.journeyMinutes, 570);
});
