import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatOfficialClock, officialClockOffsetMs } from '../../src/features/dp/rep-p/official-clock';

describe('Relógio do coletor REP-P', () => {
  it('shows hours, minutes and seconds in the establishment time zone, corrected by the measured offset', () => {
    const offset = officialClockOffsetMs('2026-10-18T11:15:42.000Z', Date.parse('2026-10-18T11:15:30.000Z'));
    assert.equal(offset, 12_000);
    assert.equal(formatOfficialClock(Date.parse('2026-10-18T11:15:30.000Z') + offset, 'America/Fortaleza'), '08:15:42');
    assert.equal(formatOfficialClock(Date.parse('2026-10-19T02:59:59.000Z'), 'America/Fortaleza'), '23:59:59');
  });

  it('is required on the collector screen and blocks the button without official time', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/features/dp/rep-p/my-time-recording-page.tsx', 'utf8');
    assert.match(page, /<OfficialClockDisplay clock=\{options\.officialClock\} \/>/);
    assert.match(page, /options\.officialClock\?\.available !== true/);
  });
});
