import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCrossUnitConflictShiftIds,
  buildWorkDayOffConflictKeys,
  buildWorkDayOffConflictShiftIds,
  compareWorkShiftsByTime,
} from '../../src/lib/dp-shift-rules';
import type { DPShift } from '../../src/types';

function shift(id: string, startTime: string, endTime: string, userName: string): DPShift {
  return {
    id,
    scheduleId: 'schedule-1',
    unitId: 'unit-1',
    userId: `user-${id}`,
    userName,
    date: '2026-09-01',
    startTime,
    endTime,
    type: 'work',
    createdAt: {} as DPShift['createdAt'],
  };
}

test('ordena turnos do mais cedo para o mais tarde', () => {
  const shifts = [
    shift('aliny', '14:45', '21:00', 'Aliny'),
    shift('maria', '09:00', '15:15', 'Maria Edna'),
    shift('sara', '09:00', '15:15', 'Sara'),
  ];

  assert.deepEqual(
    shifts.sort(compareWorkShiftsByTime).map(item => item.userName),
    ['Maria Edna', 'Sara', 'Aliny'],
  );
});

test('deriva conflito entre unidades pela ocupação atual do colaborador na data', () => {
  const current = shift('heucilene-tirirical', '10:00', '16:15', 'Heucilene');
  current.userId = 'heucilene';
  current.unitId = 'tirirical';

  const sibling = shift('heucilene-shopping', '14:45', '21:00', 'Heucilene');
  sibling.userId = 'heucilene';
  sibling.unitId = 'shopping';

  assert.deepEqual(
    [...buildCrossUnitConflictShiftIds([current], [sibling])],
    ['heucilene-tirirical'],
  );
});

test('remove conflito derivado quando a alocação da outra unidade deixa de existir', () => {
  const current = shift('heucilene-tirirical', '10:00', '16:15', 'Heucilene');
  current.userId = 'heucilene';
  current.hasConflict = true;

  assert.deepEqual(
    [...buildCrossUnitConflictShiftIds([current], [])],
    [],
    'o valor persistido antigo não pode manter um alerta residual',
  );
});

test('não considera folga como ocupação conflitante em outra unidade', () => {
  const current = shift('heucilene-tirirical', '10:00', '16:15', 'Heucilene');
  current.userId = 'heucilene';

  const dayOff = shift('folga-shopping', '', '', 'Heucilene');
  dayOff.userId = 'heucilene';
  dayOff.type = 'day_off';

  assert.deepEqual(
    [...buildCrossUnitConflictShiftIds([current], [dayOff])],
    [],
  );
});

test('identifica turno e folga como estados incompatíveis para a mesma pessoa e data', () => {
  const work = shift('carliane-work', '08:45', '15:00', 'Carliane');
  work.userId = 'carliane';

  const dayOff = shift('carliane-day-off', '', '', 'Carliane');
  dayOff.userId = 'carliane';
  dayOff.type = 'day_off';

  assert.deepEqual(
    [...buildWorkDayOffConflictShiftIds([work, dayOff])],
    ['carliane-work'],
  );
  assert.deepEqual(
    [...buildWorkDayOffConflictKeys([work, dayOff])],
    ['carliane::2026-09-01'],
  );
});

test('remove o conflito de folga assim que um dos estados é reconciliado', () => {
  const work = shift('carliane-work', '08:45', '15:00', 'Carliane');
  work.userId = 'carliane';

  assert.deepEqual([...buildWorkDayOffConflictShiftIds([work])], []);
});
