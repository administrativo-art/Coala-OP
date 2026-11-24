import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import test from 'node:test';
function request(url, options) {
  const value = new Request(url, options);
  value.headers.set('host', new URL(url).host);
  return Object.assign(value, { nextUrl: new URL(url) });
}
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { managePortal, listPortalGrants } = await import('../../src/features/service-portal/management.server.ts');
const { activatePortalInvitation, loginPortal, authenticatePortalSession, revokePortalSession } = await import('../../src/features/service-portal/auth.server.ts');
const { assertPortalOrigin } = await import('../../src/features/service-portal/route-security.server.ts');
const { requireUser } = await import('../../src/lib/auth-server.ts');

test('portal individual mantém convites, sessão e grants isolados do diretório interno', async () => {
  const workspaceId = 'portal-' + randomUUID();
  const actor = { uid: 'manager', workspaceId };
  const email = workspaceId + '@example.test';
  const deps = { db: dbAdmin, now: () => new Date('2026-11-23T12:00:00Z'),
    randomId: randomUUID, randomToken: () => randomBytes(32).toString('base64url'), internalEmailExists: async () => false };
  const createOfficeRequest = { action: 'create_office', name: 'Contabilidade de teste', requestId: randomUUID() };
  const offices = await Promise.all([managePortal(actor, createOfficeRequest, deps), managePortal(actor, createOfficeRequest, deps)]);
  assert.equal(offices[0].office.id, offices[1].office.id);
  const officeId = offices[0].office.id;
  const invited = await managePortal(actor, { action: 'invite_member', officeId, name: 'Profissional teste', email, requestId: randomUUID() }, deps);
  const memberId = invited.member.id;
  const password = 'senha-local-de-teste-' + randomUUID();
  await activatePortalInvitation(invited.invitation.token, password, deps);
  await assert.rejects(activatePortalInvitation(invited.invitation.token, password, deps));
  const session = await loginPortal(email, password, deps);
  assert.equal((await authenticatePortalSession(session.token, deps)).memberId, memberId);
  assert.equal((await dbAdmin.collection('users').doc(memberId).get()).exists, false);
  assert.equal((await hrDbAdmin.collection('employees').doc(memberId).get()).exists, false);
  await assert.rejects(requireUser(request('http://localhost/api/client/bootstrap', { headers: { cookie: 'coala-provider=' + session.token } })));
  const grant = await managePortal(actor, { action: 'grant', memberId, employerUnitId: 'employer-A', competence: '2026-10',
    expiresAt: '2026-12-23T12:00:00Z', requestId: randomUUID() }, deps);
  assert.equal((await listPortalGrants(session.principal, deps)).length, 1);
  assert.deepEqual(await listPortalGrants({ ...session.principal, workspaceId: 'other' }, deps), []);
  assert.deepEqual(await listPortalGrants({ ...session.principal, memberId: 'another-person' }, deps), []);
  await managePortal(actor, { action: 'revoke_grant', grantId: grant.grant.id }, deps);
  assert.deepEqual(await listPortalGrants(session.principal, deps), []);
  await managePortal(actor, { action: 'set_office_active', officeId, active: false }, deps);
  await assert.rejects(authenticatePortalSession(session.token, deps));
  await managePortal(actor, { action: 'set_office_active', officeId, active: true }, deps);
  await assert.rejects(authenticatePortalSession(session.token, deps));
  const next = await loginPortal(email, password, deps);
  await assert.rejects(authenticatePortalSession(next.token, { ...deps, now: () => new Date('2026-11-24T12:00:00Z') }));
  await revokePortalSession(next.token, deps);
  await assert.rejects(authenticatePortalSession(next.token, deps));
  const pending = await managePortal(actor, { action: 'reissue_invitation', memberId, requestId: randomUUID() }, deps);
  await managePortal(actor, { action: 'set_member_active', memberId, active: false }, deps);
  await assert.rejects(managePortal(actor, { action: 'reissue_invitation', memberId, requestId: randomUUID() }, deps));
  await managePortal(actor, { action: 'set_member_active', memberId, active: true }, deps);
  await assert.rejects(activatePortalInvitation(pending.invitation.token, password, deps));
  await assert.rejects(managePortal({ ...actor, workspaceId: 'other' }, { action: 'set_member_active', memberId, active: false }, deps));
  const audit = await dbAdmin.collection('providerPortalAudit').where('workspaceId', '==', workspaceId).limit(100).get();
  assert.ok(audit.size >= 8);
  assert.doesNotMatch(JSON.stringify(audit.docs.map((doc) => doc.data())), new RegExp(session.token));
});

test('mutações do portal exigem a origem da própria página', () => {
  assert.doesNotThrow(() => assertPortalOrigin(request('https://portal.example.test/api/service-portal/login', { method: 'POST', headers: { origin: 'https://portal.example.test' } })));
  assert.throws(() => assertPortalOrigin(request('https://portal.example.test/api/service-portal/login', { method: 'POST', headers: { origin: 'https://other.example.test' } })));
});

test('credenciais e controles do portal permanecem privados mesmo para cliente administrador', async () => {
  const { readFile } = await import('node:fs/promises');
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const { doc, getDoc, setDoc } = await import('firebase/firestore');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-coala-repository',
    firestore: { host, port: Number(port), rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/portal-rule-admin'), { isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 } });
    });
    const client = env.authenticatedContext('portal-rule-admin', { isDefaultAdmin: true, sessionVersion: 0 }).firestore();
    await assertSucceeds(getDoc(doc(client, 'users/portal-rule-admin')));
    for (const collection of ['providerOffices', 'providerMembers', 'providerPortalGrants', 'providerPortalInvitations',
      'providerPortalSessions', 'providerPortalEmailLookups', 'providerPortalOperations', 'providerPortalAudit', 'providerPortalLoginAttempts']) {
      await assertFails(getDoc(doc(client, collection + '/private-test')));
      await assertFails(setDoc(doc(client, collection + '/private-test'), { name: 'Tentativa indevida' }));
    }
  } finally { await env.cleanup(); }
});
