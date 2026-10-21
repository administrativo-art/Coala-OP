import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const REP_P_COLLECTIONS = ['repP_establishments', 'repP_employees', 'repP_events', 'repP_attempts', 'repP_receipts', 'repP_offlinePermits', 'repP_exportAudit'];

describe('REP-P ARP isolation', () => {
  it('lives in coala-rh and denies every direct client operation on its collections', () => {
    const config = JSON.parse(readFileSync('firebase.json', 'utf8'));
    assert.ok(!config.firestore.some((item: { database: string }) => item.database === 'coala-rep'));
    assert.match(readFileSync('src/features/dp/rep-p/service.server.ts', 'utf8'), /repDb: hrDbAdmin/);
    const rules = readFileSync('firestore.rh.rules', 'utf8');
    for (const collection of REP_P_COLLECTIONS) {
      assert.match(rules, new RegExp(`match /${collection}/\\{id\\} \\{ allow read, write: if false; \\}`), collection);
    }
    const indexes = JSON.parse(readFileSync('firestore.rh.indexes.json', 'utf8')).indexes as { collectionGroup: string }[];
    assert.ok(indexes.some((index) => index.collectionGroup === 'repP_events'));
    assert.ok(indexes.some((index) => index.collectionGroup === 'repP_receipts'));
  });
});
