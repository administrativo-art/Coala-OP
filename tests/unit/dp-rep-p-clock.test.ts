import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertTrustedRepPClockReading,
  formatRepPAfdTimestamp,
  REP_P_MAX_HLB_OFFSET_MS,
} from '../../src/features/dp/rep-p/clock';

describe('REP-P trusted clock boundary', () => {
  const evidence = {
    attestationId: 'a'.repeat(64), attestationMode: 'fresh' as const, quorum: 2,
    observations: [
      { server: '200.20.186.75', status: 'accepted' as const, offsetMs: 0, roundTripMs: 10, stratum: 1 },
      { server: '200.20.186.94', status: 'accepted' as const, offsetMs: 1, roundTripMs: 11, stratum: 1 },
    ],
  };
  it('formats the same instant in the establishment IANA time zone', () => {
    assert.equal(formatRepPAfdTimestamp(new Date('2026-10-18T11:15:42.000Z'), 'America/Belem'),
      '2026-10-18T08:15:00-0300');
    assert.equal(formatRepPAfdTimestamp(new Date('2026-10-18T15:15:42.000Z'), 'America/Manaus'),
      '2026-10-18T11:15:00-0400');
  });

  it('accepts a fresh HLB attestation at the boundary', () => {
    const now = new Date('2026-10-18T11:15:42.000Z');
    assert.doesNotThrow(() => assertTrustedRepPClockReading({
      instant: now, source: 'synthetic-test-ntp', assurance: 'hlb_verified',
      observedOffsetMs: REP_P_MAX_HLB_OFFSET_MS, verifiedAt: now, ...evidence,
    }, now));
  });

  it('fails closed for unverified, stale or out-of-tolerance time', () => {
    const now = new Date('2026-10-18T11:15:42.000Z');
    const base = { instant: now, source: 'test', assurance: 'hlb_verified' as const,
      observedOffsetMs: 0, verifiedAt: now, ...evidence };
    for (const reading of [
      { ...base, assurance: 'unverified' as const },
      { ...base, observedOffsetMs: REP_P_MAX_HLB_OFFSET_MS + 1 },
      { ...base, verifiedAt: new Date(now.getTime() - 5 * 60_000 - 1) },
      { ...base, attestationId: '' },
    ]) assert.throws(() => assertTrustedRepPClockReading(reading, now), { code: 'REP_P_TIME_UNAVAILABLE' });
  });
});
