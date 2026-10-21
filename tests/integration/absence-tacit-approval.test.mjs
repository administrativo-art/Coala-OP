import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

const projectId = 'demo-coala-repository';
assertFirestoreEmulatorSafety({ projectId });
enableServerOnlyTestImports(projectId);
const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { belemCivilDate } = await import('../../src/features/dp/absences/requests/core.ts');
const { requireUser } = await import('../../src/lib/auth-server.ts');
const { createAbsenceDraft, actOnAbsenceRequest, applyTacitAbsenceApprovals, getAbsenceRequest, ABSENCE_TACIT_ACTOR_UID }
  = await import('../../src/features/dp/absences/requests/workflow.server.ts');

const suffix = randomUUID().slice(0, 8);
const personUid = `absence-tacit-person-${suffix}`;
const reviewerUid = `absence-tacit-reviewer-${suffix}`;
const unitId = `absence-tacit-unit-${suffix}`;
const typeId = `absence-tacit-type-${suffix}`;
const password = 'absence-tacit-123';
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function signIn(uid) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${uid}@example.test`, password, returnSecureToken: true }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.idToken;
}
const actorFor = async (uid) => requireUser(new NextRequest('http://localhost/api/collaborator/absence-requests',
  { headers: { Authorization: `Bearer ${await signIn(uid)}` } }));

test('ausência sem análise no prazo da regra é aprovada por decurso; motivo fica no pedido', async (t) => {
  const previous = process.env.DP_ABSENCE_CATALOG_DATABASE;
  process.env.DP_ABSENCE_CATALOG_DATABASE = 'coala-rh';
  t.after(async () => {
    if (previous === undefined) delete process.env.DP_ABSENCE_CATALOG_DATABASE; else process.env.DP_ABSENCE_CATALOG_DATABASE = previous;
    // Emulador apenas: apaga tudo o que o motor gravou, para os testes seguintes partirem de base vazia.
    const touched = ['dp_absenceRequests', 'dp_absenceOutbox', 'dp_absenceOccurrences', 'dp_absenceAudit', 'dp_absenceIdempotency',
      'dp_absenceRevisions', 'dp_absenceDayReservations', 'dp_absenceBalances', 'dp_absenceEvents', 'dp_absenceOperationalIntents',
      'dp_absenceOperationalAudit', 'dp_absenceCatalogMigrations'];
    for (const name of touched) {
      const refs = await hrDbAdmin.collection(name).listDocuments();
      await Promise.all(refs.map((ref) => hrDbAdmin.recursiveDelete(ref)));
    }
    await Promise.allSettled([authAdmin.deleteUser(personUid), authAdmin.deleteUser(reviewerUid),
      dbAdmin.collection('users').doc(personUid).delete(), dbAdmin.collection('users').doc(reviewerUid).delete(),
      dbAdmin.collection('dp_units').doc(unitId).delete(), hrDbAdmin.collection('dp_absenceTypes').doc(typeId).delete(),
      hrDbAdmin.collection('dp_absenceTypes').doc(`${typeId}-sem-decurso`).delete()]);
  });
  for (const [uid, profileId] of [[personUid, 'absence-tacit-person-profile'], [reviewerUid, 'absence-tacit-review-profile']]) {
    await authAdmin.createUser({ uid, email: `${uid}@example.test`, password });
    await authAdmin.setCustomUserClaims(uid, { profileId, sessionVersion: 0 });
  }
  const batch = dbAdmin.batch();
  batch.set(dbAdmin.collection('profiles').doc('absence-tacit-person-profile'), { permissions: { dashboard: { collaborator: true } } });
  batch.set(dbAdmin.collection('profiles').doc('absence-tacit-review-profile'), { permissions: { dp: { requests: { review: true, view: true } } } });
  for (const [uid, profileId] of [[personUid, 'absence-tacit-person-profile'], [reviewerUid, 'absence-tacit-review-profile']]) {
    batch.set(dbAdmin.collection('users').doc(uid), { username: uid, email: `${uid}@example.test`, profileId, isActive: true, sessionVersion: 0,
      employmentRelationshipType: 'clt', unitId, unitIds: [unitId], profileCompliance: { status: 'complete', policyVersion: 1 } });
  }
  batch.set(dbAdmin.collection('dp_units').doc(unitId), { name: 'Unidade decurso' });
  await batch.commit();
  await hrDbAdmin.collection('dp_absenceCatalogMigrations').doc('active').set({ state: 'ready', catalogDatabase: 'coala-rh' });
  await hrDbAdmin.collection('dp_absenceTypes').doc(typeId).set({ lineageId: typeId, version: 1, status: 'published', publishedAt: new Date(),
    name: 'Ausência com decurso', color: 'blue', requestUnits: ['day'], initiatedBy: ['collaborator'], validFrom: '1900-01-01', validTo: '9999-12-31',
    workdayEffect: 'excused_absence', blocksSchedule: false, includeInAbsenteeism: true,
    policies: [{ id: 'policy', name: 'Regra decurso', employmentRelationshipTypes: ['clt'], applicability: { scope: { kind: 'company' } },
      calculation: 'calendar_days', attachment: 'not_required', approvalFlow: 'dp', tacitApprovalDays: 3,
      approvalAssignments: { dp: [{ kind: 'people', personIds: [reviewerUid] }] },
      rejectionReasonRequired: false, allowFutureEdit: false, allowFutureCancel: false }] });

  // Regra sem decurso: seus pedidos vencidos não podem travar a fila do decurso.
  const tacitType = (await hrDbAdmin.collection('dp_absenceTypes').doc(typeId).get()).data();
  const { tacitApprovalDays: _unused, ...plainPolicy } = tacitType.policies[0];
  await hrDbAdmin.collection('dp_absenceTypes').doc(`${typeId}-sem-decurso`).set({ ...tacitType, lineageId: `${typeId}-sem-decurso`,
    name: 'Ausência sem decurso', policies: [plainPolicy] });
  const person = await actorFor(personUid);
  const reviewer = await actorFor(reviewerUid);
  const startDate = addDays(belemCivilDate(new Date()), 5);
  const request = { absenceTypeId: typeId, startDate, endDate: startDate, unit: 'day' };
  const create = (reason) => createAbsenceDraft(person, { idempotencyKey: randomUUID(), request: { ...request, startDate: addDays(startDate, reason ? 0 : 7), endDate: addDays(startDate, reason ? 0 : 7) }, preparationIds: [], ...(reason ? { reason } : {}) });
  const due = await create('Consulta médica marcada pela manhã.');
  assert.equal(due.reason, 'Consulta médica marcada pela manhã.');
  assert.equal(due.tacitApprovalDays, 3);
  const notDue = await create(null);
  const noTacit = await createAbsenceDraft(person, { idempotencyKey: randomUUID(), preparationIds: [],
    request: { ...request, absenceTypeId: `${typeId}-sem-decurso`, startDate: addDays(startDate, 14), endDate: addDays(startDate, 14) } });
  for (const draft of [due, notDue, noTacit]) {
    await actOnAbsenceRequest(person, draft.id, { action: 'submit', expectedVersion: draft.version, operationId: randomUUID() });
  }
  // Simula atribuições antigas: 4 dias (vencido) e 2 dias (ainda no prazo de 3 dias).
  const now = new Date();
  const ago = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
  await hrDbAdmin.collection('dp_absenceRequests').doc(due.id).update({ 'reviewSla.startedAt': ago(4), 'reviewSla.deadlineAt': ago(3) });
  await hrDbAdmin.collection('dp_absenceRequests').doc(notDue.id).update({ 'reviewSla.startedAt': ago(2), 'reviewSla.deadlineAt': ago(1) });
  await hrDbAdmin.collection('dp_absenceRequests').doc(noTacit.id).update({ 'reviewSla.startedAt': ago(11), 'reviewSla.deadlineAt': ago(10) });

  // Página de 1: o vencido mais antigo (sem decurso) vem primeiro e não pode esconder o que deve ser aprovado.
  const result = await applyTacitAbsenceApprovals(person.workspace_id, now, undefined, { pageSize: 1 });
  assert.equal(result.approved, 1);
  assert.equal(result.notDue, 2);
  assert.equal((await hrDbAdmin.collection('dp_absenceRequests').doc(noTacit.id).get()).get('status'), 'in_review');
  const stored = (await hrDbAdmin.collection('dp_absenceRequests').doc(due.id).get()).data();
  assert.equal(stored.status, 'approved');
  assert.equal(stored.approvalOrigin, 'tacit_timeout');
  assert.equal(stored.tacitApprovals.length, 1);
  assert.equal(stored.history.at(-1).action, 'tacit_approve');
  assert.equal(stored.history.at(-1).actorUid, ABSENCE_TACIT_ACTOR_UID);
  assert.equal((await hrDbAdmin.collection('dp_absenceAudit').doc(`${due.id}_${stored.version}`).get()).get('action'), 'tacit_approve');
  assert.equal((await getAbsenceRequest(person, due.id)).approvedByInaction, true);
  assert.equal((await hrDbAdmin.collection('dp_absenceRequests').doc(notDue.id).get()).get('status'), 'in_review');
  // Repetir a rotina não reaprova nem duplica a ocorrência.
  assert.equal((await applyTacitAbsenceApprovals(person.workspace_id, now)).approved, 0);
  // Ator de sistema não pode decidir fora da rotina nem ações que não sejam aprovar.
  await assert.rejects(actOnAbsenceRequest(person, notDue.id, { action: 'approve', expectedVersion: 2, operationId: randomUUID() }, undefined, { tacitTimeout: { days: 3 } }),
    { code: 'ABSENCE_ACTION_FORBIDDEN' });

  // Competência fechada bloqueia criação, decisão manual e o mesmo caminho automático do decurso.
  const closedWorkspace = `absence-closed-${suffix}`;
  const closedPerson = { ...person, workspace_id: closedWorkspace };
  const closedReviewer = { ...reviewer, workspace_id: closedWorkspace };
  const guarded = await createAbsenceDraft(closedPerson, { idempotencyKey: randomUUID(), request, preparationIds: [] });
  const submitted = await actOnAbsenceRequest(closedPerson, guarded.id,
    { action: 'submit', expectedVersion: guarded.version, operationId: randomUUID() });
  const closureRef = hrDbAdmin.collection('ptrp_competenceClosures').doc(`${closedWorkspace}_${startDate.slice(0, 7)}`);
  t.after(() => closureRef.delete());
  await closureRef.set({ workspaceId: closedWorkspace, competence: startDate.slice(0, 7), status: 'closed', version: 1 });
  await hrDbAdmin.collection('dp_absenceRequests').doc(guarded.id).update({
    'reviewSla.startedAt': ago(4), 'reviewSla.deadlineAt': ago(3),
  });
  await assert.rejects(actOnAbsenceRequest(closedReviewer, guarded.id,
    { action: 'approve', expectedVersion: submitted.version, operationId: randomUUID() }), { code: 'PTRP_COMPETENCE_CLOSED' });
  const blockedTacit = await applyTacitAbsenceApprovals(closedWorkspace, now);
  assert.deepEqual([blockedTacit.approved, blockedTacit.skipped, blockedTacit.skippedCodes.PTRP_COMPETENCE_CLOSED], [0, 1, 1]);
  assert.equal((await hrDbAdmin.collection('dp_absenceRequests').doc(guarded.id).get()).get('status'), 'in_review');
  await assert.rejects(createAbsenceDraft(closedPerson, { idempotencyKey: randomUUID(), request, preparationIds: [] }),
    { code: 'PTRP_COMPETENCE_CLOSED' });
});
