import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const usersRoute = await import('../../src/app/api/users/route.ts');
const onboardingRoute = await import('../../src/app/api/hr/onboarding/route.ts');

const PASSWORD = 'synthetic-password-123';
const COMPLETE = { status: 'complete', policyVersion: 1 };

async function signIn(email) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const token = (await response.json()).idToken;
  assert.ok(token);
  return token;
}

/** Cria um ator sintético com o perfil informado e devolve o token do emulador. */
async function actor(cleanup, uid, { isDefaultAdmin = false, permissions = {}, user = {} } = {}) {
  const email = `${uid}@example.test`;
  await authAdmin.createUser({ uid, email, password: PASSWORD });
  cleanup.uids.push(uid);
  await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
  const profile = dbAdmin.collection('profiles').doc(uid);
  const person = dbAdmin.collection('users').doc(uid);
  cleanup.refs.push(profile, person);
  await Promise.all([
    profile.set({ isDefaultAdmin, permissions }),
    person.set({ username: `Ator ${uid}`, email, profileId: uid, isActive: true, sessionVersion: 0, profileCompliance: COMPLETE, ...user }),
  ]);
  return signIn(email);
}

async function errorMessage(response) {
  const payload = await response.json();
  return payload?.error?.message ?? payload?.error;
}

test('POST /api/users: secureRoute nega sem login, sem permissão, fora do escopo e perfil admin; cria com permissão', { timeout: 120_000 }, async () => {
  const cleanup = { uids: [], refs: [] };
  const targetEmail = 'secure-users-target@example.test';
  const adminProfile = dbAdmin.collection('profiles').doc('secure-users-admin-profile');
  const basicProfile = dbAdmin.collection('profiles').doc('secure-users-basic-profile');
  cleanup.refs.push(adminProfile, basicProfile);
  const call = (token, body) => usersRoute.POST(new NextRequest('http://localhost/api/users', {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const body = (profileId, userData = {}) => ({
    email: targetEmail, username: 'Pessoa sintética', profileId,
    userData: { employmentRelationshipType: 'clt', ...userData },
  });
  const targetExists = () => authAdmin.getUserByEmail(targetEmail).then(() => true, () => false);
  try {
    await Promise.all([
      adminProfile.set({ isDefaultAdmin: true, permissions: {} }),
      basicProfile.set({ isDefaultAdmin: false, permissions: {} }),
    ]);
    const unprivileged = await actor(cleanup, 'secure-users-unprivileged');
    const manager = await actor(cleanup, 'secure-users-manager', {
      permissions: { settings: { manageUsers: true } },
      user: { unitAccessScope: 'selected', unitAccessUnitIds: ['secure-users-own-unit'], unitIds: ['secure-users-own-unit'], unitId: 'secure-users-own-unit' },
    });
    const admin = await actor(cleanup, 'secure-users-default-admin', { isDefaultAdmin: true });

    assert.equal((await call(null, body(basicProfile.id))).status, 401);
    const forbidden = await call(unprivileged, body(basicProfile.id));
    assert.equal(forbidden.status, 403);
    assert.equal(await errorMessage(forbidden), 'Sem permissão para criar usuários.');
    assert.equal((await call(manager, body(basicProfile.id, { unitIds: ['secure-users-other-unit'] }))).status, 403);
    assert.equal((await call(manager, body(adminProfile.id))).status, 403);
    const invalid = await call(admin, { email: 'sem-arroba', username: 'Pe', profileId: basicProfile.id, userData: {} });
    assert.equal(invalid.status, 400);
    assert.equal(await errorMessage(invalid), 'Informe nome, e-mail e perfil válidos.');
    assert.equal(await targetExists(), false, 'nenhuma tentativa negada pode criar a conta');

    const created = await call(admin, body(basicProfile.id));
    assert.equal(created.status, 200, JSON.stringify(await created.clone().json()));
    const { uid } = await created.json();
    cleanup.uids.push(uid);
    cleanup.refs.push(dbAdmin.collection('users').doc(uid), hrDbAdmin.collection('employees').doc(uid), hrDbAdmin.collection('employeeDocumentFolderProfiles').doc(uid));
    const stored = await dbAdmin.collection('users').doc(uid).get();
    assert.equal(stored.get('email'), targetEmail);
    assert.equal(stored.get('profileId'), basicProfile.id);
    assert.equal(stored.get('createdBy'), 'secure-users-default-admin');

    const duplicate = await call(admin, body(basicProfile.id));
    assert.equal(duplicate.status, 409);
    assert.equal(await errorMessage(duplicate), 'Já existe um usuário com este e-mail.');
  } finally {
    await Promise.all([...cleanup.refs.map((ref) => ref.delete()), ...cleanup.uids.map((uid) => authAdmin.deleteUser(uid).catch(() => {}))]);
  }
});

test('/api/hr/onboarding: secureRoute exige permissão de formalização em GET e POST sem gravar processo', { timeout: 120_000 }, async () => {
  const cleanup = { uids: [], refs: [] };
  const list = (token) => onboardingRoute.GET(new NextRequest('http://localhost/api/hr/onboarding', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }));
  const create = (token, body) => onboardingRoute.POST(new NextRequest('http://localhost/api/hr/onboarding', {
    method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const countProcesses = async () => (await hrDbAdmin.collection('onboardingProcesses').count().get()).data().count;
  try {
    const unprivileged = await actor(cleanup, 'secure-onboarding-unprivileged');
    const viewer = await actor(cleanup, 'secure-onboarding-viewer', { permissions: { hr: { formalization: { view: true } } } });
    const before = await countProcesses();

    assert.equal((await list(null)).status, 403);
    const forbiddenList = await list(unprivileged);
    assert.equal(forbiddenList.status, 403);
    assert.equal(await errorMessage(forbiddenList), 'Sem permissão para acessar onboarding.');
    const allowed = await list(viewer);
    assert.equal(allowed.status, 200);
    const payload = await allowed.json();
    assert.ok(Array.isArray(payload.processes));
    assert.ok(payload.pageInfo.active);

    const forbiddenCreate = await create(unprivileged, { candidateName: 'Pessoa', candidateEmail: 'pessoa@example.test' });
    assert.equal(forbiddenCreate.status, 403);
    assert.equal(await errorMessage(forbiddenCreate), 'Sem permissão para iniciar onboarding.');
    const invalidCreate = await create(viewer, { candidateEmail: 'pessoa@example.test' });
    assert.equal(invalidCreate.status, 400);
    assert.equal(await errorMessage(invalidCreate), 'Informe o nome da pessoa em integração.');
    assert.equal(await countProcesses(), before, 'tentativas negadas ou inválidas não gravam processo');
  } finally {
    await Promise.all([...cleanup.refs.map((ref) => ref.delete()), ...cleanup.uids.map((uid) => authAdmin.deleteUser(uid).catch(() => {}))]);
  }
});
