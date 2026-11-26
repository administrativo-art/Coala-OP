import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { collectPersonSource } = await import('../../src/features/privacy/person-inventory.server.ts');
const route = await import('../../src/app/api/dp/time/overtime-policies/[id]/route.ts');
const { LEGAL_TOLERANCE_DEFAULTS, LEGAL_INTRAJORNADA_DEFAULT } = await import('../../src/features/dp/time-config/policy-rules.ts');
const { policyDayRulesFor } = await import('../../src/features/dp/time-config/policy-tolerance.server.ts');

async function withPolicyDisabled(run) {
  const saved = process.env.DP_TIME_POLICY_RULES_ENABLED;
  delete process.env.DP_TIME_POLICY_RULES_ENABLED;
  try { await run(); } finally { if (saved === undefined) delete process.env.DP_TIME_POLICY_RULES_ENABLED; else process.env.DP_TIME_POLICY_RULES_ENABLED = saved; }
}

test('overtime API refuses activating new rules, preserves drafts and still publishes a legacy policy', async (t) => withPolicyDisabled(async () => {
  const uid = 'point-rollout-api-admin', email = `${uid}@example.test`, password = 'synthetic-only-123';
  await authAdmin.createUser({ uid, email, password });
  await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
  const user = dbAdmin.collection('users').doc(uid), profile = dbAdmin.collection('profiles').doc(uid), refs = [];
  t.after(async () => { await Promise.all([user, profile, ...refs].map(ref => ref.delete())); await authAdmin.deleteUser(uid); const logs = await dbAdmin.collection('actionLogs').where('metadata.config_id', 'in', refs.map(ref => ref.id)).get(); await Promise.all(logs.docs.map(doc => doc.ref.delete())); });
  await user.set({ username: 'Synthetic admin', workspaceId: 'coala', email, profileId: uid, isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 } });
  await profile.set({ isDefaultAdmin: true, permissions: structuredClone(defaultAdminPermissions) });
  const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const token = (await signIn.json()).idToken; assert.ok(token);
  const publish = ref => route.PATCH(new NextRequest(`http://localhost/api/dp/time/overtime-policies/${ref.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish' }) }), { params: Promise.resolve({ id: ref.id }) });
  const base = { name: 'Synthetic policy', applicability: { scope: { kind: 'company' } }, categories: [{ id: 'he1', name: 'HE1', trigger: 'workday', ratePercent: 50, destination: 'payroll', requiresApproval: false }], timeBank: { enabled: true, allowNegativeBalance: true, expiredBalanceDestination: 'review' }, externalCoverageRule: 'origin', status: 'draft', version: 1, updatedAt: new Date() };
  for (const [i, fields] of [{ tolerances: LEGAL_TOLERANCE_DEFAULTS }, { tolerances: LEGAL_TOLERANCE_DEFAULTS, intrajornada: LEGAL_INTRAJORNADA_DEFAULT }].entries()) {
    const ref = dbAdmin.collection('dp_overtimePolicies').doc(`point-rollout-blocked-${i}`); refs.push(ref);
    await ref.set({ ...base, ...fields, validFrom: `${2090 + i}-01-01`, validTo: `${2090 + i}-12-31` });
    const response = await publish(ref), body = await response.json();
    assert.equal(response.status, 409, JSON.stringify(body)); assert.equal(body.error.code, 'DP_TIME_POLICY_RULES_PENDING');
    assert.equal((await ref.get()).get('status'), 'draft'); assert.equal((await ref.get()).get('publishedAt'), undefined);
  }
  const legacy = dbAdmin.collection('dp_overtimePolicies').doc('point-rollout-legacy'); refs.push(legacy);
  await legacy.set({ ...base, validFrom: '2080-01-01', validTo: '2080-12-31' });
  const allowed = await publish(legacy); assert.equal(allowed.status, 200, JSON.stringify(await allowed.json()));
  assert.equal((await legacy.get()).get('status'), 'published');
  for (const status of ['published', 'archived']) {
    const stored = dbAdmin.collection('dp_overtimePolicies').doc(`point-rollout-existing-${status}`); refs.push(stored);
    await stored.set({ ...base, status, tolerances: LEGAL_TOLERANCE_DEFAULTS, intrajornada: LEGAL_INTRAJORNADA_DEFAULT, validFrom: '2070-01-01' });
  }
  const before = await Promise.all(refs.map(async ref => [ref.id, (await ref.get()).data()]));
  const read = await policyDayRulesFor(dbAdmin, uid);
  assert.equal(read('2070-04-01'), null, 'existing published or archived rules do not activate through the preview');
  assert.deepEqual(await Promise.all(refs.map(async ref => [ref.id, (await ref.get()).data()])), before, 'inactive read does not rewrite source policies');
}));

test('DP personal inventory separates subject, operator and responsible and enforces native global permissions', async (t) => {
  const uid = 'point-inventory-subject', operator = 'point-inventory-operator'; const refs = [];
  const put = async (collection, id, data) => { const ref = dbAdmin.collection(collection).doc(id); refs.push(ref); await ref.set(data); return ref; };
  t.after(async () => { await Promise.all(refs.map(ref => ref.delete())); });
  await put('users', uid, { workspaceId: 'coala', unitIds: ['point-unit'] });
  await put('users', operator, { workspaceId: 'coala', unitIds: ['point-unit'] });
  await put('dp_overtimePolicies', 'point-inventory-policy', { workspaceId: 'coala', createdBy: operator, updatedBy: operator, publishedBy: operator, archivedBy: operator, applicability: { collaboratorIds: [uid] } });
  await put('dp_overtimePolicies', 'point-inventory-almost', { workspaceId: 'coala', applicability: { collaboratorIds: [uid + '-other'] } });
  await put('dp_overtimePolicies', 'point-inventory-foreign', { workspaceId: 'other', createdBy: operator, applicability: { collaboratorIds: [uid] } });
  const policyRefs = { createdBy: operator, updatedBy: operator, publishedBy: operator, archivedBy: operator, applicability: { collaboratorIds: [uid] } };
  await put('dp_overtimePolicies', 'point-inventory-no-workspace', policyRefs);
  await put('dp_overtimePolicies', 'point-inventory-conflicting-workspaces', { ...policyRefs, workspaceId: 'coala', workspace_id: 'other' });
  for (const collection of ['dp_unitGroups', 'dp_unitOrganizations']) {
    await put(collection, `point-inventory-current-${collection}`, { workspaceId: 'coala', responsibleUserId: uid, responsibleUserName: 'Same displayed name' });
    await put(collection, `point-inventory-vacated-${collection}`, { workspaceId: 'coala', responsibilityVacatedByTerminationUserId: uid });
    await put(collection, `point-inventory-name-only-${collection}`, { workspaceId: 'coala', responsibleUserName: 'Same displayed name' });
    const responsibility = { responsibleUserId: uid, responsibilityVacatedByTerminationUserId: uid };
    await put(collection, `point-inventory-no-workspace-${collection}`, responsibility);
    await put(collection, `point-inventory-invalid-workspace-${collection}`, { ...responsibility, workspaceId: 42 });
    await put(collection, `point-inventory-conflicting-workspaces-${collection}`, { ...responsibility, workspaceId: 'coala', workspace_id: 'other' });
  }
  const actor = { decoded: { uid: 'point-inventory-manager' }, workspace_id: 'coala', isDefaultAdmin: false, userDoc: { unitAccessScope: 'all' }, permissions: { dp: { collaborators: { view: true }, settings: { manageTime: true, manageUnits: true } } } };
  const read = (sourceId, id = uid, context = actor) => collectPersonSource({ actor: context, sourceId, ref: { namespace: 'main.users', id }, limit: 25 });
  assert.deepEqual((await read('overtime-policy-subjects')).items.map(row => row.id), ['point-inventory-policy']);
  assert.deepEqual((await read('overtime-policy-creators')).items, []);
  for (const id of ['creators', 'updaters', 'publishers', 'archivers']) assert.deepEqual((await read(`overtime-policy-${id}`, operator)).items.map(row => row.id), ['point-inventory-policy']);
  for (const [prefix, collection] of [['dp-unit-group', 'dp_unitGroups'], ['dp-unit-organization', 'dp_unitOrganizations']]) {
    assert.deepEqual((await read(`${prefix}-responsible-users`)).items.map(row => row.id), [`point-inventory-current-${collection}`]);
    assert.deepEqual((await read(`${prefix}-vacated-responsible-users`)).items.map(row => row.id), [`point-inventory-vacated-${collection}`]);
    assert.deepEqual((await read(`${prefix}-responsible-users`, operator)).items, []);
  }
  const selected = { ...actor, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['point-unit'] } };
  for (const sourceId of ['overtime-policy-subjects', 'dp-unit-group-responsible-users', 'dp-unit-organization-responsible-users']) assert.equal((await read(sourceId, uid, selected)).status, 'restricted');
  const scheduleReader = { ...actor, permissions: { dp: { collaborators: { view: true }, schedules: { view: true } } } };
  assert.equal((await read('overtime-policy-subjects', uid, scheduleReader)).status, 'restricted');
  assert.equal((await read('dp-unit-group-responsible-users', uid, scheduleReader)).status, 'restricted');
  const admin = await read('overtime-policy-subjects', uid, { ...actor, isDefaultAdmin: true });
  assert.deepEqual(admin.items.map(row => row.id), ['point-inventory-policy']);
  assert.equal(admin.status, 'partial', 'the static source note declares incomplete legacy coverage');
  for (const adminMode of [false, true]) {
    const context = { ...actor, isDefaultAdmin: adminMode };
    for (const field of ['creators', 'updaters', 'publishers', 'archivers', 'subjects']) {
      const sourceId = `overtime-policy-${field}`;
      assert.deepEqual((await read(sourceId, field === 'subjects' ? uid : operator, context)).items.map(row => row.id), ['point-inventory-policy']);
      assert.equal((await read(sourceId, uid, { ...context, viewAs: { targetUserId: actor.decoded.uid, readOnly: true } })).status, 'restricted');
    }
    for (const [prefix, collection] of [['dp-unit-group', 'dp_unitGroups'], ['dp-unit-organization', 'dp_unitOrganizations']]) {
      for (const [suffix, expected] of [['responsible-users', 'current'], ['vacated-responsible-users', 'vacated']]) {
        const sourceId = `${prefix}-${suffix}`;
        assert.deepEqual((await read(sourceId, uid, context)).items.map(row => row.id), [`point-inventory-${expected}-${collection}`]);
        assert.equal((await read(sourceId, uid, { ...context, viewAs: { targetUserId: actor.decoded.uid, readOnly: true } })).status, 'restricted');
      }
    }
  }
});

test('inventory GET refuses the nine new sources through manager and default-admin viewAs', async (t) => {
  const { GET } = await import('../../src/app/api/privacy/person-inventory/route.ts');
  const { DEVELOPER_VIEW_AS_EMAIL, DEVELOPER_VIEW_AS_HEADER } = await import('../../src/features/auth/developer-view-as.ts');
  const uid = 'point-view-as-real', subject = 'point-view-as-subject', password = 'synthetic-view-as-only';
  const refs = [];
  t.after(async () => { await Promise.all(refs.map(ref => ref.delete())); await authAdmin.deleteUser(uid); });
  const put = async (collection, id, data) => { const ref = dbAdmin.collection(collection).doc(id); refs.push(ref); await ref.set(data); };
  await authAdmin.createUser({ uid, email: DEVELOPER_VIEW_AS_EMAIL, password });
  await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
  for (const [id, admin] of [[uid, true], ['point-view-as-manager', false], ['point-view-as-admin', true]]) {
    await put('profiles', id, { isDefaultAdmin: admin, permissions: structuredClone(defaultAdminPermissions) });
    await put('users', id, { email: id === uid ? DEVELOPER_VIEW_AS_EMAIL : `${id}@example.test`, username: id, profileId: id,
      workspaceId: 'coala', unitAccessScope: 'all', isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 } });
  }
  await put('users', subject, { workspaceId: 'coala', unitIds: ['point-unit'] });
  const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: DEVELOPER_VIEW_AS_EMAIL, password, returnSecureToken: true }) });
  const token = (await signIn.json()).idToken; assert.ok(token);
  const sources = ['overtime-policy-creators', 'overtime-policy-updaters', 'overtime-policy-publishers', 'overtime-policy-archivers', 'overtime-policy-subjects',
    'dp-unit-group-responsible-users', 'dp-unit-group-vacated-responsible-users', 'dp-unit-organization-responsible-users', 'dp-unit-organization-vacated-responsible-users'];
  const read = async (source, target) => {
    const headers = { Authorization: `Bearer ${token}`, ...(target ? { [DEVELOPER_VIEW_AS_HEADER]: target } : {}) };
    const query = new URLSearchParams({ namespace: 'main.users', id: subject, ...(source ? { source } : {}) });
    const response = await GET(new NextRequest(`http://localhost/api/privacy/person-inventory?${query}`, { headers }), { params: Promise.resolve({}) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  assert.notEqual((await read(sources[0])).status, 'restricted', 'real administrator keeps native inventory access');
  await put('dp_overtimePolicies', 'point-view-as-owned-alias', { workspace_id: 'coala', createdBy: subject, updatedBy: subject,
    publishedBy: subject, archivedBy: subject, applicability: { collaboratorIds: [subject] } });
  for (const collection of ['dp_unitGroups', 'dp_unitOrganizations']) await put(collection, `point-view-as-owned-alias-${collection}`,
    { workspace_id: 'coala', responsibleUserId: subject, responsibilityVacatedByTerminationUserId: subject });
  const beforeForeign = await Promise.all(sources.map(source => read(source)));
  assert.ok(beforeForeign.every(result => result.items.length === 1), 'explicit workspace_id aliases remain queryable');
  await Promise.all(Array.from({ length: 30 }, (_, index) => Promise.all([
    put('dp_overtimePolicies', `point-view-as-foreign-${index}`, { workspaceId: 'other', createdBy: subject, updatedBy: subject,
      publishedBy: subject, archivedBy: subject, applicability: { collaboratorIds: [subject] } }),
    put('dp_unitGroups', `point-view-as-foreign-${index}`, { workspace_id: 'other', responsibleUserId: subject, responsibilityVacatedByTerminationUserId: subject }),
    put('dp_unitOrganizations', `point-view-as-foreign-${index}`, { workspaceId: 'other', responsibleUserId: subject, responsibilityVacatedByTerminationUserId: subject }),
  ])));
  assert.deepEqual(await Promise.all(sources.map(source => read(source))), beforeForeign, 'foreign-only rows cannot affect items, state, reason or pagination');
  for (const target of ['point-view-as-manager', 'point-view-as-admin']) {
    for (const source of sources) {
      const result = await read(source, target); assert.equal(result.status, 'restricted'); assert.deepEqual(result.items, []);
    }
    const catalog = await read(null, target);
    const restricted = catalog.sources.filter(source => sources.includes(source.id));
    assert.equal(restricted.length, sources.length);
    assert.ok(restricted.every(source => source.coverage === 'restricted' && Object.keys(source).length === 2));
  }
});

test('authenticated review job route and pre-existing requests stay inert while activation is pending', async (t) => {
  const job = await import('../../src/app/api/jobs/dp/time-recording/review-requests/route.ts');
  const savedSecret = process.env.SYSTEM_NOTICES_JOB_SECRET, savedFlag = process.env.DP_TIME_REVIEW_ENABLED;
  process.env.SYSTEM_NOTICES_JOB_SECRET = 'synthetic-point-job-only'; delete process.env.DP_TIME_REVIEW_ENABLED;
  const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
  const ref = hrDbAdmin.collection('dp_timeReviewRequests').doc('point-rollout-existing-request');
  t.after(() => ref.delete());
  const existing = { workspaceId: 'coala', employeeUid: 'point-rollout-owner', status: 'open', date: '2026-11-01' };
  await ref.set(existing);
  try {
    const { markReviewRequestReviewed } = await import('../../src/features/dp/time-review/service.server.ts');
    const { listReviewRequestsOfPerson } = await import('../../src/features/dp/time-review/read.server.ts');
    await assert.rejects(markReviewRequestReviewed({ workspace_id: 'coala', decoded: { uid: existing.employeeUid } }, ref.id), { code: 'TIME_REVIEW_PENDING' });
    assert.deepEqual(await listReviewRequestsOfPerson('coala', existing.employeeUid, '2026-11'), []);
    assert.deepEqual((await ref.get()).data(), existing);
    const path = 'http://localhost/api/jobs/dp/time-recording/review-requests';
    const context = { params: Promise.resolve({}) };
    assert.equal((await job.POST(new NextRequest(path, { method: 'POST' }), context)).status, 401);
    const response = await job.POST(new NextRequest(path, { method: 'POST', headers: { Authorization: 'Bearer synthetic-point-job-only', 'Content-Type': 'application/json' }, body: '{}' }), context);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { evaluated: 0, opened: 0, reopened: 0, resolved: 0, notified: 0, skipped: true });
  } finally {
    if (savedSecret === undefined) delete process.env.SYSTEM_NOTICES_JOB_SECRET; else process.env.SYSTEM_NOTICES_JOB_SECRET = savedSecret;
    if (savedFlag === undefined) delete process.env.DP_TIME_REVIEW_ENABLED; else process.env.DP_TIME_REVIEW_ENABLED = savedFlag;
  }
});
