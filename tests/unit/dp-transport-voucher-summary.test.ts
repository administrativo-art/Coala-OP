import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonthlyTransportVoucherSummaries } from '../../src/lib/dp-transport-voucher-summary';
import type { DPSchedule, DPShift } from '../../src/types';

const baseSchedule = {
  name: 'Novembro',
  month: 11,
  year: 2026,
  shiftCount: 0,
  createdAt: {} as DPSchedule['createdAt'],
};

const workShift = (overrides: Partial<DPShift>): DPShift => ({
  id: 'shift',
  scheduleId: 'schedule-a',
  unitId: 'unit-a',
  userId: 'person-a',
  date: '2026-11-01',
  startTime: '09:00',
  endTime: '15:00',
  type: 'work',
  createdAt: {} as DPShift['createdAt'],
  ...overrides,
});

test('consolida VT por pessoa e dia, sem duplicar coberturas em outras unidades', () => {
  const summaries = buildMonthlyTransportVoucherSummaries({
    schedules: [
      { id: 'schedule-a', unitId: 'unit-a', ...baseSchedule },
      { id: 'schedule-b', unitId: 'unit-b', ...baseSchedule },
    ],
    shifts: [
      workShift({ id: 'a-1' }),
      workShift({ id: 'b-1', scheduleId: 'schedule-b', unitId: 'unit-b' }),
      workShift({ id: 'b-2', scheduleId: 'schedule-b', unitId: 'unit-b', date: '2026-11-02' }),
      workShift({ id: 'off', scheduleId: 'schedule-b', unitId: 'unit-b', date: '2026-11-03', type: 'day_off' }),
    ],
    users: [{ id: 'person-a', username: 'Aliny', needsTransportVoucher: true, transportVoucherValue: 12.4 }],
  });

  assert.deepEqual(summaries.get('2026-11'), {
    period: '2026-11',
    totalCents: 2_480,
    people: [{ userId: 'person-a', name: 'Aliny', days: 2, amountCents: 2_480 }],
  });
});

test('usa o valor congelado quando a escala está trancada', () => {
  const summaries = buildMonthlyTransportVoucherSummaries({
    schedules: [{
      id: 'schedule-a',
      unitId: 'unit-a',
      ...baseSchedule,
      locked: true,
      snapshot: {
        users: {
          'person-a': { username: 'Aliny congelada', needsTransportVoucher: true, transportVoucherValue: 10 },
        },
      },
    }],
    shifts: [workShift({})],
    users: [{ id: 'person-a', username: 'Aliny atual', needsTransportVoucher: true, transportVoucherValue: 20 }],
  });

  assert.deepEqual(summaries.get('2026-11')?.people, [
    { userId: 'person-a', name: 'Aliny congelada', days: 1, amountCents: 1_000 },
  ]);
});
