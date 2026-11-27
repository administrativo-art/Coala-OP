import assert from 'node:assert/strict';
import test from 'node:test';

import { breakSummary, dayTimeline, queueTag } from '../../src/features/dp/time-adjustments/closure-day-view';
import type { DayView } from '../../src/features/dp/rep-p/day-model';

const marking = (time: string, index: number) => ({ receiptId: `r${index}`, markedAt: `2026-10-07T${time}:00-0300` });
const day = (times: string[], extra: Record<string, unknown> = {}) => ({ date: '2026-10-07', shift: { type: 'work', startTime: '10:00', endTime: '16:00' },
  markings: times.map(marking), allMarkings: [], absence: null, incidents: [], ...extra }) as unknown as DayView;

test('linha do dia: só pares fechados viram trecho; o eixo folga uma hora e cobre turno e batidas', () => {
  const full = dayTimeline(day(['10:00', '13:00', '13:15', '16:00']))!;
  assert.deepEqual(full.shift, { left: 12.5, width: 75 });
  assert.deepEqual(full.segments.map((item) => [item.left, item.width]), [[12.5, 37.5], [53.125, 34.375]]);
  assert.deepEqual([full.ticks[0], full.ticks.at(-1)], ['09h', '17h']);
  const odd = dayTimeline(day(['10:00', '13:00', '13:15']))!;
  assert.deepEqual([odd.segments.length, odd.marks.length], [1, 3]);
});

test('linha do dia não é desenhada em turno da noite nem sem batida e sem horário', () => {
  assert.equal(dayTimeline(day(['22:00'], { shift: { type: 'work', startTime: '22:00', endTime: '06:00', overnight: true } })), null);
  assert.equal(dayTimeline(day([], { shift: null })), null);
  assert.equal(dayTimeline(day([]))!.marks.length, 0);
});

test('rótulo da fila segue a situação do registro: o que o servidor não aponta é aviso, liberado não é alerta', () => {
  const absence = { absence: { id: 'a', status: 'in_review' } };
  const tag = (kind: string, released: boolean, extra = {}) => queueTag({ kind, released, day: day([], extra) } as never).label;
  assert.equal(tag('request', false), 'pedido');
  assert.equal(tag('request', false, absence), 'ausência');
  assert.equal(tag('alert', false), 'alerta');
  assert.equal(tag('alert', true), 'liberado');
  assert.equal(tag('warning', false, { incidents: ['short_break'] }), 'aviso');
  assert.equal(tag('overnight', false), 'noite');
});

test('quadro do intervalo só aparece quando o alerta vem da mesma conta', () => {
  const times = ['10:00', '13:00', '13:30', '16:00'];
  const base = { incidents: ['long_break'], breakMinutes: 30, expectedBreakMinutes: 15 };
  assert.deepEqual(breakSummary(day(times, base)), { expected: 15, done: 30, difference: 15 });
  for (const shift of [{ intrajornada: true }, { coverage: true }, { breakMinPauseMinutes: 15 }, { overnight: true }]) {
    assert.equal(breakSummary(day(times, { ...base, shift: { type: 'work', startTime: '10:00', endTime: '16:00', ...shift } })), null);
  }
  assert.equal(breakSummary(day(times, { ...base, manualSegments: [{}] })), null);
  assert.equal(breakSummary(day(times.slice(0, 3), base)), null);
  assert.equal(breakSummary(day(times, { ...base, incidents: ['late_exit'] })), null);
});

test('linha do dia distingue batida incluída por ajuste e não desenha jornada em trechos', () => {
  const included = day(['10:00', '16:00']);
  (included.markings[1] as { treatment?: string }).treatment = 'included';
  assert.deepEqual(dayTimeline(included)!.marks.map((mark) => mark.included), [false, true]);
  assert.equal(dayTimeline(day(['10:00'], { manualSegments: [{}] })), null);
});
