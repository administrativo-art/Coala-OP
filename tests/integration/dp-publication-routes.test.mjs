import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { repPDbAdmin } = await import('../../src/lib/firebase-rep-p-admin.ts');
const shiftRoute = await import('../../src/app/api/dp/schedules/[scheduleId]/shifts/[shiftId]/route.ts');
const bulkRoute = await import('../../src/app/api/dp/schedules/[scheduleId]/shifts/bulk/route.ts');
const publishRoute = await import('../../src/app/api/dp/schedules/[scheduleId]/publish/route.ts');
const draftRoute = await import('../../src/app/api/dp/schedules/[scheduleId]/draft-shifts/route.ts');
const { readOfficialScheduleShifts } = await import('../../src/features/dp/schedules/official-revision.server.ts');

const prefix = 'publication-route-test';
const password = 'synthetic-publication-password';
const scheduleId = `${prefix}-schedule`;
const unitId = `${prefix}-unit`;
const personId = `${prefix}-person`;

async function token(role) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${prefix}-${role}@example.test`, password, returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return (await response.json()).idToken;
}
function request(path, method, bearer, body) {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
const singleContext = { params: Promise.resolve({ scheduleId, shiftId: 'shift-a' }) };
const scheduleContext = { params: Promise.resolve({ scheduleId }) };

test('rotas de stage e publish exigem autenticação, permissão e mantêm draft invisível', async (t) => {
  t.after(async () => {
    await Promise.all(['allowed', 'editor', 'denied'].map((role) => authAdmin.deleteUser(`${prefix}-${role}`).catch(() => undefined)));
  });
  for (const role of ['allowed', 'editor', 'denied']) {
    const uid = `${prefix}-${role}`;
    await authAdmin.createUser({ uid, email: `${uid}@example.test`, password });
    await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
    const permissions = { dp: { schedules: { view: true, edit: role !== 'denied', publish: role === 'allowed' } } };
    await dbAdmin.collection('profiles').doc(uid).set({ permissions });
    await dbAdmin.collection('users').doc(uid).set({ username: role, email: `${uid}@example.test`, profileId: uid,
      isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 },
      unitAccessScope: 'selected', unitAccessUnitIds: [unitId] });
  }
  await Promise.all([
    dbAdmin.collection('dp_schedules').doc(scheduleId).set({ workspaceId: 'coala', unitId, year: 2027, month: 11,
      publicationStatus: 'draft', publicationVersion: 0, draftVersion: 0, operationalVersion: 0,
      journeyValidationVersion: 0, shiftCount: 0, createdAt: new Date() }),
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Unit', isArchived: false }),
    dbAdmin.collection('users').doc(personId).set({ username: 'Person', isActive: true, unitId, unitIds: [unitId] }),
    dbAdmin.collection('dp_journeys').doc(`${prefix}-journey`).set({ lineageId: `${prefix}-journey`, version: 1,
      status: 'published', name: 'Journey', validFrom: '2027-01-01', weeklyMinutes: 1800, cycleLengthDays: 7,
      days: [{ dayIndex: 0, plannedMinutes: 360, isRestDay: false }],
      applicability: { scope: { kind: 'company' } }, allowedShiftDefinitionIds: [] }),
  ]);
  const allowed = await token('allowed');
  const editor = await token('editor');
  const denied = await token('denied');
  const path = `/api/dp/schedules/${scheduleId}/shifts/shift-a`;
  const body = { userId: personId, unitId, date: '2027-11-01', startTime: '08:00', endTime: '14:00' };
  assert.equal((await shiftRoute.PUT(request(path, 'PUT', null, body), singleContext)).status, 401);
  assert.equal((await shiftRoute.PUT(request(path, 'PUT', denied, body), singleContext)).status, 403);
  assert.equal((await shiftRoute.PUT(request(path, 'PUT', allowed, body), singleContext)).status, 201);
  assert.equal((await readOfficialScheduleShifts({ scheduleId })).shifts.length, 0);
  const draftPath = `/api/dp/schedules/${scheduleId}/draft-shifts`;
  assert.equal((await draftRoute.GET(request(draftPath, 'GET', denied), scheduleContext)).status, 403);
  const draftResponse = await draftRoute.GET(request(draftPath, 'GET', allowed), scheduleContext);
  assert.equal(draftResponse.status, 200);
  assert.equal((await draftResponse.json()).shifts.length, 1);
  const bulkPath = `/api/dp/schedules/${scheduleId}/shifts/bulk`;
  const bulk = { action: 'delete', shiftIds: ['shift-a'] };
  assert.equal((await bulkRoute.POST(request(bulkPath, 'POST', allowed, bulk), scheduleContext)).status, 200);
  assert.equal((await shiftRoute.PATCH(request(path, 'PATCH', allowed, body), singleContext)).status, 404);
  assert.equal((await shiftRoute.PUT(request(path, 'PUT', allowed, body), singleContext)).status, 201);
  const publishPath = `/api/dp/schedules/${scheduleId}/publish`;
  assert.equal((await publishRoute.POST(request(publishPath, 'POST', denied, { expectedDraftVersion: 3 }), scheduleContext)).status, 403);
  assert.equal((await publishRoute.POST(request(publishPath, 'POST', editor, { expectedDraftVersion: 3 }), scheduleContext)).status, 403);
  const closureFence = repPDbAdmin.collection('repP_competenceFences').doc('coala_2027-11');
  await closureFence.set({ workspaceId: 'coala', competence: '2027-11', status: 'closed' });
  assert.equal((await publishRoute.POST(request(publishPath, 'POST', allowed, { expectedDraftVersion: 3 }), scheduleContext)).status, 409);
  await closureFence.set({ status: 'open' }, { merge: true });
  const response = await publishRoute.POST(request(publishPath, 'POST', allowed, { expectedDraftVersion: 3 }), scheduleContext);
  assert.equal(response.status, 200, await response.text());
  assert.equal((await readOfficialScheduleShifts({ scheduleId })).shifts.length, 1);
});

test('publica escala legada sem workspaceId e recusa workspaceId de outro ambiente', async (t) => {
  const legacyPrefix = `${prefix}-legacy`;
  const uid = `${legacyPrefix}-allowed`;
  const legacyUnit = `${legacyPrefix}-unit`;
  const legacyPerson = `${legacyPrefix}-person`;
  const schedules = { legacy: `${legacyPrefix}-schedule`, foreign: `${legacyPrefix}-foreign` };
  t.after(() => authAdmin.deleteUser(uid).catch(() => undefined));
  await authAdmin.createUser({ uid, email: `${uid}@example.test`, password });
  await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
  await dbAdmin.collection('profiles').doc(uid).set({ permissions: { dp: { schedules: { view: true, edit: true, publish: true } } } });
  await dbAdmin.collection('users').doc(uid).set({ username: 'legacy', email: `${uid}@example.test`, profileId: uid,
    isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 },
    unitAccessScope: 'selected', unitAccessUnitIds: [legacyUnit] });
  const base = { unitId: legacyUnit, year: 2027, month: 10, publicationStatus: 'draft', publicationVersion: 0, draftVersion: 0,
    operationalVersion: 0, journeyValidationVersion: 0, shiftCount: 0, createdAt: new Date() };
  await Promise.all([
    dbAdmin.collection('dp_schedules').doc(schedules.legacy).set(base),
    dbAdmin.collection('dp_schedules').doc(schedules.foreign).set({ ...base, workspaceId: 'outro-ambiente' }),
    dbAdmin.collection('dp_units').doc(legacyUnit).set({ name: 'Unit', isArchived: false }),
    dbAdmin.collection('users').doc(legacyPerson).set({ username: 'Person', isActive: true, unitId: legacyUnit, unitIds: [legacyUnit] }),
  ]);
  const bearer = await (async () => {
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${uid}@example.test`, password, returnSecureToken: true }) });
    return (await response.json()).idToken;
  })();
  const shiftBody = { userId: legacyPerson, unitId: legacyUnit, date: '2027-10-01', startTime: '08:00', endTime: '14:00' };
  for (const id of Object.values(schedules)) {
    const context = { params: Promise.resolve({ scheduleId: id, shiftId: 'shift-a' }) };
    assert.equal((await shiftRoute.PUT(request(`/api/dp/schedules/${id}/shifts/shift-a`, 'PUT', bearer, shiftBody), context)).status, 201);
  }
  const publish = (id) => publishRoute.POST(request(`/api/dp/schedules/${id}/publish`, 'POST', bearer, { expectedDraftVersion: 1 }),
    { params: Promise.resolve({ scheduleId: id }) });
  const foreign = await publish(schedules.foreign);
  assert.notEqual(foreign.status, 200);
  assert.equal((await dbAdmin.collection('dp_schedules').doc(schedules.foreign).get()).get('activeRevisionId'), undefined);
  assert.ok((await foreign.text()).includes('DP_SCHEDULE_PUBLICATION_SCOPE_INVALID') || foreign.status >= 400);
  const legacy = await publish(schedules.legacy);
  assert.equal(legacy.status, 200, await legacy.text());
  assert.equal((await readOfficialScheduleShifts({ scheduleId: schedules.legacy })).shifts.length, 1);
});

test('repouso semanal em rascunho de outra escala conta ao publicar, em qualquer ordem', async (t) => {
  const p = `${prefix}-cross`;
  const uid = `${p}-allowed`;
  const unitA = `${p}-unit-a`; const unitB = `${p}-unit-b`; const person = `${p}-person`;
  const scheduleA = `${p}-schedule-a`; const scheduleB = `${p}-schedule-b`;
  t.after(() => authAdmin.deleteUser(uid).catch(() => undefined));
  await authAdmin.createUser({ uid, email: `${uid}@example.test`, password });
  await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
  await dbAdmin.collection('profiles').doc(uid).set({ permissions: { dp: { schedules: { view: true, edit: true, publish: true } } } });
  await dbAdmin.collection('users').doc(uid).set({ username: 'cross', email: `${uid}@example.test`, profileId: uid,
    isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 },
    unitAccessScope: 'selected', unitAccessUnitIds: [unitA, unitB] });
  const base = { workspaceId: 'coala', year: 2027, month: 11, publicationStatus: 'draft', publicationVersion: 0,
    operationalVersion: 0, journeyValidationVersion: 0, shiftCount: 0, createdAt: new Date() };
  await Promise.all([
    dbAdmin.collection('dp_schedules').doc(scheduleA).set({ ...base, unitId: unitA, draftVersion: 0 }),
    dbAdmin.collection('dp_schedules').doc(scheduleB).set({ ...base, unitId: unitB, draftVersion: 1, draftGenerationId: 'cross-gen' }),
    dbAdmin.collection('dp_units').doc(unitA).set({ name: 'A', isArchived: false }),
    dbAdmin.collection('dp_units').doc(unitB).set({ name: 'B', isArchived: false }),
    dbAdmin.collection('users').doc(person).set({ username: 'Person', isActive: true, unitId: unitA, unitIds: [unitA, unitB] }),
    dbAdmin.collection('dp_journeys').doc(`${p}-journey`).set({ lineageId: `${p}-journey`, version: 1, status: 'published',
      name: 'Journey 40h', validFrom: '2027-01-01', weeklyMinutes: 2400, cycleLengthDays: 7,
      days: [{ dayIndex: 0, plannedMinutes: 480, isRestDay: false }],
      weeklyRest: { placement: 'schedule', maxConsecutiveWorkDays: 6, distribution: 'weekly' },
      scaleValidation: { mode: 'consecutive_days' },
      applicability: { scope: { kind: 'company' }, collaboratorIds: [person] }, allowedShiftDefinitionIds: [] }),
  ]);
  const dayOff = (date) => dbAdmin.collection('dp_schedules').doc(scheduleB).collection('draftEdits').doc(`cross-gen_off-${date}`).set({
    generationId: 'cross-gen', shiftId: `off-${date}`, baseFingerprint: 'missing',
    value: { scheduleId: scheduleB, unitId: unitB, userId: person, date, type: 'day_off' }, updatedAt: new Date(), updatedBy: uid });
  // Quatro semanas completas de novembro/2027 (seg. 1, 8, 15, 22): dois repousos por semana no rascunho da escala B.
  const weeks = ['2027-11-02', '2027-11-03', '2027-11-09', '2027-11-10', '2027-11-16', '2027-11-17'];
  await Promise.all(weeks.map(dayOff));
  const bearer = await (async () => {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${uid}@example.test`, password, returnSecureToken: true }) });
    return (await response.json()).idToken;
  })();
  const context = { params: Promise.resolve({ scheduleId: scheduleA, shiftId: 'shift-a' }) };
  const staged = await shiftRoute.PUT(request(`/api/dp/schedules/${scheduleA}/shifts/shift-a`, 'PUT', bearer,
    { userId: person, unitId: unitA, date: '2027-11-01', startTime: '08:00', endTime: '14:00' }), context);
  assert.equal(staged.status, 201);
  const publish = () => publishRoute.POST(request(`/api/dp/schedules/${scheduleA}/publish`, 'POST', bearer, { expectedDraftVersion: 1 }),
    { params: Promise.resolve({ scheduleId: scheduleA }) });
  // Falta a quarta semana (22–28/11): a publicação é bloqueada pelo descanso semanal.
  const blocked = await publish();
  assert.notEqual(blocked.status, 200);
  const blockedBody = await blocked.text(); assert.ok(blockedBody.includes('DP_SCHEDULE_JOURNEY_BLOCKED'), blockedBody);
  // Com os repousos da semana faltante no rascunho da outra escala, publica sem publicar a escala B antes.
  await Promise.all(['2027-11-23', '2027-11-24'].map(dayOff));
  const published = await publish();
  assert.equal(published.status, 200, await published.text());
  assert.equal((await readOfficialScheduleShifts({ scheduleId: scheduleA })).shifts.length, 1);
});
