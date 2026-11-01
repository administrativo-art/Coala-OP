import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { enrichJourneyAddresses, selectJourneyGeocodeMilestones } from '@/features/dp/rep-p/location-geocoding.server';

const point = (id: string, latitude: number, longitude: number) => ({ id, capturedAt: '2026-10-30T12:00:00Z',
  status: 'sample', position: { latitude, longitude, accuracyMeters: 20 } });

type Row = Record<string, unknown>;
class Snapshot {
  constructor(private readonly row?: Row) {}
  get exists() { return Boolean(this.row); }
  get(field: string) { return this.row?.[field]; }
}
class Ref {
  constructor(private readonly db: MemoryDb, readonly path: string) {}
  async get() { return new Snapshot(this.db.rows.get(this.path)); }
  async set(value: Row) { this.db.rows.set(this.path, value); }
}
class Collection {
  constructor(private readonly db: MemoryDb, private readonly name: string) {}
  doc(id: string) { return new Ref(this.db, `${this.name}/${id}`); }
}
class MemoryDb {
  rows = new Map<string, Row>();
  collection(name: string) { return new Collection(this, name); }
  async runTransaction<T>(callback: (tx: { get: (ref: Ref) => Promise<Snapshot>; set: (ref: Ref, value: Row, options: unknown) => void }) => Promise<T>) {
    return callback({ get: (ref) => ref.get(), set: (ref, value) => {
      const current = this.rows.get(ref.path) ?? {};
      const next = Number(current.count ?? 0) + 1;
      this.rows.set(ref.path, { ...current, ...value, count: next });
    } });
  }
}

test('geocodificação escolhe marcos distantes, inclui o último e limita a cinco consultas', () => {
  const dense = Array.from({ length: 20 }, (_, index) => point(`dense-${index}`, -1.455 + index * 0.0001, -48.49));
  const sparse = Array.from({ length: 10 }, (_, index) => point(`sparse-${index}`, -1.455 + index * 0.02, -48.49));
  assert.deepEqual(selectJourneyGeocodeMilestones(dense).map((item) => item.id), ['dense-0', 'dense-19']);
  assert.equal(selectJourneyGeocodeMilestones(sparse).length, 5);
});

test('cache tem expiração, evita nova chamada e cota esgotada falha sem expor coordenada', async () => {
  const db = new MemoryDb();
  let calls = 0;
  const fetcher = async () => { calls += 1; return { ok: true, json: async () => ({ status: 'OK', results: [{ formatted_address: 'Rua Teste', place_id: 'place-1' }] }) } as Response; };
  const dependencies = { db: db as unknown as Firestore, now: () => new Date('2026-10-30T12:00:00Z'), fetcher, apiKey: 'test-key', dailyLimit: 1 };
  const first = await enrichJourneyAddresses([point('a', -1.455, -48.49)], dependencies);
  const second = await enrichJourneyAddresses([point('b', -1.455, -48.49)], dependencies);
  assert.equal(first.get('a'), 'Rua Teste');
  assert.equal(second.get('b'), 'Rua Teste');
  assert.equal(calls, 1);
  const cache = [...db.rows.entries()].find(([path]) => path.startsWith('dp_locationGeocodeCache/'))?.[1];
  assert.ok(cache?.expiresAt instanceof Timestamp);

  const limitedDb = new MemoryDb();
  limitedDb.rows.set('dp_locationGeocodeDailyUsage/2026-10-30', { count: 1 });
  calls = 0;
  const none = await enrichJourneyAddresses([point('c', -1.4, -48.4)], { ...dependencies, db: limitedDb as unknown as Firestore });
  assert.equal(none.size, 0);
  assert.equal(calls, 0);
});
