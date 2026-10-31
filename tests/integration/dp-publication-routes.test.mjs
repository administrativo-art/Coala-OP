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
