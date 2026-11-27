import assert from 'node:assert/strict';
import test from 'node:test';

import { attributeMarkings, attributeWorkDate, civilDateForWorkDate, markingReadRange, shiftReadRange, type WorkDateShift } from '../../src/features/dp/time-bank/work-date';

const work = (date: string, startTime: string, endTime: string, extra: Partial<WorkDateShift> = {}): WorkDateShift =>
  ({ date, type: 'work', startTime, endTime, ...extra });
const at = (date: string, clock: string) => `${date}T${clock}:00-0300`;
const attribute = (date: string, clock: string, shifts: WorkDateShift[]) => attributeWorkDate(date, at(date, clock), shifts);

test('turno das 18h à meia-noite: a saída à 01h é do dia em que o turno começou', () => {
  const shifts = [work('2026-11-10', '18:00', '00:00')];
  assert.equal(attribute('2026-11-11', '01:00', shifts), '2026-11-10');
});

test('22h às 6h: atraso na saída continua na véspera até 4h depois do fim, e não depois disso', () => {
  const shifts = [work('2026-11-10', '22:00', '06:00', { overnight: true })];
  assert.equal(attribute('2026-11-11', '02:00', shifts), '2026-11-10');
  assert.equal(attribute('2026-11-11', '06:10', shifts), '2026-11-10');
  assert.equal(attribute('2026-11-11', '10:00', shifts), '2026-11-10');
  assert.equal(attribute('2026-11-11', '10:01', shifts), '2026-11-11');
});

test('a partir do início do turno do próprio dia, a batida é desse dia', () => {
  const shifts = [work('2026-11-10', '22:00', '06:00'), work('2026-11-11', '08:00', '14:00')];
  assert.equal(attribute('2026-11-11', '07:59', shifts), '2026-11-10');
  assert.equal(attribute('2026-11-11', '08:00', shifts), '2026-11-11');
  assert.equal(attribute('2026-11-11', '09:30', shifts), '2026-11-11');
});

test('turno da véspera que termina 23h30 recebe a saída à 00h20; turno da tarde não puxa o dia seguinte', () => {
  assert.equal(attribute('2026-11-11', '00:20', [work('2026-11-10', '18:00', '23:30')]), '2026-11-10');
  assert.equal(attribute('2026-11-11', '00:00', [work('2026-11-10', '10:00', '16:15')]), '2026-11-11');
});

test('folga ou ausência de turno na véspera não puxa a batida', () => {
  assert.equal(attribute('2026-11-11', '01:00', []), '2026-11-11');
  assert.equal(attribute('2026-11-11', '01:00', [{ date: '2026-11-10', type: 'day_off', startTime: null, endTime: null }]), '2026-11-11');
});

test('virada do mês: o turno fica no mês em que começou', () => {
  const shifts = [work('2026-10-31', '22:00', '06:00')];
  const markings = [{ workDate: '2026-10-31', markedAt: at('2026-10-31', '22:00') }, { workDate: '2026-11-01', markedAt: at('2026-11-01', '06:02') }];
  assert.deepEqual(attributeMarkings(markings, shifts, '2026-10-01', '2026-10-31').map((item) => [item.workDate, item.markedAt.slice(0, 10)]),
    [['2026-10-31', '2026-10-31'], ['2026-10-31', '2026-11-01']]);
  assert.deepEqual(attributeMarkings(markings, shifts, '2026-11-01', '2026-11-30'), []);
  assert.deepEqual(markingReadRange('2026-10-01', '2026-10-31'), { start: '2026-10-01', end: '2026-11-01' });
  assert.deepEqual(shiftReadRange('2026-11-01', '2026-11-30'), { start: '2026-10-31', end: '2026-12-01' });
});

test('inclusão: o horário informado no turno vira a data civil certa', () => {
  const evening = [work('2026-11-10', '18:00', '00:00')];
  assert.equal(civilDateForWorkDate('2026-11-10', '18:00', evening), '2026-11-10');
  assert.equal(civilDateForWorkDate('2026-11-10', '01:00', evening), '2026-11-11');
  const night = [work('2026-11-30', '22:00', '06:00', { overnight: true })];
  assert.equal(civilDateForWorkDate('2026-11-30', '22:00', night), '2026-11-30');
  assert.equal(civilDateForWorkDate('2026-11-30', '10:00', night), '2026-12-01', 'limite exato, virando o mês');
  assert.equal(civilDateForWorkDate('2026-11-30', '10:01', night), '2026-11-30');
});

test('inclusão: turno do dia seguinte limita a saída e horário da véspera é recusado', () => {
  const shifts = [work('2026-11-10', '22:00', '06:00'), work('2026-11-11', '08:00', '14:00')];
  assert.equal(civilDateForWorkDate('2026-11-10', '07:59', shifts), '2026-11-11');
  assert.equal(civilDateForWorkDate('2026-11-10', '08:00', shifts), '2026-11-10');
  assert.equal(civilDateForWorkDate('2026-11-11', '07:00', shifts), null, 'antes do início do dia 11 é saída do dia 10');
  const dayOff: WorkDateShift[] = [work('2026-11-10', '22:00', '06:00'), { date: '2026-11-11', type: 'day_off', startTime: null, endTime: null }];
  assert.equal(civilDateForWorkDate('2026-11-11', '01:00', dayOff), null);
  assert.equal(civilDateForWorkDate('2026-11-11', '11:00', dayOff), '2026-11-11');
});

test('ida e volta: todo horário aceito na inclusão volta para o mesmo dia de trabalho', () => {
  const shifts = [work('2026-11-09', '14:00', '22:00'), work('2026-11-10', '22:00', '06:00'), work('2026-11-11', '08:00', '14:00')];
  for (const workDate of ['2026-11-10', '2026-11-11']) {
    for (let minute = 0; minute < 1440; minute += 1) {
      const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const civil = civilDateForWorkDate(workDate, clock, shifts);
      if (civil) assert.equal(attribute(civil, clock, shifts), workDate, `${workDate} ${clock}`);
    }
  }
});
