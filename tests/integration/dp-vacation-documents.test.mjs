import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { createInitialVacationWorkflow } = await import('../../src/lib/dp-vacation-workflow.ts');
const route = await import('../../src/app/api/dp/vacations/[vacationId]/route.ts');
const prefix = 'vacation-documents-security';
const password = 'synthetic-vacation-password';
const people = ['allowed', 'denied', 'outside'];
const documentId = `receipt_${'a'.repeat(32)}`;

async function token(person) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.match(host ?? '', /^(127\.0\.0\.1|localhost):\d+$/);
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${prefix}-${person}@example.test`, password, returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return (await response.json()).idToken;
}
function request(method, id, bearer, body) {
  return new NextRequest(`http://localhost/api/dp/vacations/${id}`, {
    method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const context = (id) => ({ params: Promise.resolve({ vacationId: id }) });

test('API de férias preserva histórico e bloqueia gravações sem permissão ou unidade', async (t) => {
  const vacationId = `${prefix}-review`;
  const deleteId = `${prefix}-delete`;
  const vacationRef = dbAdmin.collection('dp_vacations').doc(vacationId);
  const targetId = `${prefix}-employee`;
  t.after(async () => {
    await Promise.all(people.map((person) => authAdmin.deleteUser(`${prefix}-${person}`).catch(() => undefined)));
    const events = await dbAdmin.collection('dp_vacationEvents').where('vacationId', 'in', [vacationId, deleteId]).limit(30).get();
    await Promise.all(events.docs.map((doc) => doc.ref.delete()));
    await Promise.all([vacationRef.collection('receiptVersions').doc(documentId).delete(), vacationRef.delete(),
      dbAdmin.collection('dp_vacations').doc(deleteId).delete(), dbAdmin.collection('users').doc(targetId).delete(),
      ...people.flatMap((person) => [dbAdmin.collection('users').doc(`${prefix}-${person}`).delete(), dbAdmin.collection('profiles').doc(`${prefix}-${person}`).delete()])]);
  });
  for (const person of people) {
    const uid = `${prefix}-${person}`;
    await authAdmin.createUser({ uid, email: `${uid}@example.test`, password });
    await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0 });
    await dbAdmin.collection('profiles').doc(uid).set({ permissions: { dp: { vacation: { approve: person !== 'denied', request: true } } } });
    await dbAdmin.collection('users').doc(uid).set({ username: person, email: `${uid}@example.test`, profileId: uid,
      isActive: true, sessionVersion: 0, profileCompliance: { status: 'complete', policyVersion: 1 },
      unitAccessScope: 'selected', unitAccessUnitIds: [person === 'outside' ? `${prefix}-other` : `${prefix}-unit`] });
  }
  await dbAdmin.collection('users').doc(targetId).set({ username: 'Synthetic employee', unitId: `${prefix}-unit` });
  const workflow = createInitialVacationWorkflow({ status: 'APPROVED', startDate: '2026-11-01', endDate: '2026-11-15',
    asOfDate: '2026-09-01', now: '2026-09-01T12:00:00Z', actorId: `${prefix}-allowed` });
  workflow.receipt = { ...workflow.receipt, status: 'review_pending', documents: [{ id: documentId,
    fileName: 'support.pdf', mimeType: 'application/pdf', storagePath: 'synthetic/immutable.pdf', hashSha256: 'a'.repeat(64),
    size: 100, uploadedAt: '2026-09-01T12:00:00Z', uploadedBy: 'external:accountant', correctionRound: 0, status: 'review_pending' }] };
  const record = { userId: targetId, cycleId: '2025-2026', recordType: 'gozo', status: 'PLANNED', workflow };
  await vacationRef.set(record);
  await dbAdmin.collection('dp_vacations').doc(deleteId).set(record);
  const [allowed, denied, outside] = await Promise.all(people.map(token));
  const command = { action: 'discard_receipt_document', documentId, reason: 'Documento de outra pessoa', discardedBy: 'forged-client' };
  for (const [bearer, status] of [[null, 401], [denied, 403], [outside, 403]]) {
    assert.equal((await route.PATCH(request('PATCH', vacationId, bearer, command), context(vacationId))).status, status);
    assert.equal((await route.DELETE(request('DELETE', deleteId, bearer), context(deleteId))).status, status);
    assert.deepEqual((await vacationRef.get()).data(), record);
    assert.equal((await vacationRef.collection('receiptVersions').doc(documentId).get()).exists, false);
    assert.equal((await dbAdmin.collection('dp_vacations').doc(deleteId).get()).exists, true);
  }
  const invalid = await route.PATCH(request('PATCH', vacationId, allowed, { ...command, reason: ' ' }), context(vacationId));
  assert.equal(invalid.status, 400);
  assert.deepEqual((await vacationRef.get()).data(), record);
  const response = await route.PATCH(request('PATCH', vacationId, allowed, command), context(vacationId));
  assert.equal(response.status, 200, await response.text());
  const stored = (await vacationRef.get()).get('workflow.receipt.documents')[0];
  const version = (await vacationRef.collection('receiptVersions').doc(documentId).get()).data();
  assert.equal(stored.status, 'discarded');
  assert.equal(stored.discardReason, command.reason);
  assert.equal(stored.discardedBy, `${prefix}-allowed`);
  assert.equal(stored.storagePath, 'synthetic/immutable.pdf');
  assert.equal(stored.hashSha256, 'a'.repeat(64));
  assert.deepEqual(version, { status: 'discarded', discardReason: stored.discardReason, discardedAt: stored.discardedAt, discardedBy: stored.discardedBy });
  const events = await dbAdmin.collection('dp_vacationEvents').where('vacationId', '==', vacationId).limit(10).get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].get('data.reason'), command.reason);
  assert.equal(events.docs[0].get('actorId'), `${prefix}-allowed`);
  assert.equal((await route.PATCH(request('PATCH', vacationId, allowed, command), context(vacationId))).status, 409);
  assert.equal((await dbAdmin.collection('dp_vacationEvents').where('vacationId', '==', vacationId).limit(10).get()).size, 1);
  assert.equal((await route.DELETE(request('DELETE', deleteId, allowed), context(deleteId))).status, 204);
  assert.equal((await dbAdmin.collection('dp_vacations').doc(deleteId).get()).exists, false);
});
