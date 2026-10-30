import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';

import { migrateCurrentUserToGoogleWorkspace } from '@/features/auth/google-workspace-migration.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { authAdmin, dbAdmin } from '@/lib/firebase-admin';

type Row = Record<string, unknown>;
class Snapshot {
  constructor(readonly id: string, private readonly row?: Row) {}
  get exists() { return Boolean(this.row); }
  get(field: string) { return this.row?.[field]; }
}
class Ref { constructor(readonly db: MemoryDb, readonly path: string) {} get id() { return this.path.split('/').at(-1)!; } }
class Collection { constructor(private readonly db: MemoryDb, private readonly name: string) {} doc(id: string) { return new Ref(this.db, `${this.name}/${id}`); } }
class MemoryDb {
  rows = new Map<string, Row>();
  transactionCalls = 0;
  failFinalOnce = false;
  collection(name: string) { return new Collection(this, name); }
  async runTransaction<T>(callback: (tx: { get: (ref: Ref) => Promise<Snapshot>; update: (ref: Ref, value: Row) => void;
    set: (ref: Ref, value: Row, options?: { merge?: boolean }) => void }) => Promise<T>) {
    this.transactionCalls += 1;
    if (this.failFinalOnce && this.transactionCalls === 2) { this.failFinalOnce = false; throw new Error('finalization unavailable'); }
    const staged = new Map(this.rows);
    const result = await callback({
      get: async (ref) => new Snapshot(ref.id, staged.get(ref.path)),
      update: (ref, value) => staged.set(ref.path, { ...(staged.get(ref.path) ?? {}), ...value }),
      set: (ref, value, options) => staged.set(ref.path, options?.merge ? { ...(staged.get(ref.path) ?? {}), ...value } : value),
    });
    this.rows = staged;
    return result;
  }
}

class MemoryAuth {
  user = { uid: 'employee-a', email: 'old@example.com', providerData: [] as Array<Record<string, unknown>> };
  emailOwner: { uid: string } | null = null;
  providerOwner: { uid: string } | null = null;
  updates = 0;
  revoked = 0;
  async getUser() { return this.user; }
  async getUserByEmail() { if (this.emailOwner) return this.emailOwner; throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' }); }
  async getUsers() { return { users: this.providerOwner ? [this.providerOwner] : [] }; }
  async updateUser(uid: string, update: Record<string, any>) {
    this.updates += 1;
    this.user = { ...this.user, uid, email: update.email,
      providerData: update.providerToLink ? [{ providerId: 'google.com', uid: update.providerToLink.uid, email: update.email }] : this.user.providerData };
    return this.user;
  }
  async revokeRefreshTokens() { this.revoked += 1; }
}

const token = 'x'.repeat(120);
const baseDecoded = { uid: 'employee-a', auth_time: Math.floor(Date.now() / 1000) };
const context = (corporateGoogleEmail?: string) => ({ workspace_id: 'workspace-a', decoded: baseDecoded,
  userDoc: { id: 'employee-a', isActive: true, corporateGoogleEmail } } as unknown as ServerUserContext);

function dependencies(db: MemoryDb, auth: MemoryAuth, payload: Record<string, unknown>) {
  return { db: db as unknown as typeof dbAdmin, auth: auth as unknown as typeof authAdmin,
    verifyToken: async () => payload, now: () => Timestamp.fromDate(new Date('2026-10-30T12:00:00Z')) };
}

test('Google pessoal exige sessão recente', async () => {
  process.env.GOOGLE_AUTH_WEB_CLIENT_ID = 'client-id';
  const stale = { ...context(), decoded: { uid: 'employee-a', auth_time: 1 } } as ServerUserContext;
  await assert.rejects(migrateCurrentUserToGoogleWorkspace(stale, { googleIdToken: token },
    dependencies(new MemoryDb(), new MemoryAuth(), { sub: 'google-a', email: 'person@gmail.com', email_verified: true })));
});

test('Workspace obrigatório recusa e-mail ou hosted domain divergente', async () => {
  process.env.GOOGLE_AUTH_WEB_CLIENT_ID = 'client-id';
  await assert.rejects(migrateCurrentUserToGoogleWorkspace(context('heucilene@coalashakes.com'), { googleIdToken: token },
    dependencies(new MemoryDb(), new MemoryAuth(), { sub: 'google-a', email: 'other@gmail.com', email_verified: true })));
  await assert.rejects(migrateCurrentUserToGoogleWorkspace(context('heucilene@coalashakes.com'), { googleIdToken: token },
    dependencies(new MemoryDb(), new MemoryAuth(), { sub: 'google-a', email: 'heucilene@coalashakes.com', email_verified: true, hd: 'other.com' })));
});

test('preserva UID, impede conflitos e retoma falha entre Auth e finalização', async () => {
  process.env.GOOGLE_AUTH_WEB_CLIENT_ID = 'client-id';
  const db = new MemoryDb(); db.rows.set('users/employee-a', { isActive: true, corporateGoogleEmail: 'heucilene@coalashakes.com' }); db.failFinalOnce = true;
  const auth = new MemoryAuth();
  const deps = dependencies(db, auth, { sub: 'google-a', email: 'heucilene@coalashakes.com', email_verified: true,
    hd: 'coalashakes.com', iat: 123 });
  await assert.rejects(migrateCurrentUserToGoogleWorkspace(context('heucilene@coalashakes.com'), { googleIdToken: token }, deps));
  assert.equal(auth.user.uid, 'employee-a');
  assert.equal(auth.updates, 1);
  const result = await migrateCurrentUserToGoogleWorkspace(context('heucilene@coalashakes.com'), { googleIdToken: token }, deps);
  assert.equal(result.uid, 'employee-a');
  assert.equal(auth.updates, 1);
  assert.equal(auth.revoked, 1);
  assert.equal(db.rows.get('users/employee-a')?.googleWorkspaceMigrationStatus, 'linked');
  const linkedContext = { ...context('heucilene@coalashakes.com'), userDoc: { ...context('heucilene@coalashakes.com').userDoc,
    googleWorkspaceMigrationStatus: 'linked' } } as ServerUserContext;
  const idempotent = await migrateCurrentUserToGoogleWorkspace(linkedContext, { googleIdToken: token }, deps);
  assert.equal(idempotent.uid, 'employee-a');
  assert.equal(auth.updates, 1);

  const conflicting = new MemoryAuth(); conflicting.emailOwner = { uid: 'someone-else' };
  await assert.rejects(migrateCurrentUserToGoogleWorkspace(context('heucilene@coalashakes.com'), { googleIdToken: token },
    dependencies(db, conflicting, { sub: 'google-b', email: 'heucilene@coalashakes.com', email_verified: true, hd: 'coalashakes.com' })));
  const providerConflict = new MemoryAuth(); providerConflict.providerOwner = { uid: 'someone-else' };
  await assert.rejects(migrateCurrentUserToGoogleWorkspace(context('heucilene@coalashakes.com'), { googleIdToken: token },
    dependencies(db, providerConflict, { sub: 'google-b', email: 'heucilene@coalashakes.com', email_verified: true, hd: 'coalashakes.com' })));
});
