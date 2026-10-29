import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { createRequire } from 'node:module';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { PATCH } = await import('../../src/app/api/users/[userId]/route.ts');
const historyRoute = await import('../../src/app/api/users/[userId]/contract-changes/route.ts');
const { operationalCivilDate, appendOperationalPeriod } = await import('../../src/lib/operational-unit-periods.ts');
const { activateContractualChanges } = await import('../../functions/src/contractual-data.ts');
const { reconcileOperationalUnitPeriods } = await import('../../functions/src/operational-unit-periods.ts');
const { advanceAutomaticProbation } = await import('../../functions/src/probation-transition.ts');
const { prepareContractChange } = await import('../../src/lib/contractual-data.server.ts');
// Functions has its own Admin SDK dependency; use its matching FieldValue implementation.
const functionRequire = createRequire(new URL('../../functions/package.json', import.meta.url));
const functionApp = functionRequire('firebase-admin/app').initializeApp({ projectId: 'demo-coala-repository' }, 'periods-functions-test');
const functionDb = functionRequire('firebase-admin/firestore').getFirestore(functionApp, 'coala');
const functionHrDb = functionRequire('firebase-admin/firestore').getFirestore(functionApp, 'coala-rh');

test('editor exige motivo, audita atomicamente, agenda/cancela e preserva a vigência em edição concorrente', { timeout: 120_000 }, async () => {
  const prefix = 'contract-editor-integration';
  const adminId = `${prefix}-admin`;
  const userId = `${prefix}-person`;
  const a = `${prefix}-tirirical`;
  const b = `${prefix}-matriz`;
  const person = dbAdmin.collection('users').doc(userId);
  const profile = dbAdmin.collection('profiles').doc(adminId);
  const admin = dbAdmin.collection('users').doc(adminId);
  const units = [a, b].map((id) => dbAdmin.collection('dp_units').doc(id));
  const today = operationalCivilDate();
  const future = new Date(`${today}T12:00:00Z`); future.setUTCDate(future.getUTCDate() + 1);
  const tomorrow = future.toISOString().slice(0, 10);
  let token;
  const call = (body) => PATCH(new NextRequest(`http://localhost/api/users/${userId}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ userId }) });
  try {
    const email = `${adminId}@example.test`, password = 'synthetic-password-123';
    await authAdmin.createUser({ uid: adminId, email, password });
    await authAdmin.setCustomUserClaims(adminId, { profileId: adminId, sessionVersion: 0 });
    await Promise.all([
      profile.set({ isDefaultAdmin: true, permissions: {} }),
      admin.set({ username: 'Admin sintético', email, profileId: adminId, isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 } }),
      person.set({ username: 'Pessoa sintética', unitId: a, unitIds: [a], isActive: true, employmentRelationshipType: 'clt' }),
      ...units.map((ref) => ref.set({ name: ref.id, address: 'Endereço sintético', cnpj: '14276603000125' })),
    ]);
    const login = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    token = (await login.json()).idToken;
    assert.ok(token);
    assert.equal((await call({ unitId: b })).status, 400);
    assert.equal((await person.get()).get('unitId'), a);
    const changed = await call({ unitId: b, employerUnitId: b, contractChangeReason: 'Correção financeira conferida', contractEffectiveDate: today });
    assert.equal(changed.status, 200, JSON.stringify(await changed.json()));
    assert.equal((await person.get()).get('unitId'), b);
    assert.equal((await person.get()).get('employerUnitName'), b);
    const firstAudit = await person.collection('contractualChanges').get();
    assert.equal(firstAudit.size, 1);
    assert.deepEqual(firstAudit.docs[0].get('changes.unitId'), { before: a, after: b });
    assert.equal(firstAudit.docs[0].get('actorId'), adminId);

    const scheduled = await call({ unitId: a, employerUnitId: a, contractChangeReason: 'Alteração financeira agendada', contractEffectiveDate: tomorrow });
    assert.equal(scheduled.status, 200, JSON.stringify(await scheduled.json()));
    let stored = (await person.get()).data();
    assert.equal(stored.unitId, b);
    assert.equal(stored.employerUnitName, b);
    assert.equal(stored.scheduledContractChange.fields.employerUnitName, a);
    assert.equal(stored.scheduledContractChange.reason, undefined);
    assert.equal(stored.scheduledContractChange.changes, undefined);
    assert.equal(stored.scheduledContractChange.fields.unitId, a);
    assert.equal((await call({ unitId: a, contractChangeReason: 'Outro agendamento rejeitado', contractEffectiveDate: tomorrow })).status, 409);
    const cancel = await call({ cancelContractChangeId: stored.scheduledContractChange.id, contractChangeReason: 'Cancelamento solicitado pelo DP' });
    assert.equal(cancel.status, 200, JSON.stringify(await cancel.json()));
    assert.equal((await person.get()).get('scheduledContractChange'), undefined);
    assert.equal((await person.collection('contractualChanges').doc(stored.scheduledContractChange.id).get()).get('status'), 'cancelled');

    const scheduledAgain = await call({ unitId: a, employerUnitId: a, contractChangeReason: 'Reagendamento confirmado pelo DP', contractEffectiveDate: tomorrow });
    assert.equal(scheduledAgain.status, 200, JSON.stringify(await scheduledAgain.json()));
    await activateContractualChanges(functionDb, functionHrDb, tomorrow);
    assert.equal((await person.get()).get('unitId'), a);
    assert.equal((await person.get()).get('employerUnitName'), a);
    assert.equal((await person.get()).get('scheduledContractChange'), undefined);

    const first = appendOperationalPeriod([], today, [a, b]);
    assert.equal((await call({ operationalUnitPeriods: first })).status, 200);
    const stale = (await person.get()).data();
    const next = appendOperationalPeriod(first, tomorrow, [b]);
    const [append, avatar] = await Promise.all([
      call({ operationalUnitPeriods: next }), call({ ...stale, avatarUrl: 'https://example.test/synthetic-avatar.png' }),
    ]);
    assert.equal(append.status, 200, JSON.stringify(await append.json()));
    assert.ok([200, 400, 409].includes(avatar.status));
    assert.deepEqual((await person.get()).get('operationalUnitPeriods'), next);
    await reconcileOperationalUnitPeriods(functionDb, functionHrDb, tomorrow);
    assert.deepEqual((await person.get()).get('unitIds'), [b]);
    assert.equal((await person.get()).get('unitId'), a);
    const history = await historyRoute.GET(new NextRequest(`http://localhost/api/users/${userId}/contract-changes`, {
      headers: { Authorization: `Bearer ${token}` },
    }), { params: Promise.resolve({ userId }) });
    assert.equal(history.status, 200);
    const historyChanges = (await history.json()).changes;
    assert.ok(historyChanges.some((row) => row.reason === 'Correção financeira conferida'));
    assert.ok(historyChanges.some((row) => row.status === 'cancelled' && row.cancellation?.reason === 'Cancelamento solicitado pelo DP' && row.cancellation?.actorName === 'Admin sintético' && row.cancellation?.createdAt));
    await person.update({ unitId: null });
    assert.equal((await call({ unitId: null, unitIds: [a, b], avatarUrl: 'https://example.test/no-financial-inference.png' })).status, 200);
    assert.equal((await person.get()).get('unitId'), null);
  } finally {
    await Promise.all([dbAdmin.recursiveDelete(person), admin.delete(), profile.delete(), ...units.map((ref) => ref.delete()), authAdmin.deleteUser(adminId).catch(() => {})]);
  }
});

test('conversão automática configurada gera uma única evidência e preserva decisão manual', async () => {
  const userId = 'probation-contract-audit-person';
  const user = dbAdmin.collection('users').doc(userId);
  const process = hrDbAdmin.collection('onboardingProcesses').doc('probation-contract-audit-auto');
  const manual = hrDbAdmin.collection('onboardingProcesses').doc('probation-contract-audit-manual');
  const end = '2026-10-28';
  const id = `probation_${process.id}_${end}`;
  const state = { status: 'active', admissionDate: '2026-07-31', employmentCycleVersion: 0,
    config: { effectivenessRule: 'automatic_at_end' }, schedule: { finalEndDate: end } };
  try {
    await Promise.all([
      user.set({ unitId: 'tirirical', employmentRelationshipType: 'clt', isActive: true, admissionDate: '2026-07-31', employmentCycleVersion: 0 }),
      process.set({ collaboratorUserId: userId, status: 'completed', probationV2: state }),
      manual.set({ collaboratorUserId: userId, status: 'completed', probationV2: { ...state, config: { effectivenessRule: 'manual' } } }),
    ]);
    await advanceAutomaticProbation(functionDb, functionHrDb, '2026-10-29');
    const event = await user.collection('contractualChanges').doc(id).get();
    assert.equal((await process.get()).get('probationV2.status'), 'effective');
    assert.equal(event.get('source'), 'system');
    assert.equal(event.get('effectiveDate'), '2026-10-29');
    assert.equal((await manual.get()).get('probationV2.status'), 'active');
    const createdAt = event.get('createdAt').toMillis();
    await advanceAutomaticProbation(functionDb, functionHrDb, '2026-10-29');
    assert.equal((await user.collection('contractualChanges').doc(id).get()).get('createdAt').toMillis(), createdAt);
    assert.equal((await user.get()).get('unitId'), 'tirirical');
  } finally {
    await Promise.all([dbAdmin.recursiveDelete(user), process.delete(), manual.delete(), hrDbAdmin.collection('audit_log').doc(id).delete()]);
  }
});

test('função agendada retém também o perfil derivado até a data efetiva', () => {
  const patch = { jobFunctionIds: ['new-function'], jobFunctionNames: ['Nova função'], profileId: 'new-profile' };
  const change = prepareContractChange({ jobFunctionIds: ['old-function'], profileId: 'old-profile' }, patch,
    { id: 'synthetic-future-function', reason: 'Mudança de função futura aprovada', effectiveDate: '2026-11-01',
      today: '2026-10-28', actorId: 'synthetic-admin', actorName: 'Admin sintético' });
  assert.equal(change.fields.profileId, 'new-profile');
  assert.equal(patch.profileId, undefined);
  assert.equal(patch.jobFunctionIds, undefined);
});

test('experiência bloqueia desligamento/recontratação e mantém evento linearizado sem reativar conta', async () => {
  const refs = [];
  const people = [];
  const end = '2026-10-28';
  async function fixture(suffix, extra = {}) {
    const id = `probation-guard-${suffix}`;
    const user = dbAdmin.collection('users').doc(id);
    const process = hrDbAdmin.collection('onboardingProcesses').doc(id);
    await user.set({ isActive: true, admissionDate: '2026-07-31', employmentCycleVersion: 0, ...extra });
    await process.set({ collaboratorUserId: id, status: 'completed', probationV2: { status: 'active', admissionDate: '2026-07-31',
      employmentCycleVersion: 0, config: { effectivenessRule: 'automatic_at_end' }, schedule: { finalEndDate: end } } });
    refs.push(process, hrDbAdmin.collection('audit_log').doc(`probation_${id}_${end}`)); people.push(user);
    return { user, process, event: user.collection('contractualChanges').doc(`probation_${id}_${end}`) };
  }
  try {
    const stopped = await fixture('terminated', { isActive: false, employmentStatus: 'terminated', terminationDate: '2026-10-27' });
    const rehired = await fixture('rehired', { employmentCycleVersion: 2 });
    const futureEnd = await fixture('future-end', { terminationProcessId: 'synthetic-future-termination', terminationDate: '2026-11-10' });
    await advanceAutomaticProbation(functionDb, functionHrDb, '2026-10-29');
    assert.equal((await stopped.event.get()).exists, false);
    assert.equal((await stopped.process.get()).get('probationV2.status'), 'active');
    assert.equal((await rehired.event.get()).exists, false);
    assert.equal((await futureEnd.event.get()).exists, true);
    const race = await fixture('race');
    const { FieldValue } = await import('firebase-admin/firestore');
    await Promise.all([
      advanceAutomaticProbation(functionDb, functionHrDb, '2026-10-29'),
      race.user.update({ isActive: false, employmentStatus: 'terminated', employmentCycleVersion: 1,
        terminationDate: '2026-10-28', terminationRecordedAt: FieldValue.serverTimestamp() }),
    ]);
    assert.equal((await race.user.get()).get('isActive'), false);
    const racedEvent = await race.event.get();
    if (racedEvent.exists) assert.ok(racedEvent.get('createdAt').toMillis() <= (await race.user.get()).get('terminationRecordedAt').toMillis());
    await advanceAutomaticProbation(functionDb, functionHrDb, '2026-10-29');
    assert.equal((await race.user.get()).get('isActive'), false);
    const failure = await fixture('projection-failure');
    let failOnce = true;
    const failingHrDb = new Proxy(functionHrDb, { get(target, key) {
      if (key === 'runTransaction' && failOnce) return async () => { failOnce = false; throw new Error('synthetic RH projection failure'); };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(advanceAutomaticProbation(functionDb, failingHrDb, '2026-10-29'));
    const committed = await failure.event.get();
    assert.equal(committed.exists, true);
    assert.equal((await failure.user.get()).get('probationProjectionPending'), true);
    await advanceAutomaticProbation(functionDb, functionHrDb, '2026-10-29');
    assert.equal((await failure.event.get()).get('createdAt').toMillis(), committed.get('createdAt').toMillis());
    assert.equal((await failure.process.get()).get('probationV2.status'), 'effective');
  } finally { await Promise.all([...people.map((ref) => dbAdmin.recursiveDelete(ref)), ...refs.map((ref) => ref.delete())]); }
});

test('trilha contratual bloqueia acesso direto sem permissão ou fora das unidades', async () => {
  const targetId = 'contract-history-private-target';
  const target = dbAdmin.collection('users').doc(targetId);
  const refs = [target];
  const actors = [];
  const read = (token) => historyRoute.GET(new NextRequest(`http://localhost/api/users/${targetId}/contract-changes`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }), { params: Promise.resolve({ userId: targetId }) });
  try {
    await target.set({ username: 'Pessoa reservada', unitIds: ['private-unit'], isActive: true });
    assert.equal((await read()).status, 401);
    for (const manageUsers of [false, true]) {
      const uid = `contract-history-${manageUsers ? 'outside' : 'unprivileged'}`;
      const email = `${uid}@example.test`, password = 'synthetic-password-123';
      await authAdmin.createUser({ uid, email, password }); actors.push(uid);
      await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
      const profile = dbAdmin.collection('profiles').doc(uid), person = dbAdmin.collection('users').doc(uid);
      refs.push(profile, person);
      await Promise.all([
        profile.set({ isDefaultAdmin: false, permissions: { settings: { manageUsers } } }),
        person.set({ username: 'Ator sintético', email, profileId: uid, isActive: true, sessionVersion: 0,
          unitAccessScope: 'selected', unitAccessUnitIds: ['other-unit'],
          profileCompliance: { status: 'complete', policyVersion: 1 } }),
      ]);
      const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
      });
      const token = (await response.json()).idToken;
      assert.ok(token);
      assert.equal((await read(token)).status, 403);
    }
  } finally {
    await Promise.all([...refs.map((ref) => ref.delete()), ...actors.map((uid) => authAdmin.deleteUser(uid))]);
  }
});
