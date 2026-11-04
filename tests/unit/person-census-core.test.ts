import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCensusProjection, censusSource, censusLegacyDeploymentSource, projectCensusData } from '../../scripts/person-census-core.mjs';

function fakeDb(records: Array<{ id: string; data: Record<string, unknown> }>, repeat = false) {
  return { collection() { return { where(field: string, _op: string, workspace: string) {
    let after: string | null = null; let size = 0;
    const query = { orderBy() { return query; }, limit(n: number) { size = n; return query; }, startAfter(id: string) { after = id; return query; },
      select() { return query; }, async get() { const docs = records.filter(({ id, data }) => data[field] === workspace && (repeat || !after || id > after)).slice(0, size).map(({ id, data }) => ({ id, data: () => data })); return { docs }; } };
    return query;
  } }; } };
}

test('bounded workspace pages exclude other tenants and project no PII', async () => {
  const records = ['a', 'b', 'c', 'd'].map((id) => ({ id, data: { workspaceId: id === 'd' ? 'other' : 'w', employeeId: id, cpf: 'secret', email: 'secret@example.test' } }));
  const rows: unknown[] = [];
  const result = await censusSource({ db: fakeDb(records), database: 'main', collection: 'users', workspace: 'w', scopeField: 'workspaceId', pageSize: 2, maxReads: 10, maxPages: 5, onRow: (row: unknown) => { rows.push(row); } });
  assert.equal(result.status, 'complete'); assert.equal(result.pages, 2); assert.equal(rows.length, 3);
  assert.equal(JSON.stringify(rows).includes('secret'), false);
  assert.deepEqual(projectCensusData({ employeeId: 'u', metadata: { target_id: 'u', token: 'secret' }, cpf: 'secret' }), { employeeId: 'u', 'metadata.target_id': 'u' });
  assert.deepEqual(projectCensusData({ employeeId: '12345678901', userId: 'name@example.test', 'metadata.target_id': 'John Smith' }), {});
});

test('limits, repeated cursor and partial failure never report complete', async () => {
  const records = ['a', 'b', 'c'].map((id) => ({ id, data: { workspaceId: 'w' } }));
  const base = { database: 'main', collection: 'users', workspace: 'w', scopeField: 'workspaceId', pageSize: 2, maxPages: 5, onRow() {} };
  assert.equal((await censusSource({ ...base, db: fakeDb(records), maxReads: 2 })).reason, 'limit_reached');
  assert.equal((await censusSource({ ...base, db: fakeDb(records, true), maxReads: 10 })).reason, 'cursor_repeated');
  const failed = { collection() { return { where() { return { orderBy() { return this; }, limit() { return this; }, select() { return this; }, async get() { throw new Error('private detail'); } }; } }; } };
  const result = await censusSource({ ...base, db: failed, maxReads: 10 });
  assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'read_failed');
  assert.equal(JSON.stringify(result).includes('private detail'), false);
});

test('invalid identifiers and nested historical references cannot disappear into a complete census', async () => {
  const malformed = [
    { employeeId: '12345678901' },
    { employeeId: 123 },
    { subjectKeys: 'not-an-array' },
    { partyKeys: ['hr.employees:invalid/path'] },
    { personBinding: { bindingHash: 'a'.repeat(64), subjectKeys: ['main.users:invalid/path'] } },
    { personBinding: { bindingHash: 'a'.repeat(64), partyKeys: 'not-an-array' } },
  ];
  for (const data of malformed) {
    assert.throws(() => assertCensusProjection(data, projectCensusData(data)), /projection_invalid/);
    const rows: unknown[] = [];
    const result = await censusSource({ db: fakeDb([{ id: 'bad', data: { workspaceId: 'w', ...data } }]),
      database: 'main', collection: 'users', workspace: 'w', scopeField: 'workspaceId',
      pageSize: 2, maxReads: 10, maxPages: 5, onRow: (row: unknown) => rows.push(row) });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.reason, 'projection_invalid');
    assert.equal(rows.length, 0);
  }
  const valid = { employeeId: 'user-a', personBinding: { bindingHash: 'a'.repeat(64), subjectKeys: [], partyKeys: ['hr.employees:employee-a'] } };
  assert.doesNotThrow(() => assertCensusProjection(valid, projectCensusData(valid)));
});

test('legacy deployment scan distinguishes missing and explicit workspace and rejects every raw contradiction', async () => {
  function db(records: Array<{ id: string; data: Record<string, unknown> }>) {
    return { collection() { let size = 0; let after: string | null = null;
      const query = { orderBy() { return query; }, limit(n: number) { size = n; return query; }, startAfter(id: string) { after = id; return query; }, select() { return query; },
        async get() { return { docs: records.filter(({ id }) => !after || id > after).slice(0, size).map(({ id, data }) => ({ id, data: () => data })) }; } };
      return query;
    } };
  }
  const base = { database: 'main', collection: 'users', workspace: 'coala', pageSize: 2, maxReads: 10, maxPages: 5 };
  const rows: Array<{ scopeEvidence: string }> = [];
  const result = await censusLegacyDeploymentSource({ ...base, db: db([{ id: 'a', data: {} }, { id: 'b', data: { workspaceId: 'coala' } }]), onRow: (row: { scopeEvidence: string }) => { rows.push(row); } });
  assert.equal(result.status, 'complete');
  assert.deepEqual(rows.map((row) => row.scopeEvidence), ['legacy-deployment', 'explicit-workspace']);
  for (const data of [{ workspaceId: 'coala', workspace_id: 'other' }, { workspaceId: 'other', workspace_id: 'coala' }, { workspaceId: 'coala', workspace_id: '' }]) {
    const emitted: unknown[] = [];
    const blocked = await censusLegacyDeploymentSource({ ...base, db: db([{ id: 'a', data }]), onRow: (row: unknown) => { emitted.push(row); } });
    assert.equal(blocked.status, 'incomplete'); assert.equal(blocked.reason, 'scope_mismatch'); assert.equal(emitted.length, 0);
  }
});


test('contradictory or invalid raw workspace never becomes exportable after projection, in either order', async () => {
  const { matchesPersonWorkspace } = await import('../../src/features/privacy/person-workspace');
  for (const data of [{ workspaceId: 'w', workspace_id: 'other' }, { workspaceId: 'other', workspace_id: 'w' }, { workspaceId: 'w', workspace_id: '' }, { workspaceId: 'w', workspace_id: {} }, { workspaceId: 'w', workspace_id: 42 }]) {
    assert.equal(matchesPersonWorkspace(data, 'w', true), false);
    const rows: unknown[] = [];
    const scopeField = data.workspaceId === 'w' ? 'workspaceId' : 'workspace_id';
    const result = await censusSource({ db: fakeDb([{ id: 'rejected', data }]), database: 'main', collection: 'users', workspace: 'w', scopeField, pageSize: 2, maxReads: 10, maxPages: 5, onRow: (row: unknown) => rows.push(row) });
    assert.equal(result.reason, 'scope_mismatch'); assert.equal(rows.length, 0);
    assert.equal(JSON.stringify(result).includes('other'), false);
  }
  assert.equal(matchesPersonWorkspace({}, 'w'), false);
  assert.equal(matchesPersonWorkspace({}, 'w', true), true);
  assert.equal(matchesPersonWorkspace({ workspaceId: 'w', workspace_id: 'w' }, 'w'), true);
});
