import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { readLocation } from '@/features/dp/rep-p/location-access.server';
import type { ServerUserContext } from '@/lib/auth-server';

test('auditoria é confirmada antes de qualquer enriquecimento externo', async () => {
  const order: string[] = [];
  const now = new Date('2026-10-30T12:00:00Z');
  const event = {
    id: 'event-a',
    data: () => ({ capturedAt: Timestamp.fromDate(now), eventType: 'sample',
      position: { latitude: -1.45, longitude: -48.49, accuracyMeters: 20 } }),
    get: (field: string) => field === 'expiresAt' ? Timestamp.fromDate(new Date('2026-11-01T00:00:00Z')) : undefined,
  };
  const query = {
    where() { return this; }, orderBy() { return this; }, limit() { return this; }, startAfter() { return this; },
    async get() { return { docs: [event], size: 1 }; },
  };
  const hrDb = { collection: () => query } as unknown as Firestore;
  const repDb = { collection: () => ({ doc: () => ({ id: 'audit-a', async create() { order.push('audit'); } }) }) } as unknown as Firestore;
  const context = { workspace_id: 'workspace-a', decoded: { uid: 'employee-a' }, userDoc: { id: 'employee-a' } } as ServerUserContext;
  const result = await readLocation(context, { employeeUid: 'employee-a', unitId: 'unit-a', workDate: '2026-10-30',
    source: 'journey', reason: 'own_data', limit: 20 }, { repDb, hrDb, now: () => now,
    enrichAddresses: async () => { order.push('google'); return new Map([['event-a', 'Rua Teste']]); } });
  assert.deepEqual(order, ['audit', 'google']);
  assert.equal(result.entries[0]?.formattedAddress, 'Rua Teste');
});
