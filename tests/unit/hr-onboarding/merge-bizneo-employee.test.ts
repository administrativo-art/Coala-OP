import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { mergeBizneoEmployee } from '../../../src/lib/hr/merge-bizneo-employee';

function fixture(initial: Record<string, Record<string, unknown>>) {
  const documents = structuredClone(initial);
  let writes = 0;
  const db = {
    collection: () => ({ doc: (id: string) => id }),
    runTransaction: async (callback: (transaction: unknown) => Promise<void>) => {
      const pending: Array<[string, Record<string, unknown>]> = [];
      await callback({
        getAll: async (...ids: string[]) => ids.map(id => ({
          exists: id in documents,
          data: () => documents[id],
        })),
        set: (id: string, data: Record<string, unknown>) => pending.push([id, data]),
        update: (id: string, data: Record<string, unknown>) => pending.push([id, data]),
      });
      for (const [id, data] of pending) {
        documents[id] = { ...documents[id], ...data };
        writes++;
      }
    },
  } as unknown as Firestore;
  return { db, documents, writes: () => writes };
}

test('reconciles legacy fields into UID, preserving canonical data and legacy audit', async () => {
  const canonical = { name: 'Nome atual', email: 'atual@example.com', cpf: null, auth_uid: 'uid', bizneo_employee_id: 'uid' };
  const legacy = { name: 'Nome antigo', email: 'antigo@example.com', cpf: 'old', custom: 'preservado' };
  const state = fixture({ uid: canonical, '123': legacy });
  await mergeBizneoEmployee(state.db, 'uid', '123', 'first');
  assert.deepEqual(state.documents.uid, {
    ...canonical, custom: 'preservado', source_user_id: 'uid', bizneo_employee_id: '123',
  });
  assert.deepEqual(state.documents['123'], { ...legacy, merged_into: 'uid', merged_at: 'first' });
  await mergeBizneoEmployee(state.db, 'uid', '123', 'second');
  assert.equal(state.writes(), 2);
  assert.equal(state.documents['123'].merged_at, 'first');
});

test('missing legacy and identical IDs do not create documents or write', async () => {
  const state = fixture({ uid: { name: 'Atual' } });
  await mergeBizneoEmployee(state.db, 'uid', '123', 'now');
  await mergeBizneoEmployee(state.db, 'uid', 'uid', 'now');
  assert.equal(state.writes(), 0);
  assert.equal(state.documents['123'], undefined);
});

test('missing canonical, conflicting owners and previous merges cannot modify either record', async () => {
  for (const initial of [
    { '123': {} },
    { uid: {}, '123': { auth_uid: 'other' } },
    { uid: {}, '123': { source_user_id: 'other' } },
    { uid: {}, '123': { merged_into: 'other' } },
    { uid: { merged_into: 'other' }, '123': {} },
    { uid: { auth_uid: 'other' }, '123': {} },
  ]) {
    const state = fixture(initial as Record<string, Record<string, unknown>>);
    await assert.rejects(mergeBizneoEmployee(state.db, 'uid', '123', 'now'));
    assert.deepEqual(state.documents, initial);
    assert.equal(state.writes(), 0);
  }
});
