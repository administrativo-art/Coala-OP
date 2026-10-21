import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dayMarkingOrder } from '../../src/features/dp/rep-p/marking-order';

describe('Ordem das batidas no dia', () => {
  it('numbers by instant and restarts each day, regardless of the order received', () => {
    const order = dayMarkingOrder([
      { receiptId: 'c', workDate: '2026-10-19', markedAt: '2026-10-19T12:01:00-03:00', nsr: 47 },
      { receiptId: 'a', workDate: '2026-10-19', markedAt: '2026-10-19T07:58:00-03:00', nsr: 41 },
      { receiptId: 'z', workDate: '2026-10-18', markedAt: '2026-10-18T18:00:00-03:00', nsr: 40 },
      { receiptId: 'b', workDate: '2026-10-19', markedAt: '2026-10-19T11:02:00-03:00', nsr: 44 },
    ]);
    assert.deepEqual([...['z', 'a', 'b', 'c']].map((id) => order.get(id)), [1, 1, 2, 3]);
  });

  it('breaks a same-minute tie by NSR', () => {
    const order = dayMarkingOrder([
      { receiptId: 'late', workDate: '2026-10-19', markedAt: '2026-10-19T08:00:00-03:00', nsr: 12 },
      { receiptId: 'early', workDate: '2026-10-19', markedAt: '2026-10-19T08:00:00-03:00', nsr: 11 },
    ]);
    assert.deepEqual([order.get('early'), order.get('late')], [1, 2]);
  });
});
