import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { repPDbAdmin } = await import('../../src/lib/firebase-rep-p-admin.ts');
const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { createOwnAdjustment, decideAdjustment, listAdjustmentsForReview, listOwnAdjustments, TREATMENTS, CLOSURES }
  = await import('../../src/features/dp/time-adjustments/service.server.ts');
const { classifyOwnRepPMarking } = await import('../../src/features/dp/rep-p/service.server.ts');

test('ajuste agrupado só aparece e só pode ser decidido por quem acessa todas as unidades', async () => {
  const prefix = `multiunit-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const reviewerId = `${prefix}-reviewer`;
  const unitA = `${prefix}-a`; const unitB = `${prefix}-b`;
  const adjustmentId = `${prefix}-adjustment`;
  const permissions = structuredClone(defaultGuestPermissions); permissions.dp.requests.review = true;
  const reviewer = { decoded: { uid: reviewerId }, userDoc: { id: reviewerId, unitIds: [unitA] }, profileId: null,
    permissions, isDefaultAdmin: false, workspace_id: workspaceId };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, clock: { async read() { return { instant: new Date() }; } } };
  await hrDbAdmin.collection('ptrp_adjustmentRequests').doc(adjustmentId).set({
    id: adjustmentId, workspaceId, employeeUid: `${prefix}-employee`, employeeName: 'Maria', workDate: '2026-08-12',
    kind: 'include', status: 'in_review', version: 1, establishmentId: `${prefix}-establishment`, unitId: unitA,
    unitIds: [unitA, unitB], target: null, inclusion: null,
    operations: [{ kind: 'include', target: null, inclusion: { markedAt: '2026-08-12T08:00:00-0300', executionUnitId: unitA } },
      { kind: 'include', target: null, inclusion: { markedAt: '2026-08-12T12:00:00-0300', executionUnitId: unitB } }],
    reason: 'Duas inclusões em unidades diferentes.', aejReason: 'Duas inclusões em unidades diferentes.', acts: [],
    createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
  });
  assert.equal((await listAdjustmentsForReview(reviewer, deps)).adjustments.some((item) => item.id === adjustmentId), false);
  await assert.rejects(() => decideAdjustment(reviewer, adjustmentId,
    { action: 'reject', expectedVersion: 1, reason: 'Não deveria poder decidir este pedido.' }, deps),
  { code: 'PTRP_ADJUSTMENT_REVIEW_FORBIDDEN' });
});

test('classificação é idempotente, respeita a versão fechada e nunca aprova pedido de outra versão', async () => {
  const prefix = `classification-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const employeeId = `${prefix}-employee`;
  const reviewerId = `${prefix}-reviewer`;
  const unitId = `${prefix}-unit`;
  const workDate = '2026-08-12';
  const receiptId = `${prefix}-receipt`;
  const closureRef = hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-08`);
  const receiptRef = repPDbAdmin.collection('repP_receipts').doc(receiptId);
  const classificationRef = hrDbAdmin.collection('ptrp_markingClassifications').doc(receiptId);
  const owner = { decoded: { uid: employeeId }, userDoc: { id: employeeId, username: 'Maria', unitIds: [unitId] }, profileId: null,
    permissions: structuredClone(defaultGuestPermissions), isDefaultAdmin: false, workspace_id: workspaceId };
  const permissions = structuredClone(defaultGuestPermissions); permissions.dp.requests.review = true;
  const reviewer = { decoded: { uid: reviewerId }, userDoc: { id: reviewerId, unitIds: [unitId] }, profileId: null,
    permissions, isDefaultAdmin: false, workspace_id: workspaceId };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, clock: { async read() { return { instant: new Date() }; } } };
  await Promise.all([
    receiptRef.set({ workspaceId, employeeId, recordedDate: workDate, status: 'issued', snapshot: {
      nsr: 17, markedAt: `${workDate}T08:00:00-0300`, executionUnitId: unitId,
    } }),
    closureRef.set({ workspaceId, competence: '2026-08', status: 'closed', version: 2 }),
  ]);

  assert.equal((await classifyOwnRepPMarking(owner, receiptId, { purpose: 'break_start' }, deps)).changeStatus, 'in_review');
  assert.equal((await classifyOwnRepPMarking(owner, receiptId, { purpose: 'break_start' }, deps)).changeStatus, 'in_review');
  let queue = await listAdjustmentsForReview(reviewer, deps);
  let request = queue.classificationRequests.find((item) => item.receiptId === receiptId);
  assert.equal(request?.version, 1, 'retry idêntico não cria outro ato');
  const firstRequestId = request.id;
  await decideAdjustment(reviewer, request.id, { action: 'approve', expectedVersion: request.version, reason: 'Classificação conferida com o colaborador.' }, deps);
  assert.equal((await classificationRef.get()).get('classification').purpose, 'break_start');
  assert.equal((await receiptRef.get()).get('classification'), undefined, 'a reclassificação não altera a ARP');

  await classifyOwnRepPMarking(owner, receiptId, { purpose: 'journey_end' }, deps);
  await classifyOwnRepPMarking(owner, receiptId, { purpose: 'journey_end' }, deps);
  queue = await listAdjustmentsForReview(reviewer, deps);
  request = queue.classificationRequests.find((item) => item.receiptId === receiptId);
  assert.equal(request?.version, 1, 'nova finalidade cria uma versão imutável uma vez');
  assert.notEqual(request?.id, firstRequestId);
  const firstRequest = await hrDbAdmin.collection('ptrp_markingClassificationRequests').doc(firstRequestId).get();
  assert.equal(firstRequest.get('status'), 'approved');
  assert.equal(firstRequest.get('decisionReason'), 'Classificação conferida com o colaborador.');
  const supersededRequestId = request.id;
  assert.equal((await classifyOwnRepPMarking(owner, receiptId, { purpose: 'break_start' }, deps)).changeStatus, 'applied');
  assert.equal((await hrDbAdmin.collection('ptrp_markingClassificationRequests').doc(supersededRequestId).get()).get('status'), 'superseded');
  await classifyOwnRepPMarking(owner, receiptId, { purpose: 'journey_end' }, deps);
  queue = await listAdjustmentsForReview(reviewer, deps);
  request = queue.classificationRequests.find((item) => item.receiptId === receiptId);
  await closureRef.set({ status: 'open', version: 2 }, { merge: true });
  await assert.rejects(() => decideAdjustment(reviewer, request.id,
    { action: 'approve', expectedVersion: request.version, reason: 'Tentativa contra fechamento reaberto.' }, deps), /fechamento mudou/i);
  await classificationRef.set({ history: Array.from({ length: 105 }, (_, index) => ({ purpose: 'journey_start', index })) }, { merge: true });
  assert.equal((await classifyOwnRepPMarking(owner, receiptId, { purpose: 'journey_end' }, deps)).changeStatus, 'applied');
  const finalClassification = await classificationRef.get();
  assert.equal(finalClassification.get('classification').purpose, 'journey_end');
  assert.equal(finalClassification.get('history').length, 100, 'histórico fica limitado');
  assert.equal((await hrDbAdmin.collection('ptrp_markingClassificationRequests').doc(request.id).get()).get('status'), 'superseded');
});

test('ajuste de ponto: titular pede, outro decide com justificativa, original fica e o tratamento é criado', async () => {
  const prefix = `ptrp-${randomUUID().slice(0, 6)}`;
  const workspaceId = 'coala-one';
  const userId = `${prefix}-employee`;
  const reviewerId = `${prefix}-reviewer`;
  const unitId = `${prefix}-unit`;
  const workDate = '2026-10-16';
  const clock = { async read() { return { instant: new Date('2026-10-17T12:00:00.000Z') }; } };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, clock };
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
  await repPDbAdmin.collection('repP_receipts').doc(receiptId).set({ workspaceId, employeeId: userId, recordedDate: workDate,
    status: 'issued', snapshot: { nsr: 7, markedAt: `${workDate}T13:14:00-0300`, executionUnitId: unitId } });

  // Horário errado: desconsidera a 13:14 e inclui 13:30, com justificativa.
  const attemptId = randomUUID();
  const payload = { attemptId, workDate, kind: 'correct', targetReceiptId: receiptId,
    newTime: '13:30', reason: 'Bati antes de voltar do intervalo; voltei às 13:30.' };
  const [created, concurrentReplay] = await Promise.all([
    createOwnAdjustment(titular, payload, deps), createOwnAdjustment(titular, payload, deps),
  ]);
  assert.equal(concurrentReplay.id, created.id, 'duas requisições idênticas concorrentes convergem no mesmo pedido');
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
  assert.equal((await repPDbAdmin.collection('repP_receipts').doc(receiptId).get()).get('snapshot').markedAt, `${workDate}T13:14:00-0300`);
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
  const pilotOnPendingDay = hrDbAdmin.collection('repP_pilotMarkings').doc(`${prefix}-pilot-pending`);
  await pilotOnPendingDay.set({ workspaceId, employeeId: userId, recordedDate: '2026-10-15' });
  await assert.rejects(decideAdjustment(reviewer, pending.id, { action: 'approve', expectedVersion: 1, reason: 'Conferido com a gerente.' }, deps),
    { code: 'PTRP_PILOT_DAY_ADJUSTMENT_FORBIDDEN' });
  await pilotOnPendingDay.delete();
  await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-10`).set({ status: 'closed' });
  await assert.rejects(decideAdjustment(reviewer, pending.id, { action: 'approve', expectedVersion: 1, reason: 'Conferido com a gerente.' }, deps),
    { code: 'PTRP_COMPETENCE_CLOSED' });
  await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-10`).delete();

  const pilotDay = hrDbAdmin.collection('repP_pilotMarkings').doc(`${prefix}-pilot-create`);
  await pilotDay.set({ workspaceId, employeeId: userId, recordedDate: '2026-10-14' });
  await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-10-14', kind: 'include', newTime: '08:00',
    reason: 'A API também deve bloquear inclusão sem alvo no dia de ensaio.' }, deps),
  { code: 'PTRP_PILOT_DAY_ADJUSTMENT_FORBIDDEN' });
  await pilotDay.delete();

  // Uma batida que entra depois da consulta inicial ainda é percebida dentro da transação de criação.
  let releaseClock;
  let announceClock;
  const clockReleased = new Promise((resolve) => { releaseClock = resolve; });
  const clockReached = new Promise((resolve) => { announceClock = resolve; });
  const concurrentPilotDay = hrDbAdmin.collection('repP_pilotMarkings').doc(`${prefix}-pilot-concurrent-create`);
  const concurrentCreation = createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-10-13', kind: 'include', newTime: '08:00',
    reason: 'A transação deve perceber a batida criada durante a solicitação.' }, { ...deps, clock: { async read() {
      announceClock();
      await clockReleased;
      return { instant: new Date('2026-10-17T12:00:00.000Z') };
    } } });
  await clockReached;
  await concurrentPilotDay.set({ workspaceId, employeeId: userId, recordedDate: '2026-10-13' });
  releaseClock();
  await assert.rejects(concurrentCreation, { code: 'PTRP_PILOT_DAY_ADJUSTMENT_FORBIDDEN' });
  await concurrentPilotDay.delete();

  // A aprovação também relê a trava: uma reserva concorrente do domínio piloto vence a decisão formal.
  const approvalRaceDate = '2026-10-12';
  const approvalRace = await createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: approvalRaceDate,
    kind: 'include', newTime: '08:00', reason: 'Pedido usado para provar exclusão mútua na aprovação.' }, deps);
  const { repPPilotDayGuardId } = await import('../../src/features/dp/rep-p/service.server.ts');
  const approvalRaceGuard = hrDbAdmin.collection('repP_pilotDayGuards')
    .doc(repPPilotDayGuardId(workspaceId, userId, approvalRaceDate));
  let releaseApprovalClock;
  let announceApprovalClock;
  const approvalClockReleased = new Promise((resolve) => { releaseApprovalClock = resolve; });
  const approvalClockReached = new Promise((resolve) => { announceApprovalClock = resolve; });
  const concurrentApproval = decideAdjustment(reviewer, approvalRace.id,
    { action: 'approve', expectedVersion: 1, reason: 'A aprovação deve perder para o domínio piloto.' }, { ...deps, clock: { async read() {
      announceApprovalClock();
      await approvalClockReleased;
      return { instant: new Date('2026-10-17T12:00:00.000Z') };
    } } });
  await approvalClockReached;
  await approvalRaceGuard.set({ schemaVersion: 1, mode: 'pilot', domain: 'pilot', workspaceId,
    employeeId: userId, workDate: approvalRaceDate, updatedAt: new Date().toISOString() });
  releaseApprovalClock();
  await assert.rejects(concurrentApproval, { code: 'PTRP_PILOT_DAY_ADJUSTMENT_FORBIDDEN' });
  await approvalRaceGuard.delete();

  // Competência fechada não aceita pedido.
  await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-09`).set({ status: 'closed' });
  await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-09-10', kind: 'include', newTime: '08:00',
    reason: 'Esqueci de bater a entrada.' }, deps), { code: 'PTRP_COMPETENCE_CLOSED' });
});
