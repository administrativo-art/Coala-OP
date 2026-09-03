import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDPScheduleDocumentId,
  formatDPSchedulePeriod,
  getAutomaticDPSchedulePeriods,
  parseDPSchedulePeriod,
} from '../../src/lib/dp-schedule-periods';

test('uses one deterministic document per period and canonical unit', () => {
  assert.equal(
    buildDPScheduleDocumentId(2026, 9, 'unit/main'),
    '2026-09--unit%2Fmain',
  );
  assert.equal(
    buildDPScheduleDocumentId(2026, 9, 'unit/main'),
    buildDPScheduleDocumentId(2026, 9, 'unit/main'),
  );
  assert.notEqual(
    buildDPScheduleDocumentId(2026, 9, 'unit/main'),
    buildDPScheduleDocumentId(2026, 10, 'unit/main'),
  );
});

test('formats and parses a valid DP schedule period', () => {
  assert.equal(formatDPSchedulePeriod(2026, 9), '2026-09');
  assert.deepEqual(parseDPSchedulePeriod('2026-09'), {
    period: '2026-09',
    year: 2026,
    month: 9,
  });
});

test('rejects malformed and out-of-range DP schedule periods', () => {
  assert.equal(parseDPSchedulePeriod('2026-9'), null);
  assert.equal(parseDPSchedulePeriod('2026-00'), null);
  assert.equal(parseDPSchedulePeriod('2026-13'), null);
  assert.equal(parseDPSchedulePeriod('2019-12'), null);
});

test('creates the current and next month automatically across a year boundary', () => {
  assert.deepEqual(getAutomaticDPSchedulePeriods(new Date(2026, 11, 15)), [
    { period: '2026-12', year: 2026, month: 12 },
    { period: '2027-01', year: 2027, month: 1 },
  ]);
});
