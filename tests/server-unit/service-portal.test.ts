import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import {
  activatePortalInvitation, authenticatePortalSession, hashPortalPassword,
  loginPortal, revokePortalSession, verifyPortalPassword,
} from '../../src/features/service-portal/auth.server';
import { listPortalGrants, listPortalManagement, managePortal } from '../../src/features/service-portal/management.server';
import type { PortalDependencies } from '../../src/features/service-portal/types';

type Row = Record<string, unknown>;
class MemoryDatabase {
  rows = new Map<string, Row>();
  private queue = Promise.resolve();
  collection(name: string) { return new MemoryCollection(this, name); }
  async runTransaction<T>(callback: (tx: MemoryTransaction) => Promise<T>) {
    let release = () => {};
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const tx = new MemoryTransaction(this);
      const result = await callback(tx);
      tx.commit();
      return result;
    } finally { release(); }
  }
}
class MemoryReference {
  constructor(readonly db: MemoryDatabase, readonly path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  async get() { return snapshot(this, this.db.rows.get(this.path)); }
}
function snapshot(ref: MemoryReference, row?: Row) {
  return { exists: Boolean(row), id: ref.id, ref, data: () => row ? structuredClone(row) : undefined, get: (key: string) => row?.[key] };
}
class MemoryCollection {
  private filters: Array<[string, string, unknown]> = [];
  private maximum = Infinity;
  constructor(private db: MemoryDatabase, private name: string) {}
  doc(id: string) { return new MemoryReference(this.db, this.name + '/' + id); }
  where(field: string, operator: string, value: unknown) { this.filters.push([field, operator, value]); return this; }
  limit(value: number) { this.maximum = value; return this; }
  async get() {
    const docs = [...this.db.rows].filter(([path, row]) => path.startsWith(this.name + '/') && this.filters.every(([field, operator, value]) =>
      operator === '>' ? String(row[field]) > String(value) : row[field] === value)).slice(0, this.maximum)
      .map(([path, row]) => snapshot(new MemoryReference(this.db, path), row));
    return { docs, size: docs.length, empty: !docs.length };
  }
}
class MemoryTransaction {
  private changes: Array<{ ref: MemoryReference; row: Row; mode: 'set' | 'create' | 'update' }> = [];
  constructor(private db: MemoryDatabase) {}
  get(ref: MemoryReference) { return ref.get(); }
  set(ref: MemoryReference, row: Row) { this.changes.push({ ref, row, mode: 'set' }); }
  create(ref: MemoryReference, row: Row) { this.changes.push({ ref, row, mode: 'create' }); }
  update(ref: MemoryReference, row: Row) { this.changes.push({ ref, row, mode: 'update' }); }
  commit() {
    for (const { ref, row, mode } of this.changes) {
      if (mode === 'create') assert.equal(this.db.rows.has(ref.path), false);
      if (mode === 'update') assert.equal(this.db.rows.has(ref.path), true);
      this.db.rows.set(ref.path, structuredClone(mode === 'update' ? { ...this.db.rows.get(ref.path), ...row } : row));
    }
  }
}
function fixture() {
  const db = new MemoryDatabase();
  let now = new Date('2026-11-23T12:00:00Z');
  const deps: PortalDependencies = { db: db as unknown as Firestore, now: () => now,
    randomId: randomUUID, randomToken: () => randomBytes(32).toString('base64url'), internalEmailExists: async () => false };
  const actor = { uid: 'rh-user', workspaceId: 'coala' };
  const act = (input: Parameters<typeof managePortal>[1]) => managePortal(actor, input, deps);
  const prepare = async () => {
    const { office } = await act({ action: 'create_office', name: 'Escritório Contábil', requestId: randomUUID() });
    const invited = await act({ action: 'invite_member', officeId: office!.id, name: 'Contadora Teste', email: 'contador@example.test', requestId: randomUUID() });
    return { office: office!, member: invited.member!, invitation: invited.invitation! };
  };
  return { db, deps, actor, act, prepare, advance: (date: string) => { now = new Date(date); } };
}
const password = 'senha-de-teste-com-24-caracteres';

test('password hashing verifies exact input and rejects invalid encodings', async () => {
  const hashed = await hashPortalPassword(password);
  assert.equal(await verifyPortalPassword(password, hashed), true);
  assert.equal(await verifyPortalPassword(password + 'x', hashed), false);
  assert.equal(await verifyPortalPassword(password, null), false);
  assert.notEqual((await hashPortalPassword(password)).hash, hashed.hash);
});

test('invitation activates once, management retries preserve identity and never return a second token', async () => {
  const f = fixture();
  const { office, member, invitation } = await f.prepare();
  const activated = await activatePortalInvitation(invitation.token, password, f.deps);
  assert.equal(activated.id, member.id);
  assert.equal(activated.accountType, 'service_provider');
  assert.equal('password' in activated, false);
  await assert.rejects(activatePortalInvitation(invitation.token, password, f.deps));
  const request = { action: 'invite_member' as const, officeId: office.id, name: 'Segunda pessoa', email: 'segundo@example.test', requestId: randomUUID() };
  const first = await f.act(request);
  const second = await f.act(request);
  assert.equal(second.member?.id, first.member?.id);
  assert.equal(second.invitation, undefined);
  await assert.rejects(f.act({ ...request, name: 'Outro conteúdo' }));
  await assert.rejects(f.act({ ...request, email: 'CONTADOR@EXAMPLE.TEST', requestId: randomUUID() }));
  const data = JSON.stringify([...f.db.rows]);
  assert.equal(data.includes(password), false);
  assert.equal(data.includes(invitation.token), false);
  assert.equal([...f.db.rows.keys()].some((key) => key.startsWith('users/') || key.startsWith('employees/')), false);
});

test('sessions expire, logout revokes, and suspended offices cannot revive old sessions', async () => {
  const f = fixture();
  const { office, invitation } = await f.prepare();
  await activatePortalInvitation(invitation.token, password, f.deps);
  const login = await loginPortal(' CONTADOR@example.test ', password, f.deps);
  assert.equal((await authenticatePortalSession(login.token, f.deps)).officeId, office.id);
  await f.act({ action: 'set_office_active', officeId: office.id, active: false });
  await assert.rejects(authenticatePortalSession(login.token, f.deps));
  await f.act({ action: 'set_office_active', officeId: office.id, active: true });
  await assert.rejects(authenticatePortalSession(login.token, f.deps));
  const fresh = await loginPortal('contador@example.test', password, f.deps);
  await revokePortalSession(fresh.token, f.deps);
  await assert.rejects(authenticatePortalSession(fresh.token, f.deps));
  const expiring = await loginPortal('contador@example.test', password, f.deps);
  f.advance('2026-11-23T21:00:00Z');
  await assert.rejects(authenticatePortalSession(expiring.token, f.deps));
});

test('login attempts throttle unknown and known addresses and a recovery invitation invalidates old credentials', async () => {
  const f = fixture();
  const { member, invitation } = await f.prepare();
  await activatePortalInvitation(invitation.token, password, f.deps);
  for (let index = 0; index < 5; index++) await assert.rejects(loginPortal('unknown@example.test', password, f.deps));
  await assert.rejects(loginPortal('unknown@example.test', password, f.deps), (cause: unknown) => (cause as { httpStatus: number }).httpStatus === 429);
  const logged = await loginPortal(member.email, password, f.deps);
  const recovery = await f.act({ action: 'reissue_invitation', memberId: member.id, requestId: randomUUID() });
  await assert.rejects(authenticatePortalSession(logged.token, f.deps));
  await assert.rejects(loginPortal(member.email, password, f.deps));
  await activatePortalInvitation(recovery.invitation!.token, password + 'novo', f.deps);
  assert.equal((await loginPortal(member.email, password + 'novo', f.deps)).principal.memberId, member.id);
  for (let index = 0; index < 5; index++) await assert.rejects(loginPortal(member.email, 'senha-incorreta', f.deps));
  await assert.rejects(loginPortal(member.email, password + 'novo', f.deps), (cause: unknown) => (cause as { httpStatus: number }).httpStatus === 429);
});

test('grants isolate member, employer, competence and workspace and disappear after expiry or revocation', async () => {
  const f = fixture();
  const { member, invitation } = await f.prepare();
  await activatePortalInvitation(invitation.token, password, f.deps);
  const { principal } = await loginPortal(member.email, password, f.deps);
  const { grant } = await f.act({ action: 'grant', memberId: member.id, employerUnitId: 'empresa-A', competence: '2026-10', expiresAt: '2026-11-24T12:00:00Z', requestId: randomUUID() });
  assert.deepEqual((await listPortalGrants(principal, f.deps)).map((entry) => entry.id), [grant!.id]);
  assert.deepEqual(await listPortalGrants({ ...principal, memberId: 'other-member' }, f.deps), []);
  assert.deepEqual(await listPortalGrants({ ...principal, workspaceId: 'other-workspace' }, f.deps), []);
  await assert.rejects(managePortal({ ...f.actor, workspaceId: 'other-workspace' }, { action: 'revoke_grant', grantId: grant!.id }, f.deps));
  await f.act({ action: 'revoke_grant', grantId: grant!.id });
  assert.deepEqual(await listPortalGrants(principal, f.deps), []);
  await f.act({ action: 'grant', memberId: member.id, employerUnitId: 'empresa-A', competence: '2026-10', expiresAt: '2026-11-24T12:00:00Z', requestId: randomUUID() });
  f.advance('2026-11-25T12:00:00Z');
  assert.deepEqual(await listPortalGrants(principal, f.deps), []);
  const overview = await listPortalManagement('coala', f.deps);
  assert.equal('password' in overview.members[0], false);
});


test('concurrent activation consumes a single invitation and internal email cannot become a portal identity', async () => {
  const f = fixture();
  const { office, invitation } = await f.prepare();
  const results = await Promise.allSettled([
    activatePortalInvitation(invitation.token, password, f.deps),
    activatePortalInvitation(invitation.token, password + 'outro', f.deps),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  await assert.rejects(managePortal(f.actor, { action: 'invite_member', officeId: office.id, name: 'Conta interna', email: 'interno@example.test', requestId: randomUUID() }, { ...f.deps, internalEmailExists: async () => true }));
});

test('suspended members require explicit reactivation and suspension invalidates invitations', async () => {
  const f = fixture();
  const { member, invitation } = await f.prepare();
  await f.act({ action: 'set_member_active', memberId: member.id, active: false });
  await assert.rejects(f.act({ action: 'reissue_invitation', memberId: member.id, requestId: randomUUID() }));
  assert.equal((await listPortalManagement('coala', f.deps)).members[0].active, false);
  await f.act({ action: 'set_member_active', memberId: member.id, active: true });
  await assert.rejects(activatePortalInvitation(invitation.token, password, f.deps));
  const fresh = await f.act({ action: 'reissue_invitation', memberId: member.id, requestId: randomUUID() });
  assert.equal((await activatePortalInvitation(fresh.invitation!.token, password, f.deps)).id, member.id);
});

test('office suspension invalidates outstanding invitations after the office is reactivated', async () => {
  const f = fixture();
  const { office, member, invitation } = await f.prepare();
  await f.act({ action: 'set_office_active', officeId: office.id, active: false });
  await f.act({ action: 'set_office_active', officeId: office.id, active: true });
  await assert.rejects(activatePortalInvitation(invitation.token, password, f.deps));
  const fresh = await f.act({ action: 'reissue_invitation', memberId: member.id, requestId: randomUUID() });
  assert.equal((await activatePortalInvitation(fresh.invitation!.token, password, f.deps)).id, member.id);
});

test('activation checks expiry after password derivation inside the final transaction', async () => {
  const f = fixture();
  const { member, invitation } = await f.prepare();
  let reads = 0;
  const beforeExpiry = new Date(Date.parse(invitation.expiresAt) - 1000);
  const afterExpiry = new Date(Date.parse(invitation.expiresAt) + 1000);
  await assert.rejects(activatePortalInvitation(invitation.token, password, {
    ...f.deps, now: () => ++reads < 3 ? beforeExpiry : afterExpiry,
  }));
  assert.equal((await listPortalManagement('coala', f.deps)).members[0].status, 'invited');
  assert.equal(f.db.rows.get('providerMembers/' + member.id)?.password, null);
});

test('global admission limits distinct unknown emails and activation before scrypt or per-email writes', async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 35 }, (_, index) => loginPortal('unknown' + index + '@example.test', password, f.deps)));
  const failures = results.map((result) => result.status === 'rejected' ? result.reason as { httpStatus: number } : null);
  assert.equal(failures.filter((failure) => failure?.httpStatus === 401).length, 30);
  assert.equal(failures.filter((failure) => failure?.httpStatus === 429).length, 5);
  assert.equal([...f.db.rows.keys()].filter((key) => key.startsWith('providerPortalLoginAttempts/')).length, 31);
  const { invitation } = await f.prepare();
  await assert.rejects(activatePortalInvitation(invitation.token, password, f.deps), (cause: unknown) => (cause as { httpStatus: number }).httpStatus === 429);
  await revokePortalSession(randomBytes(32).toString('base64url'), f.deps);
  f.advance('2026-11-23T12:01:00Z');
  await assert.rejects(loginPortal('next-window@example.test', password, f.deps), (cause: unknown) => (cause as { httpStatus: number }).httpStatus === 401);
});
