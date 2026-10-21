import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { createOwnAdjustment, decideAdjustment, listAdjustmentsForReview, listOwnAdjustments, TREATMENTS, CLOSURES }
  = await import('../../src/features/dp/time-adjustments/service.server.ts');

test('ajuste de ponto: titular pede, outro decide com justificativa, original fica e o tratamento é criado', async () => {
  const prefix = `ptrp-${randomUUID().slice(0, 6)}`;
  const workspaceId = 'coala-one';
  const userId = `${prefix}-employee`;
  const reviewerId = `${prefix}-reviewer`;
  const unitId = `${prefix}-unit`;
  const workDate = '2026-10-16';
  const clock = { async read() { return { instant: new Date('2026-10-17T12:00:00.000Z') }; } };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock };
  const admin = { decoded: { uid: `${prefix}-admin` }, userDoc: { id: `${prefix}-admin` }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const titular = { decoded: { uid: userId }, userDoc: { id: userId, username: 'Maria', unitIds: [unitId] }, profileId: null,
    permissions: structuredClone(defaultGuestPermissions), isDefaultAdmin: false, workspace_id: workspaceId };
  const reviewerPermissions = structuredClone(defaultGuestPermissions);
  reviewerPermissions.dp.requests.review = true;
  const reviewer = { decoded: { uid: reviewerId }, userDoc: { id: reviewerId, unitIds: [unitId] }, profileId: null,
    permissions: reviewerPermissions, isDefaultAdmin: false, workspace_id: workspaceId };

  await Promise.all([
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Quiosque', address: 'Rua fiscal, 1', cnpj: '14276603000125', timeZone: 'America/Fortaleza' }),
    dbAdmin.collection('users').doc(userId).set({ isActive: true, unitId, unitIds: [unitId] }),
  ]);
  await publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: `${prefix}-ref`, periods: [{
    validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId: unitId, unitId, unitIds: [unitId],
    jobFunctionIds: [], sourceDocumentId: 'admission', sourceReason: 'Admissão conferida para o ensaio' }] });
  const receiptId = `${prefix}-receipt`;
  await hrDbAdmin.collection('repP_receipts').doc(receiptId).set({ workspaceId, employeeId: userId, recordedDate: workDate,
    status: 'issued', snapshot: { nsr: 7, markedAt: `${workDate}T13:14:00-0300`, executionUnitId: unitId } });

  // Horário errado: desconsidera a 13:14 e inclui 13:30, com justificativa.
  const attemptId = randomUUID();
  const created = await createOwnAdjustment(titular, { attemptId, workDate, kind: 'correct', targetReceiptId: receiptId,
    newTime: '13:30', reason: 'Bati antes de voltar do intervalo; voltei às 13:30.' }, deps);
  assert.equal(created.status, 'in_review');
  assert.equal(created.inclusion.markedAt, `${workDate}T13:30:00-0300`);
  assert.equal(created.acts[0].role, 'titular');
  assert.equal(created.acts[0].clockSource, 'hora_legal');
  assert.deepEqual((await createOwnAdjustment(titular, { attemptId, workDate, kind: 'correct', targetReceiptId: receiptId,
    newTime: '13:30', reason: 'Bati antes de voltar do intervalo; voltei às 13:30.' }, deps)).id, created.id);
  await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), workDate, kind: 'discard', targetReceiptId: receiptId,
    reason: 'Pedido duplicado para a mesma batida.' }, deps), { code: 'PTRP_ADJUSTMENT_DUPLICATE' });
  await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), workDate, kind: 'discard', targetReceiptId: 'alheia',
    reason: 'Batida que não é minha neste dia.' }, deps), { code: 'PTRP_ADJUSTMENT_TARGET_INVALID' });

  // Quem pediu não decide; quem analisa precisa de permissão e vê a fila.
  await assert.rejects(decideAdjustment(titular, created.id, { action: 'approve', expectedVersion: 1, reason: 'Aprovando meu próprio pedido.' }, deps),
    { code: 'PTRP_ADJUSTMENT_SELF_DECISION' });
  assert.deepEqual((await listAdjustmentsForReview(reviewer, deps)).adjustments.map((item) => item.id).includes(created.id), true);
  await assert.rejects(listAdjustmentsForReview(titular, deps), { code: 'PTRP_ADJUSTMENT_REVIEW_FORBIDDEN' });
  const approved = await decideAdjustment(reviewer, created.id, { action: 'approve', expectedVersion: 1, reason: 'Conferido com a gerente da unidade.' }, deps);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.acts[1].previousHash, approved.acts[0].hash);
  assert.equal(approved.decidedBy, reviewerId);
  await assert.rejects(decideAdjustment(reviewer, created.id, { action: 'reject', expectedVersion: 2, reason: 'Tarde demais para recusar.' }, deps),
    { code: 'PTRP_ADJUSTMENT_NOT_PENDING' });

  const treatments = (await hrDbAdmin.collection(TREATMENTS).where('adjustmentId', '==', created.id).get()).docs.map((doc) => doc.data());
  assert.deepEqual(treatments.map((item) => item.type).sort(), ['discard', 'inclusion']);
  assert.equal(treatments.find((item) => item.type === 'discard').originalNsr, 7);
  assert.equal((await hrDbAdmin.collection('repP_receipts').doc(receiptId).get()).get('snapshot').markedAt, `${workDate}T13:14:00-0300`);
  const own = await listOwnAdjustments(titular, { month: '2026-10' }, deps);
  assert.equal(own.treatments.length, 2);
  assert.equal(treatments[0].approvalActHash, approved.acts[1].hash);
  // A cadeia de atos recalcula: cada ato aponta para o código do anterior.
  const { adjustmentActHash, adjustmentPayloadDigest } = await import('../../src/features/dp/time-adjustments/core.ts');
  const [requestedAct, approvedAct] = approved.acts;
  assert.equal(adjustmentActHash(requestedAct.hash, { action: approvedAct.action, actorUid: approvedAct.actorUid, role: approvedAct.role,
    at: approvedAct.at, clockSource: approvedAct.clockSource, reason: approvedAct.reason }, adjustmentPayloadDigest({ id: created.id, status: 'approved' })), approvedAct.hash);
  // Batida já desconsiderada não aceita novo pedido sobre ela.
  await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), workDate, kind: 'discard', targetReceiptId: receiptId,
    reason: 'Pedido de novo sobre a mesma batida.' }, deps), { code: 'PTRP_ADJUSTMENT_ALREADY_TREATED' });
  // Repetir a tentativa com conteúdo diferente é recusado.
  await assert.rejects(createOwnAdjustment(titular, { attemptId, workDate, kind: 'correct', targetReceiptId: receiptId,
    newTime: '13:45', reason: 'Bati antes de voltar do intervalo; voltei às 13:30.' }, deps), { code: 'PTRP_ADJUSTMENT_ATTEMPT_CONFLICT' });
  // Pedido pendente numa competência que fecha não pode mais ser decidido.
  const pending = await createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-10-15', kind: 'include', newTime: '08:00',
    reason: 'Esqueci de bater a entrada.' }, deps);
  await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-10`).set({ status: 'closed' });
  await assert.rejects(decideAdjustment(reviewer, pending.id, { action: 'approve', expectedVersion: 1, reason: 'Conferido com a gerente.' }, deps),
    { code: 'PTRP_COMPETENCE_CLOSED' });
  await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-10`).delete();

  // Competência fechada não aceita pedido.
  await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-09`).set({ status: 'closed' });
  await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-09-10', kind: 'include', newTime: '08:00',
    reason: 'Esqueci de bater a entrada.' }, deps), { code: 'PTRP_COMPETENCE_CLOSED' });
});
