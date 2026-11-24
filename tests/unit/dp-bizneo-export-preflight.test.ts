import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyBizneoExportWorkShift, findBizneoExportDayOffConflicts } from '../../src/lib/dp-bizneo-export-preflight';
import type { DPShift } from '../../src/types';

function shift(params: Partial<DPShift> & Pick<DPShift, 'id' | 'userId' | 'date'>): DPShift {
  return {
    scheduleId: 'schedule-1',
    unitId: 'unit-1',
    startTime: '',
    endTime: '',
    type: 'day_off',
    createdAt: {} as DPShift['createdAt'],
    ...params,
  };
}

test('bloqueia exportação quando a mesma pessoa possui turno e folga', () => {
  const dayOff = shift({ id: 'day-off', userId: 'aliny', date: '2026-09-12', bizneoSyncStatus: 'pending' });
  const work = shift({
    id: 'work', userId: 'aliny', date: '2026-09-12', type: 'work', startTime: '14:45', endTime: '21:00',
    scheduleId: 'schedule-2', unitId: 'unit-2',
  });

  assert.deepEqual(findBizneoExportDayOffConflicts([work, dayOff]), [dayOff]);
});

test('permite exportar turnos com folgas sem confirmação do Bizneo', () => {
  const statuses = ['pending', 'publishing', 'failed', 'removing', 'removal_failed', undefined] as const;
  const shifts = [
    shift({ id: 'work', userId: 'maria', date: '2026-09-09', type: 'work', startTime: '08:00', endTime: '16:00' }),
    ...statuses.map((bizneoSyncStatus, index) => shift({
      id: `day-off-${index}`,
      userId: 'maria',
      date: `2026-09-${10 + index}`,
      bizneoSyncStatus,
    })),
  ];

  assert.deepEqual(findBizneoExportDayOffConflicts(shifts), []);
});

test('permite folga publicada sem turno concorrente', () => {
  const blockers = findBizneoExportDayOffConflicts([
    shift({ id: 'day-off', userId: 'maria', date: '2026-09-10', bizneoSyncStatus: 'published' }),
  ]);

  assert.deepEqual(blockers, []);
});

test('exclui somente os períodos manuais sem ID Bizneo e preserva outros turnos da pessoa', () => {
  const segments = [
    { manualDay: { mode: 'fixed', expectedBreakMinutes: 30 } as const, manualDayId: 'manual-day-1' },
    { manualDayId: 'manual-day-1' },
  ];
  assert.deepEqual(segments.map((segment) => classifyBizneoExportWorkShift(segment, '')), ['omit-manual', 'omit-manual']);
  assert.equal(classifyBizneoExportWorkShift(segments[0], '123'), 'export');
  assert.equal(classifyBizneoExportWorkShift({ shiftDefinitionId: 'definition-2' }, '456'), 'export');
});

test('mantém o bloqueio de turno comum sem ID Bizneo, inclusive sem definição', () => {
  assert.equal(classifyBizneoExportWorkShift({ shiftDefinitionId: 'definition-no-bizneo' }, ''), 'missing-id');
  assert.equal(classifyBizneoExportWorkShift({}, ''), 'missing-id');
});
