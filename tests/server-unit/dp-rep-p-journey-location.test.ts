import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { nextJourneyLocationState } from '@/features/dp/rep-p/journey-location-core';
import { JOURNEY_LOCATION_EVENTS, JOURNEY_LOCATION_SESSIONS, recordOwnJourneyLocation } from '@/features/dp/rep-p/journey-location.server';
import { REP_P_LOCATION_RETENTION_DAYS } from '@/features/dp/rep-p/location';
import { journeyLocationBatchSchema } from '@/features/dp/rep-p/schemas';
import type { ServerUserContext } from '@/lib/auth-server';

const event = {
  eventId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  workDate: '2026-10-23',
  executionUnitId: 'unit-a',
  eventType: 'sample' as const,
  capturedAt: '2026-10-23T12:30:00-03:00',
  latitude: -1.455,
  longitude: -48.49,
  accuracyMeters: 25,
};
const leaseToken = 'test-lease-token-that-is-long-enough-for-validation-1234';
const batch = (events: unknown[]) => ({ leaseToken, events });

test('trilha entre unidades aceita posição completa e eventos de controle sem coordenadas', () => {
  const parsed = journeyLocationBatchSchema.safeParse(batch([event, {
    ...event, eventId: '33333333-3333-4333-8333-333333333333', eventType: 'pause',
    latitude: undefined, longitude: undefined, accuracyMeters: undefined,
  }]));
  assert.equal(parsed.success, true);
});

test('trilha entre unidades rejeita posição parcial, duplicidade e mistura de jornadas', () => {
  assert.equal(journeyLocationBatchSchema.safeParse(batch([{ ...event, longitude: undefined }])).success, false);
  assert.equal(journeyLocationBatchSchema.safeParse(batch([event, event])).success, false);
  assert.equal(journeyLocationBatchSchema.safeParse(batch([event, {
    ...event, eventId: '33333333-3333-4333-8333-333333333333', workDate: '2026-10-24',
  }])).success, false);
  assert.equal(journeyLocationBatchSchema.safeParse(batch([{ ...event, eventType: 'start', capturedAt: '2026-10-23T12:31:00-03:00' }, {
    ...event, eventId: '33333333-3333-4333-8333-333333333333', capturedAt: '2026-10-23T12:30:00-03:00',
  }])).success, false);
});

test('máquina de estados exige início, pausa e retomada coerentes', () => {
  assert.equal(nextJourneyLocationState(null, 'start'), 'active');
  assert.equal(nextJourneyLocationState('active', 'pause'), 'paused');
  assert.equal(nextJourneyLocationState('paused', 'resume'), 'active');
  assert.equal(nextJourneyLocationState('active', 'stop'), 'stopped');
  assert.throws(() => nextJourneyLocationState(null, 'sample'));
  assert.throws(() => nextJourneyLocationState('paused', 'sample'));
  assert.throws(() => nextJourneyLocationState('stopped', 'resume'));
});

type Row = Record<string, unknown>;
class FakeSnapshot {
  constructor(readonly id: string, private readonly value?: Row) {}
  get exists() { return this.value !== undefined; }
  data() { return this.value; }
  get(field: string) { return this.value?.[field]; }
}
class FakeRef {
  constructor(readonly db: FakeFirestore, readonly path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  async get() { return new FakeSnapshot(this.id, this.db.rows.get(this.path)); }
  collection(name: string) { return new FakeCollection(this.db, `${this.path}/${name}`); }
}
class FakeCollection {
  constructor(readonly db: FakeFirestore, readonly path: string) {}
  doc(id: string) { return new FakeRef(this.db, `${this.path}/${id}`); }
}
class FakeFirestore {
  rows = new Map<string, Row>();
  collection(name: string) { return new FakeCollection(this, name); }
  async runTransaction<T>(callback: (transaction: {
    get: (ref: FakeRef) => Promise<FakeSnapshot>;
    create: (ref: FakeRef, value: Row) => void;
    update: (ref: FakeRef, value: Row) => void;
  }) => Promise<T>) {
    const transactionRows = new Map(this.rows);
    const result = await callback({
      get: async (ref) => new FakeSnapshot(ref.id, transactionRows.get(ref.path)),
      create: (ref, value) => {
        if (transactionRows.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
        transactionRows.set(ref.path, value);
      },
      update: (ref, value) => {
        const current = transactionRows.get(ref.path);
        if (!current) throw new Error(`missing: ${ref.path}`);
        transactionRows.set(ref.path, { ...current, ...value });
      },
    });
    this.rows = transactionRows;
    return result;
  }
}

const context = { workspace_id: 'workspace-a', decoded: { uid: 'employee-a' }, userDoc: { id: 'employee-a' } } as ServerUserContext;
const shift = {
  date: '2026-10-23', type: 'work' as const, startTime: '08:00', endTime: '16:00', overnight: false,
  unitId: 'unit-a', unitName: 'Unidade A', unitTimeZone: 'America/Fortaleza', shiftName: 'Manhã', breakType: 'fixed' as const,
  breakStart: '12:00', breakEnd: '13:00', breakDurationMinutes: 60, breakWindowStart: null, breakWindowEnd: null,
  expectedPunches: 4, executionUnitPolicy: 'free' as const, locationTrackingPolicy: 'workday' as const,
  breakSegments: null, breakSplit: 'single' as const, breakPauseCount: null, breakMinPauseMinutes: null,
  toleranceMinutes: 10, journeyId: 'journey-a', referenceMinutes: 420,
};
const activePolicy = {
  schemaVersion: 1 as const, workspaceId: 'workspace-a', executionUnitId: 'unit-a', revision: 2, mode: 'observe' as const,
  center: { latitude: -1.455, longitude: -48.49 }, radiusMeters: 100, maxAccuracyMeters: 100, maxAgeSeconds: 120,
  captureTimeoutMs: 10_000, privacyNoticeUrl: 'https://example.com/privacidade', legalBasisReference: 'decisao-formal-001',
  retentionDays: REP_P_LOCATION_RETENTION_DAYS, participantUserIds: ['employee-a'], activatedAt: '2026-10-01T12:00:00Z', activatedBy: 'admin-a',
};
function control(id: string, eventType: 'start' | 'pause' | 'resume' | 'stop', capturedAt: string) {
  return { ...event, eventId: id, eventType, capturedAt, latitude: undefined, longitude: undefined, accuracyMeters: undefined };
}
function dependencies(db: FakeFirestore, policy: typeof activePolicy | (Omit<typeof activePolicy, 'mode' | 'participantUserIds'> & {
  mode: 'disabled';
  participantUserIds: string[];
})) {
  return {
    repDb: db as unknown as Firestore, enabled: true, now: () => new Date('2026-10-23T20:00:00Z'),
    readMonth: async () => ({ month: '2026-10', shifts: [shift], holidays: [], truncated: false }),
    loadPolicies: async () => new Map([['unit-a', policy]]),
    validateLease: async () => ({}),
  };
}

describe('serviço da trilha entre unidades', () => {
  test('grava uma sessão ordenada, pausa amostras e converge replay sem duplicar', async () => {
    const db = new FakeFirestore();
    const events = [
      control('10000000-0000-4000-8000-000000000001', 'start', '2026-10-23T08:00:00-03:00'),
      { ...event, eventId: '10000000-0000-4000-8000-000000000002', capturedAt: '2026-10-23T10:00:00-03:00' },
      control('10000000-0000-4000-8000-000000000003', 'pause', '2026-10-23T12:00:00-03:00'),
      control('10000000-0000-4000-8000-000000000004', 'resume', '2026-10-23T13:00:00-03:00'),
      control('10000000-0000-4000-8000-000000000005', 'stop', '2026-10-23T16:00:00-03:00'),
    ];
    const first = await recordOwnJourneyLocation(context, batch(events), dependencies(db, activePolicy));
    const replay = await recordOwnJourneyLocation(context, batch(events), dependencies(db, activePolicy));
    assert.deepEqual(first.acceptedEventIds, replay.acceptedEventIds);
    assert.equal([...db.rows.keys()].filter((path) => path.startsWith(`${JOURNEY_LOCATION_EVENTS}/`)).length, 5);
    const session = [...db.rows.entries()].find(([path]) => path.startsWith(`${JOURNEY_LOCATION_SESSIONS}/`))?.[1];
    assert.equal(session?.state, 'stopped');
  });

  test('recusa amostra sem início, durante pausa e fora da janela congelada', async () => {
    for (const events of [
      [{ ...event, capturedAt: '2026-10-23T09:00:00-03:00' }],
      [control('10000000-0000-4000-8000-000000000011', 'start', '2026-10-23T08:00:00-03:00'),
        control('10000000-0000-4000-8000-000000000012', 'pause', '2026-10-23T12:00:00-03:00'),
        { ...event, eventId: '10000000-0000-4000-8000-000000000013', capturedAt: '2026-10-23T12:30:00-03:00' }],
      [control('10000000-0000-4000-8000-000000000021', 'start', '2026-10-23T03:00:00-03:00')],
    ]) {
      const db = new FakeFirestore();
      await assert.rejects(recordOwnJourneyLocation(context, batch(events), dependencies(db, activePolicy)));
      assert.equal(db.rows.size, 0);
    }
    const missingZone = { ...shift, unitTimeZone: null };
    const db = new FakeFirestore();
    await assert.rejects(recordOwnJourneyLocation(context,
      batch([control('10000000-0000-4000-8000-000000000022', 'start', '2026-10-23T08:00:00-03:00')]),
      { ...dependencies(db, activePolicy), readMonth: async () => ({ month: '2026-10', shifts: [missingZone], holidays: [], truncated: false }) }));
    assert.equal(db.rows.size, 0);
  });

  test('revoga a sessão, descarta o lote atrasado e não persiste nova coordenada', async () => {
    const db = new FakeFirestore();
    await recordOwnJourneyLocation(context, batch([control('10000000-0000-4000-8000-000000000031', 'start', '2026-10-23T08:00:00-03:00')]), dependencies(db, activePolicy));
    const disabled = { ...activePolicy, mode: 'disabled' as const, participantUserIds: [] };
    const sample = { ...event, eventId: '10000000-0000-4000-8000-000000000032', capturedAt: '2026-10-23T09:00:00-03:00' };
    const result = await recordOwnJourneyLocation(context, batch([sample]), dependencies(db, disabled));
    assert.deepEqual(result.acceptedEventIds, [sample.eventId]);
    assert.equal(result.stopRequested, true);
    assert.equal([...db.rows.keys()].filter((path) => path.startsWith(`${JOURNEY_LOCATION_EVENTS}/`)).length, 1);
    const session = [...db.rows.entries()].find(([path]) => path.startsWith(`${JOURNEY_LOCATION_SESSIONS}/`))?.[1];
    assert.equal(session?.state, 'stopped');
    assert.equal(session?.stoppedReason, 'policy_revoked');
    assert.ok(session?.stoppedAt instanceof Timestamp);
  });

  test('kill switch reconhece o lote como terminal sem tocar no banco', async () => {
    const db = new FakeFirestore();
    const start = control('10000000-0000-4000-8000-000000000041', 'start', '2026-10-23T08:00:00-03:00');
    const result = await recordOwnJourneyLocation(context, batch([start]), { ...dependencies(db, activePolicy), enabled: false });
    assert.deepEqual(result, { acceptedEventIds: [start.eventId], stopRequested: true });
    assert.equal(db.rows.size, 0);
  });

  test('recusa lote que mistura unidade diferente da lease', async () => {
    const db = new FakeFirestore();
    const events = [control('10000000-0000-4000-8000-000000000051', 'start', '2026-10-23T08:00:00-03:00'),
      { ...event, eventId: '10000000-0000-4000-8000-000000000052', executionUnitId: 'unit-b', capturedAt: '2026-10-23T09:00:00-03:00' }];
    await assert.rejects(recordOwnJourneyLocation(context, batch(events), dependencies(db, activePolicy)),
      (cause: unknown) => (cause as { code?: string }).code === 'DP_JOURNEY_LOCATION_UNIT_MISMATCH');
    assert.equal(db.rows.size, 0);
  });

  test('reconhece e ignora amostra redundante sem encerrar a sessão', async () => {
    const db = new FakeFirestore();
    const events = [control('10000000-0000-4000-8000-000000000061', 'start', '2026-10-23T08:00:00-03:00'),
      { ...event, eventId: '10000000-0000-4000-8000-000000000062', capturedAt: '2026-10-23T09:00:00-03:00' },
      { ...event, eventId: '10000000-0000-4000-8000-000000000063', capturedAt: '2026-10-23T09:00:10-03:00' }];
    const result = await recordOwnJourneyLocation(context, batch(events), dependencies(db, activePolicy));
    assert.equal(result.stopRequested, false);
    assert.deepEqual(result.acceptedEventIds, events.map((item) => item.eventId));
    assert.equal([...db.rows.keys()].filter((path) => path.startsWith(`${JOURNEY_LOCATION_EVENTS}/`)).length, 2);
  });
});
