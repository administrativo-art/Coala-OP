import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBizneoExportDayOffBlockers } from '../../src/lib/dp-bizneo-export-preflight';
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
  const blockers = buildBizneoExportDayOffBlockers([
    shift({ id: 'work', userId: 'aliny', date: '2026-09-12', type: 'work', startTime: '14:45', endTime: '21:00' }),
    shift({ id: 'day-off', userId: 'aliny', date: '2026-09-12', bizneoSyncStatus: 'removal_failed' }),
  ]);

  assert.deepEqual(blockers, [{
    kind: 'work_day_off_conflict',
    userId: 'aliny',
    date: '2026-09-12',
    shiftId: 'day-off',
    syncStatus: 'removal_failed',
  }]);
});

test('bloqueia folga com sincronização ainda não confirmada', () => {
  const blockers = buildBizneoExportDayOffBlockers([
    shift({ id: 'day-off', userId: 'maria', date: '2026-09-10', bizneoSyncStatus: 'failed' }),
  ]);

  assert.equal(blockers[0]?.kind, 'day_off_sync_unresolved');
});

test('permite folga publicada sem turno concorrente', () => {
  const blockers = buildBizneoExportDayOffBlockers([
    shift({ id: 'day-off', userId: 'maria', date: '2026-09-10', bizneoSyncStatus: 'published' }),
  ]);

  assert.deepEqual(blockers, []);
});
