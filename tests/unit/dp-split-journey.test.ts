import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewSplitJourney, validSplitJourneyShiftIds } from '../../src/features/dp/schedules/split-journey';

const first = { id: '1', unitId: 'matriz', startTime: '08:00', endTime: '09:30' };
const second = { id: '2', unitId: 'tirirical', startTime: '10:00', endTime: '16:30', manualBreak: { start: '12:00', end: '13:00' } };
const third = { id: '3', unitId: 'shopping', startTime: '17:00', endTime: '18:00' };
const fourth = { id: '4', unitId: 'matriz', startTime: '18:20', endTime: '19:00' };

test('ordena três unidades e contabiliza o retorno à matriz, a pausa e os deslocamentos', () => {
  const review = reviewSplitJourney([fourth, second, first, third]);
  assert.deepEqual(review.issues, []);
  assert.deepEqual(review.segments.map(({ id }) => id), ['1', '2', '3', '4']);
  assert.equal(review.workMinutes, 520);
  assert.equal(review.breakMinutes, 60);
  assert.equal(review.changes.reduce((total, change) => total + (change.minutes ?? 0), 0), 80);
  assert.equal(review.journeyMinutes, 520);
});

test('detecta sobreposição mesmo quando um trecho intermediário acaba antes do primeiro', () => {
  const enclosing = { ...first, endTime: '18:00' };
  const { issues } = reviewSplitJourney([enclosing, second, third]);
  assert.deepEqual(issues.map((issue) => [issue.code, issue.previousSegmentId, issue.segmentId]),
    [['overlap', '1', '2'], ['overlap', '1', '3']]);
});

test('conta o tempo entre unidades e deixa fora a lacuna entre turnos na mesma unidade', () => {
  assert.equal(reviewSplitJourney([first, second]).changes[0]?.minutes, 30);
  assert.equal(reviewSplitJourney([first, { ...second, unitId: first.unitId }]).changes.length, 0);
});

test('sinaliza pausa fora do trecho e horário de fim no dia seguinte', () => {
  const review = reviewSplitJourney([
    { ...first, manualBreak: { start: '07:30', end: '08:15' } },
    { ...second, endTime: '06:00' },
  ]);
  assert.deepEqual(review.issues.map(({ code }) => code), ['invalid_break', 'invalid_time']);
});

test('mostra os 30 minutos de referência sem somar à carga', () => {
  const review = reviewSplitJourney([
    { ...first, startTime: '07:00' },
    { ...second, manualBreak: null },
  ]);
  assert.deepEqual(review.issues, []);
  assert.equal(review.workMinutes, 540);
  assert.equal(review.changes.reduce((total, change) => total + (change.minutes ?? 0), 0), 30);
  assert.equal(review.journeyMinutes, 540);
});

test('marca a jornada na grade somente quando todos os trechos estão vinculados e sem sobreposição', () => {
  const day = { userId: 'pessoa', date: '2026-12-04', manualDayId: 'dia',
    manualDay: { mode: 'fixed', expectedBreakMinutes: 60 } };
  const periods = [first, second, third, fourth].map((period) => ({ ...period, ...day }));
  assert.deepEqual([...validSplitJourneyShiftIds(periods)], ['1', '2', '3', '4']);
  assert.equal(validSplitJourneyShiftIds([...periods, { ...third, ...day, manualDayId: null }]).size, 0);
  assert.equal(validSplitJourneyShiftIds([{ ...first, ...day, endTime: '11:00' }, { ...second, ...day }]).size, 0);
});

test('soma a carga de um trecho flexível sem janela e preserva a ordem publicada', () => {
  const fixed = { ...second, manualOrder: 1, manualDay: { mode: 'fixed', expectedBreakMinutes: 60 } };
  const flexible = { ...first, startTime: '', endTime: '', manualOrder: 0,
    manualDay: { mode: 'flexible', expectedWorkMinutes: 240, expectedBreakMinutes: 0 } };
  const review = reviewSplitJourney([fixed, flexible]);
  assert.deepEqual(review.issues, []);
  assert.deepEqual(review.segments.map(({ id }) => id), ['1', '2']);
  assert.equal(review.journeyMinutes, 570);
  assert.deepEqual(review.changes, [{ fromId: '1', toId: '2', minutes: null }]);
});
