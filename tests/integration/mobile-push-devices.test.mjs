import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

const projectId = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId });
enableServerOnlyTestImports(projectId);
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const route = await import('../../src/app/api/mobile/push/devices/route.ts');
const { sendUserPush } = await import('../../src/features/mobile/push/send.server.ts');
const context = { params: Promise.resolve({}) };
const path = '/api/mobile/push/devices';
const password = 'push-test-password-123';
const people = [
  { uid: 'push-test-alice', email: 'push-test-alice@example.test' },
  { uid: 'push-test-bob', email: 'push-test-bob@example.test' },
];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const installationA = 'a41f6e6d-7560-4f22-a388-b456683a3ba9';
const installationB = 'b41f6e6d-7560-4f22-a388-b456683a3ba9';
const first = 'a'.repeat(128);
const rotated = 'b'.repeat(128);
const second = 'c'.repeat(128);
const body = (installationId, token) => ({ installationId, token, packageName: 'coalaone.go', permissionGranted: true, appVersion: '0.4.0' });

async function token(email) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.ok(host && /^(127\.0\.0\.1|localhost):\d+$/.test(host));
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return (await response.json()).idToken;
}
function request(method, idToken, payload) {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
async function seed() {
  for (const person of people) {
    await authAdmin.createUser({ ...person, password });
    await dbAdmin.collection('users').doc(person.uid).set({ username: person.uid, email: person.email, isActive: true, sessionVersion: 0,
      profileCompliance: { status: 'complete', policyVersion: 1 } });
  }
}
async function cleanup() {
  await Promise.all(people.map(({ uid }) => authAdmin.deleteUser(uid).catch(() => undefined)));
  const [tokens, installations, logs] = await Promise.all([
    dbAdmin.collection('mobilePushTokens').where('ownerUid', 'in', people.map((person) => person.uid)).get(),
    dbAdmin.collection('mobilePushInstallations').where('ownerUid', 'in', people.map((person) => person.uid)).get(),
    dbAdmin.collection('actionLogs').where('module', '==', 'mobile.push').get(),
  ]);
  const batch = dbAdmin.batch();
  people.forEach(({ uid }) => batch.delete(dbAdmin.collection('users').doc(uid)));
  tokens.docs.forEach((doc) => batch.delete(doc.ref));
  installations.docs.forEach((doc) => batch.delete(doc.ref));
  logs.docs.filter((doc) => people.some(({ uid }) => doc.get('user_id') === uid)).forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

test('push isola proprietário, rotação e envio interno sem usar FCM real', async (t) => {
  await seed(); t.after(cleanup);
  const [alice, bob] = await Promise.all(people.map((person) => token(person.email)));
  assert.equal((await route.POST(request('POST', null, body(installationA, first)), context)).status, 401);
  assert.equal((await route.POST(request('POST', alice, { ...body(installationA, first), ownerUid: people[1].uid }), context)).status, 400);
  assert.equal((await route.POST(request('POST', alice, body(installationA, first)), context)).status, 200);
  const firstDoc = await dbAdmin.collection('mobilePushTokens').doc(sha(first)).get();
  assert.equal(firstDoc.get('ownerUid'), people[0].uid);
  assert.equal((await route.POST(request('POST', alice, body(installationA, rotated)), context)).status, 200);
  assert.equal((await dbAdmin.collection('mobilePushTokens').doc(sha(first)).get()).get('active'), false);
  assert.equal((await route.POST(request('POST', bob, body(installationB, rotated)), context)).status, 200);
  assert.equal((await dbAdmin.collection('mobilePushTokens').doc(sha(rotated)).get()).get('ownerUid'), people[1].uid);
  assert.equal((await dbAdmin.collection('mobilePushInstallations').doc(sha(installationA)).get()).get('active'), false);
  assert.equal((await route.DELETE(request('DELETE', alice, { installationId: installationB }), context)).status, 404);
  const before = await dbAdmin.collection('actionLogs').where('module', '==', 'mobile.push').get();
  assert.equal((await route.POST(request('POST', bob, body(installationB, rotated)), context)).status, 200);
  const after = await dbAdmin.collection('actionLogs').where('module', '==', 'mobile.push').get();
  assert.equal(after.size, before.size);
  assert.equal((await route.POST(request('POST', bob, body(installationA, second)), context)).status, 200);
  const eventId = '1e7be83a-3537-4d86-8814-61240bb472ce';
  const localDefault = await sendUserPush({ workspaceId: 'coala', recipientUid: people[1].uid,
    eventId, path: '/dashboard/collaborator/requests' });
  assert.equal(localDefault.deferred, true);
  assert.equal(localDefault.attempted, 0);
  let called = 0;
  const fake = { async send(tokens, data) {
    called++;
    assert.deepEqual(tokens.sort(), [rotated, second].sort());
    assert.equal(data.title, 'Coala Go');
    assert.equal(data.body, 'Você tem uma atualização no Coala.');
    assert.equal(data.recipientId, people[1].uid);
    return { responses: [{ success: true }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }] };
  } };
  const result = await sendUserPush({ workspaceId: 'coala', recipientUid: people[1].uid, eventId, path: '/dashboard/collaborator/requests' }, fake);
  assert.equal(called, 1);
  assert.equal(result.acceptedByProvider, 1);
  assert.equal(result.failed, 1);
  const remaining = await dbAdmin.collection('mobilePushTokens').where('ownerUid', '==', people[1].uid).where('active', '==', true).get();
  assert.equal(remaining.size, 1);
  const logs = await dbAdmin.collection('actionLogs').where('module', '==', 'mobile.push').get();
  assert.equal(JSON.stringify(logs.docs.map((doc) => doc.data())).includes(rotated), false);
  assert.equal(JSON.stringify(logs.docs.map((doc) => doc.data())).includes(second), false);
  await dbAdmin.collection('users').doc(people[1].uid).update({ isActive: false });
  assert.equal((await sendUserPush({ workspaceId: 'coala', recipientUid: people[1].uid, eventId, path: '/dashboard' }, fake)).inactive, true);
  assert.equal(called, 1);
});
