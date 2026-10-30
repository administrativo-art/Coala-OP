import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { issueOwnJourneyLocationLease, validateOwnJourneyLocationLease } from '@/features/dp/rep-p/journey-location-lease.server';
import { REP_P_LOCATION_RETENTION_DAYS } from '@/features/dp/rep-p/location';
import type { ServerUserContext } from '@/lib/auth-server';

type Row = Record<string, unknown>;
class Snapshot {
  constructor(private readonly row?: Row) {}
  get exists() { return Boolean(this.row); }
  data() { return this.row; }
  get(field: string) { return this.row?.[field]; }
}
class Ref {
  constructor(private readonly db: MemoryDb, readonly path: string) {}
  async get() { return new Snapshot(this.db.rows.get(this.path)); }
  async set(value: Row, options?: { merge?: boolean }) {
    this.db.rows.set(this.path, options?.merge ? { ...(this.db.rows.get(this.path) ?? {}), ...value } : value);
  }
}
class Collection {
  constructor(private readonly db: MemoryDb, private readonly name: string) {}
  doc(id: string) { return new Ref(this.db, `${this.name}/${id}`); }
}
class MemoryDb { rows = new Map<string, Row>(); collection(name: string) { return new Collection(this, name); } }

const context = { workspace_id: 'workspace-a', decoded: { uid: 'employee-a' }, userDoc: { id: 'employee-a' } } as ServerUserContext;
const shift = { date: '2026-10-30', type: 'work' as const, startTime: '08:00', endTime: '16:00', overnight: false,
  unitId: 'unit-a', unitName: 'Unidade A', unitTimeZone: 'America/Fortaleza', shiftName: 'Manhã', breakType: 'fixed' as const,
  breakStart: '12:00', breakEnd: '13:00', breakDurationMinutes: 60, breakWindowStart: null, breakWindowEnd: null,
  expectedPunches: 4, executionUnitPolicy: 'free' as const, locationTrackingPolicy: 'workday' as const,
  breakSegments: null, breakSplit: 'single' as const, breakPauseCount: null, breakMinPauseMinutes: null,
  toleranceMinutes: 10, journeyId: 'journey-a', referenceMinutes: 420 };
const policy = { schemaVersion: 1 as const, workspaceId: 'workspace-a', executionUnitId: 'unit-a', revision: 1,
  mode: 'observe' as const, center: { latitude: -1.45, longitude: -48.49 }, radiusMeters: 100, maxAccuracyMeters: 100,
  maxAgeSeconds: 120, captureTimeoutMs: 10_000, privacyNoticeUrl: 'https://example.com', legalBasisReference: 'legal-1',
  retentionDays: REP_P_LOCATION_RETENTION_DAYS, participantUserIds: ['employee-a'], activatedAt: '2026-10-01T00:00:00Z', activatedBy: 'admin' };
const input = { sessionId: '22222222-2222-4222-8222-222222222222', workDate: '2026-10-30', executionUnitId: 'unit-a' };
const marking = (purpose: 'journey_start' | 'break_start' | 'break_end' | 'journey_end', markedAt: string) => ({
  receiptId: `${purpose}-${markedAt}`, workDate: input.workDate, nsr: 1, markedAt, executionUnitId: 'unit-a', collectorId: '01' as const,
  hash: 'hash', receiptStatus: 'available' as const, receiptIssue: null, classification: { purpose }, pilot: false as const, location: null,
});

function dependencies(db: MemoryDb, now = new Date('2026-10-30T15:00:00Z'), markings = [marking('journey_start', '2026-10-30T12:00:00Z')]) {
  return { hrDb: db as unknown as Firestore, policyDb: db as unknown as Firestore, now: () => now, enabled: true,
    readMonth: async () => ({ month: '2026-10', shifts: [shift], holidays: [], truncated: false }),
    readMarkings: async () => ({ startDate: input.workDate, endDate: input.workDate, markings, truncated: false }),
    loadPolicies: async () => new Map([['unit-a', policy]]) };
}

test('lease só nasce dentro da janela viva da escala', async () => {
  const db = new MemoryDb();
  const lease = await issueOwnJourneyLocationLease(context, input, dependencies(db));
  assert.ok(lease.leaseToken.length >= 40);
  await assert.rejects(issueOwnJourneyLocationLease(context, input, dependencies(new MemoryDb(), new Date('2026-11-01T15:00:00Z'))),
    (cause: unknown) => (cause as { code?: string }).code === 'DP_JOURNEY_LOCATION_NOT_CONFIGURED');
});

test('lease exige início confirmado e recusa intervalo ou jornada encerrada', async () => {
  await assert.rejects(issueOwnJourneyLocationLease(context, input, dependencies(new MemoryDb(), undefined, [])),
    (cause: unknown) => (cause as { code?: string }).code === 'DP_JOURNEY_LOCATION_JOURNEY_INACTIVE');
  await assert.rejects(issueOwnJourneyLocationLease(context, input, dependencies(new MemoryDb(), undefined,
    [marking('journey_start', '2026-10-30T12:00:00Z'), marking('break_start', '2026-10-30T14:00:00Z')])));
  const resumed = await issueOwnJourneyLocationLease(context, input, dependencies(new MemoryDb(), undefined,
    [marking('journey_start', '2026-10-30T12:00:00Z'), marking('break_start', '2026-10-30T14:00:00Z'),
      marking('break_end', '2026-10-30T14:30:00Z')]));
  assert.ok(resumed.leaseToken);
  await assert.rejects(issueOwnJourneyLocationLease(context, input, dependencies(new MemoryDb(), undefined,
    [marking('journey_start', '2026-10-30T12:00:00Z'), marking('journey_end', '2026-10-30T15:00:00Z')])));
});

test('validação recusa unidade divergente, expiração e revogação', async () => {
  const db = new MemoryDb();
  const now = new Date('2026-10-30T15:00:00Z');
  const lease = await issueOwnJourneyLocationLease(context, input, dependencies(db, now));
  await assert.rejects(validateOwnJourneyLocationLease(context, { ...input, executionUnitId: 'unit-b', leaseToken: lease.leaseToken },
    { hrDb: db as unknown as Firestore, now: () => now }));
  await assert.rejects(validateOwnJourneyLocationLease(context, { ...input, leaseToken: lease.leaseToken },
    { hrDb: db as unknown as Firestore, now: () => new Date('2026-10-30T16:00:00Z') }));
  const row = [...db.rows.values()][0];
  row.status = 'revoked'; row.expiresAt = Timestamp.fromDate(new Date('2026-10-30T17:00:00Z'));
  await assert.rejects(validateOwnJourneyLocationLease(context, { ...input, leaseToken: lease.leaseToken },
    { hrDb: db as unknown as Firestore, now: () => now }));
});
