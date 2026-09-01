import assert from 'node:assert/strict';
import test from 'node:test';

import { compareWorkShiftsByTime } from '../../src/lib/dp-shift-rules';
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
