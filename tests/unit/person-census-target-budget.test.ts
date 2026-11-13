import assert from 'node:assert/strict';
import test from 'node:test';
import { targetReadBudget, verifyCensusTarget } from '../../scripts/person-census-targets.mjs';

test('target budget reserves before concurrent queries and conservatively retains failed reservation', async () => {
  let calls = 0; let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const limited = targetReadBudget(2);
  const query = { async get() { calls++; await pending; return { size: 2 }; } };
  const first = limited(query, 2);
  await assert.rejects(limited(query, 1), /target_read_limit/);
  assert.equal(calls, 1); release(); await first;
  await assert.rejects(limited(query, 1), /target_read_limit/);
  const failed = targetReadBudget(1);
  await assert.rejects(failed({ async get() { throw new Error('private-backend'); } }, 1));
  await assert.rejects(failed({ async get() { calls++; return { size: 0 }; } }, 1), /target_read_limit/);
  assert.equal(calls, 1);
});

function targetDb(total: number, calls: { value: number }, anchor: 'user' | 'candidate') {
  return { collection(name: string) {
    let field: unknown, value: unknown, cap = 0;
    const q = { where(f: unknown, _op: string, v: unknown) { field = f; value = v; return q; }, limit(n: number) { cap = n; return q; }, select() { return q; }, async get() {
      calls.value++;
      let rows: Array<Record<string, unknown>> = [];
      if (name === 'users') rows = value === 'u' ? [{ id: 'u', workspaceId: 'w', recruitmentCandidateId: 'c' }] : [];
      if (name === 'candidates') rows = [{ id: 'c', workspaceId: 'w' }];
      if (name === 'onboardingProcesses') rows = Array.from({ length: total }, (_, i) => ({ id: `p${i}`, workspaceId: 'w', candidateId: 'c', collaboratorUserId: i === 21 ? 'different-account' : 'u' }));
      if (name === 'employees') rows = [];
      void field; void anchor;
      const docs = rows.slice(0, cap).map(({ id, ...data }) => ({ id, data: () => data })); return { docs, size: docs.length };
    } }; return q;
  } };
}
for (const namespace of ['main.users', 'hr.candidates'] as const) for (const total of [21, 22]) test(`document target refuses ${total} processes for ${namespace}, including hidden conflicting 22nd`, async () => {
  const calls = { value: 0 }; const db = targetDb(total, calls, namespace === 'main.users' ? 'user' : 'candidate');
  await assert.rejects(verifyCensusTarget({ target: { database: 'main', collection: 'generatedDocuments', id: 'target', subject: { namespace, id: namespace === 'main.users' ? 'u' : 'c' } }, data: { subjectKeys: [`${namespace}:${namespace === 'main.users' ? 'u' : 'c'}`] }, workspace: 'w', maxReads: 100, dbFor: () => db }), /process_limit/);
  assert.ok(calls.value <= 8, `bounded actual queries: ${calls.value}`);
});
