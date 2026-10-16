import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

const PROJECT_ID = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId: PROJECT_ID });
enableServerOnlyTestImports(PROJECT_ID);

const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { belemCivilDate } = await import('../../src/features/dp/absences/requests/core.ts');
const optionsRoute = await import('../../src/app/api/collaborator/absence-requests/options/route.ts');
const previewRoute = await import('../../src/app/api/collaborator/absence-requests/preview/route.ts');
const profileId = 'absence-preview-profile';
const users = [
  { uid: 'absence-preview-alice', email: 'absence-preview-alice@example.test', relationship: 'clt' },
  { uid: 'absence-preview-bob', email: 'absence-preview-bob@example.test', relationship: 'clt' },
  { uid: 'absence-preview-pj', email: 'absence-preview-pj@example.test', relationship: 'pj' },
  { uid: 'absence-preview-denied', email: 'absence-preview-denied@example.test', relationship: 'clt' },
];
const password = 'absence-preview-123';
const context = { params: Promise.resolve({}) };

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

function request(path, idToken, body) {
  return new NextRequest(`http://localhost${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function seed() {
  for (const user of users) {
    await authAdmin.createUser({ uid: user.uid, email: user.email, password });
    await authAdmin.setCustomUserClaims(user.uid, { profileId, sessionVersion: 0 });
  }
  const batch = dbAdmin.batch();
  batch.set(dbAdmin.collection('profiles').doc(profileId), { permissions: { dashboard: { collaborator: true, view: true } } });
  for (const user of users) {
    batch.set(dbAdmin.collection('users').doc(user.uid), {
      username: user.uid, email: user.email, profileId, isActive: true, sessionVersion: 0,
      employmentRelationshipType: user.relationship, unitId: 'absence-preview-unit',
      profileCompliance: { status: 'complete', policyVersion: 1 },
    });
  }
  batch.set(dbAdmin.collection('dp_units').doc('absence-preview-unit'), { name: 'Unidade prévia' });
  const rule = (id, collaboratorIds) => ({
    id, name: id, employmentRelationshipTypes: ['clt'],
    applicability: { scope: { kind: 'company' }, ...(collaboratorIds ? { collaboratorIds } : {}) },
    calculation: 'calendar_days', attachment: 'not_required', approvalFlow: 'dp',
    rejectionReasonRequired: false, allowFutureEdit: false, allowFutureCancel: false,
  });
  for (const [id, policy] of [['absence-preview-public', rule('public', null)], ['absence-preview-restricted', rule('restricted', ['absence-preview-bob'])]]) {
    batch.set(dbAdmin.collection('dp_absenceTypes').doc(id), {
      lineageId: id, version: 1, status: 'published', publishedAt: new Date(), name: id,
      color: 'blue', requestUnits: ['day'], initiatedBy: ['collaborator'],
      validFrom: '1900-01-01', validTo: '9999-12-31', policies: [policy],
    });
  }
  await batch.commit();
}

async function cleanup() {
  await Promise.all([
    ...users.map(({ uid }) => authAdmin.deleteUser(uid).catch(() => undefined)),
    ...users.map(({ uid }) => dbAdmin.collection('users').doc(uid).delete()),
    dbAdmin.collection('profiles').doc(profileId).delete(),
    dbAdmin.collection('dp_units').doc('absence-preview-unit').delete(),
    ...['absence-preview-public', 'absence-preview-restricted'].map((id) => dbAdmin.collection('dp_absenceTypes').doc(id).delete()),
  ]);
}

test('rotas de prévia isolam pessoa, perfil e catálogo sem gravar pedido', async (t) => {
  await seed();
  t.after(cleanup);
  const [alice, bob, pj, denied] = await Promise.all(users.map((user) => token(user.email)));
  const optionsPath = '/api/collaborator/absence-requests/options';
  const previewPath = '/api/collaborator/absence-requests/preview';
  const startDate = belemCivilDate(new Date());
  const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  const body = { absenceTypeId: 'absence-preview-public', startDate, endDate, unit: 'day' };
  assert.equal((await optionsRoute.GET(request(optionsPath), context)).status, 401);
  const options = await optionsRoute.GET(request(optionsPath, alice), context);
  assert.equal(options.status, 200);
  assert.deepEqual((await options.json()).absenceTypes.map((item) => item.id), ['absence-preview-public']);
  const bobOptions = await optionsRoute.GET(request(optionsPath, bob), context);
  assert.deepEqual((await bobOptions.json()).absenceTypes.map((item) => item.id).sort(), ['absence-preview-public', 'absence-preview-restricted']);
  const pjOptions = await optionsRoute.GET(request(optionsPath, pj), context);
  assert.deepEqual((await pjOptions.json()).absenceTypes, []);
  const restricted = await previewRoute.POST(request(previewPath, alice, { ...body, absenceTypeId: 'absence-preview-restricted' }), context);
  assert.equal(restricted.status, 404);
  assert.equal((await restricted.json()).error.code, 'ABSENCE_NOT_AVAILABLE');
  assert.equal((await previewRoute.POST(request(previewPath, alice, { ...body, collaboratorId: users[1].uid }), context)).status, 400);
  const positive = await previewRoute.POST(request(previewPath, alice, body), context);
  assert.equal(positive.status, 200);
  assert.equal((await positive.json()).preview.canSubmit, false);
  assert.equal((await dbAdmin.collection('dp_absenceRequests').limit(1).get()).empty, true);
  assert.equal((await hrDbAdmin.collection('dp_absenceRequests').limit(1).get()).empty, true);
  await dbAdmin.collection('profiles').doc(profileId).update({ 'permissions.dashboard.collaborator': false });
  assert.equal((await optionsRoute.GET(request(optionsPath, denied), context)).status, 403);
});
