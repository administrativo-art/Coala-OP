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
const { createOwnAdjustment, decideAdjustment, listAdjustmentsForReview, listOwnAdjustments, ADJUSTMENTS, TREATMENTS, CLOSURES, PILOT_ADJUSTMENTS }
  = await import('../../src/features/dp/time-adjustments/service.server.ts');
const { classifyOwnRepPMarking } = await import('../../src/features/dp/rep-p/service.server.ts');
const { readAdjustmentDayContext } = await import('../../src/features/dp/time-adjustments/day-context.server.ts');

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
  titular.permissions.app.timeRecording.mark = true;
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

test('ajuste do ensaio percorre solicitação e decisão sem criar tratamento ou tocar o fechamento', async () => {
  const prefix = `pilot-adjustment-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const userId = `${prefix}-employee`;
  const reviewerId = `${prefix}-reviewer`;
  const unitId = `${prefix}-unit`;
  const workDate = '2026-10-11';
  const admin = { decoded: { uid: `${prefix}-admin` }, userDoc: { id: `${prefix}-admin` }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const titular = { decoded: { uid: userId }, userDoc: { id: userId, username: 'Maria', unitIds: [unitId] }, profileId: null,
    permissions: structuredClone(defaultGuestPermissions), isDefaultAdmin: false, workspace_id: workspaceId };
  titular.permissions.app.timeRecording.mark = true;
  const reviewerPermissions = structuredClone(defaultGuestPermissions); reviewerPermissions.dp.requests.review = true;
  const reviewer = { decoded: { uid: reviewerId }, userDoc: { id: reviewerId, unitIds: [unitId] }, profileId: null,
    permissions: reviewerPermissions, isDefaultAdmin: false, workspace_id: workspaceId };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin,
    clock: { async read() { return { instant: new Date('2026-10-12T12:00:00.000Z') }; } },
    officialMarkingEnabled: false, pilotEnabled: true, pilotUserIds: new Set([userId]) };
  await Promise.all([
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Quiosque piloto', address: 'Rua do ensaio, 1',
      cnpj: '14276603000125', timeZone: 'America/Fortaleza' }),
    dbAdmin.collection('users').doc(userId).set({ isActive: true, unitId, unitIds: [unitId] }),
  ]);
  await publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: `${prefix}-ref`, periods: [{
    validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId: unitId, unitId, unitIds: [unitId],
    jobFunctionIds: [], sourceDocumentId: 'admission', sourceReason: 'Vínculo do ensaio de ajuste' }] });
  const receiptId = `pilot_${'a'.repeat(58)}${prefix.slice(-6)}`.slice(0, 70);
  await hrDbAdmin.collection('repP_pilotMarkings').doc(receiptId).set({ workspaceId, employeeId: userId,
    recordedDate: workDate, workDate, markedAt: `${workDate}T08:00:00-0300`, executionUnitId: unitId, sequence: 4, mode: 'pilot' });
  await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-10`).set({ workspaceId, status: 'closed', version: 1 });

  const pilotPayload = { attemptId: randomUUID(), scope: 'pilot', workDate, kind: 'correct',
    targetReceiptId: receiptId, newTime: '08:05', reason: 'Simulação para conferir todo o fluxo do DP.' };
  await assert.rejects(createOwnAdjustment(titular, pilotPayload, { ...deps, pilotEnabled: false }),
    { code: 'REP_P_PILOT_ADJUSTMENT_FORBIDDEN' });
  await assert.rejects(createOwnAdjustment(titular, pilotPayload, { ...deps, officialMarkingEnabled: true }),
    { code: 'REP_P_PILOT_ADJUSTMENT_FORBIDDEN' });
  await assert.rejects(createOwnAdjustment(titular, pilotPayload, { ...deps, pilotUserIds: new Set() }),
    { code: 'REP_P_PILOT_ADJUSTMENT_FORBIDDEN' });
  const titularWithoutMarking = { ...titular, permissions: structuredClone(defaultGuestPermissions) };
  await assert.rejects(createOwnAdjustment(titularWithoutMarking, pilotPayload, deps),
    { code: 'REP_P_PILOT_ADJUSTMENT_FORBIDDEN' });

  // O servidor resolve o domínio: cliente antigo (sem scope) ou adulterado (official) não cria ajuste fiscal no piloto.
  const omittedScope = await createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-10-09',
    kind: 'include', newTime: '08:00', reason: 'Cliente antigo durante o ensaio nominal.' }, deps);
  const forgedOfficialScope = await createOwnAdjustment(titular, { attemptId: randomUUID(), scope: 'official', workDate: '2026-10-08',
    kind: 'include', newTime: '08:00', reason: 'Cliente adulterado tentando selecionar o domínio fiscal.' }, deps);
  assert.equal(omittedScope.scope, 'pilot');
  assert.equal(forgedOfficialScope.scope, 'pilot');
  assert.equal((await hrDbAdmin.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId).get()).empty, true);
  assert.equal((await hrDbAdmin.collection(TREATMENTS).where('workspaceId', '==', workspaceId).get()).empty, true);
  await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), scope: 'pilot', workDate: '2026-11-01',
    kind: 'include', newTime: '08:00', reason: 'Tentativa de ensaio na data do corte oficial.' }, deps),
  { code: 'REP_P_PILOT_CUTOVER_REACHED' });

  const officialWorkDate = '2026-10-10';
  const officialReceipt = `${prefix}-official-receipt`;
  await repPDbAdmin.collection('repP_receipts').doc(officialReceipt).set({ workspaceId, employeeId: userId,
    recordedDate: officialWorkDate, status: 'issued', snapshot: { nsr: 31, markedAt: `${officialWorkDate}T08:00:00-0300`, executionUnitId: unitId } });
  await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), scope: 'pilot', workDate: officialWorkDate,
    kind: 'include', newTime: '08:05', reason: 'Requisição adulterada sobre um dia oficial.' }, deps),
  { code: 'REP_P_PILOT_ADJUSTMENT_DAY_FORBIDDEN' });

  const { repPPilotDayGuardId } = await import('../../src/features/dp/rep-p/service.server.ts');
  const guard = hrDbAdmin.collection('repP_pilotDayGuards').doc(repPPilotDayGuardId(workspaceId, userId, workDate));
  await guard.set({ schemaVersion: 1, mode: 'official', domain: 'adjustment', workspaceId, employeeId: userId, workDate });
  await assert.rejects(createOwnAdjustment(titular, pilotPayload, deps), { code: 'REP_P_ADJUSTMENT_DAY_DOMAIN_CONFLICT' });
  await guard.delete();

  const created = await createOwnAdjustment(titular, pilotPayload, deps);
  assert.equal(created.scope, 'pilot');
  assert.equal(created.status, 'in_review');
  assert.equal(created.target.pilotSequence, 4);
  assert.equal(created.target.nsr, undefined);
  assert.equal((await listOwnAdjustments(titular, { month: '2026-10' }, deps)).adjustments.some((item) => item.id === created.id), true);
  assert.equal((await listAdjustmentsForReview(reviewer, deps)).adjustments.some((item) => item.id === created.id), true);

  const approved = await decideAdjustment(reviewer, created.id,
    { action: 'approve', expectedVersion: 1, reason: 'Simulação conferida pelo responsável do DP.' }, deps);
  assert.equal(approved.scope, 'pilot');
  assert.equal(approved.status, 'approved');
  assert.equal((await hrDbAdmin.collection(PILOT_ADJUSTMENTS).doc(created.id).get()).get('status'), 'approved');
  assert.equal((await hrDbAdmin.collection(TREATMENTS).where('adjustmentId', '==', created.id).get()).empty, true);
  assert.equal((await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2026-10`).get()).get('version'), 1);
  await assert.rejects(createOwnAdjustment(titular, { ...pilotPayload, newTime: '08:10' }, deps),
    { code: 'PTRP_ADJUSTMENT_ATTEMPT_CONFLICT' });
});

test('dia inteiro do pedido: batidas, tratamentos aprovados e histórico, só para quem analisa o pedido de outra pessoa', async () => {
  const prefix = `day-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const employeeId = `${prefix}-employee`;
  const reviewerId = `${prefix}-reviewer`;
  const unitId = `${prefix}-unit`;
  const workDate = '2026-08-12';
  const permissions = structuredClone(defaultGuestPermissions); permissions.dp.requests.review = true;
  const actor = (uid, units, workspace = workspaceId, granted = permissions) => ({ decoded: { uid }, userDoc: { id: uid, unitIds: units }, profileId: null,
    permissions: granted, isDefaultAdmin: false, workspace_id: workspace });
  const reviewer = actor(reviewerId, [unitId]);
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin };
  const request = (id, status, date) => hrDbAdmin.collection(ADJUSTMENTS).doc(id).set({
    id, workspaceId, employeeUid: employeeId, employeeName: 'Maria', workDate: date, kind: 'correct', status, version: 1,
    establishmentId: `${prefix}-est`, unitId, target: null, inclusion: null, reason: 'Teste do dia inteiro.', aejReason: 'Teste do dia inteiro.',
    acts: [], createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z',
  });
  const receipt = (id, nsr, time, collectorId) => repPDbAdmin.collection('repP_receipts').doc(id).set({ workspaceId, employeeId, recordedDate: workDate, status: 'issued',
    snapshot: { nsr, markedAt: `${workDate}T${time}:00-0300`, executionUnitId: unitId, collectorId } });
  await Promise.all([
    dbAdmin.collection('users').doc(employeeId).set({ username: 'Maria', employmentRelationshipType: 'internship' }),
    request(`${prefix}-main`, 'in_review', workDate),
    request(`${prefix}-same-day`, 'approved', workDate),
    request(`${prefix}-earlier`, 'approved', '2026-08-05'),
    receipt(`${prefix}-r2`, 5, '10:01', '02'),
    receipt(`${prefix}-r1`, 4, '05:58', '01'),
    hrDbAdmin.collection(TREATMENTS).doc(`${prefix}-treatment`).set({ workspaceId, employeeUid: employeeId, workDate, status: 'active',
      adjustmentId: `${prefix}-same-day`, type: 'discard', originalReceiptId: `${prefix}-r2` }),
    hrDbAdmin.collection(TREATMENTS).doc(`${prefix}-cancelled`).set({ workspaceId, employeeUid: employeeId, workDate, status: 'cancelled',
      adjustmentId: 'x', type: 'discard', originalReceiptId: `${prefix}-r1` }),
  ]);

  const day = await readAdjustmentDayContext(reviewer, `${prefix}-main`, deps);
  assert.equal(day.scope, 'official');
  assert.equal(day.workDate, workDate);
  assert.deepEqual(day.markings.map((item) => [item.nsr, item.channel]), [[4, 'app'], [5, 'web']]);
  assert.deepEqual(day.treatments.map((item) => [item.type, item.originalReceiptId]), [['discard', `${prefix}-r2`]]);
  assert.deepEqual(day.history, { otherRequestsSameDay: 1, approvedInPrevious30Days: 1 });
  assert.deepEqual(day.shifts, []);
  assert.equal(day.relationship, 'internship');

  await assert.rejects(() => readAdjustmentDayContext(actor(reviewerId, [`${prefix}-other-unit`]), `${prefix}-main`, deps), { code: 'PTRP_ADJUSTMENT_REVIEW_FORBIDDEN' });
  await assert.rejects(() => readAdjustmentDayContext(actor(`${prefix}-nobody`, [unitId], workspaceId, structuredClone(defaultGuestPermissions)), `${prefix}-main`, deps), { code: 'PTRP_ADJUSTMENT_REVIEW_FORBIDDEN' });
  await assert.rejects(() => readAdjustmentDayContext(actor(employeeId, [unitId]), `${prefix}-main`, deps), { code: 'PTRP_ADJUSTMENT_SELF_DECISION' });
  await assert.rejects(() => readAdjustmentDayContext(actor(reviewerId, [unitId], `${prefix}-other-ws`), `${prefix}-main`, deps), { code: 'PTRP_ADJUSTMENT_NOT_FOUND' });
  await assert.rejects(() => readAdjustmentDayContext(reviewer, `${prefix}-missing`, deps), { code: 'PTRP_ADJUSTMENT_NOT_FOUND' });

  // Simulação do ensaio: lê as batidas do ensaio (banco coala-rh), com a finalidade declarada, e não há tratamento.
  await Promise.all([
    hrDbAdmin.collection(PILOT_ADJUSTMENTS).doc(`${prefix}-pilot`).set({
      id: `${prefix}-pilot`, workspaceId, employeeUid: employeeId, employeeName: 'Maria', workDate, scope: 'pilot', kind: 'discard', status: 'in_review', version: 1,
      establishmentId: `${prefix}-est`, unitId, target: null, inclusion: null, reason: 'Simulação.', aejReason: 'Simulação.', acts: [],
      createdAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:00.000Z' }),
    hrDbAdmin.collection('repP_pilotMarkings').doc(`pilot_${prefix}`).set({ workspaceId, employeeId, recordedDate: workDate, markedAt: `${workDate}T17:59:00-0300`,
      nsr: 7, sequence: 7, collectorId: '02', executionUnitId: unitId, classification: { purpose: 'journey_end' } }),
  ]);
  const pilot = await readAdjustmentDayContext(reviewer, `${prefix}-pilot`, deps);
  assert.equal(pilot.scope, 'pilot');
  assert.deepEqual(pilot.markings.map((item) => [item.nsr, item.purpose, item.channel]), [[7, 'journey_end', 'web']]);
  assert.deepEqual(pilot.treatments, []);
  // Sem mistura nos dois sentidos: com batida de ensaio no mesmo dia, o pedido oficial continua lendo só as oficiais.
  assert.deepEqual((await readAdjustmentDayContext(reviewer, `${prefix}-main`, deps)).markings.map((item) => item.nsr), [4, 5]);
});

test('turno que passa da meia-noite: com a chave ligada, a saída do dia seguinte é ajustada no dia do turno', async (t) => {
  const previous = process.env.DP_TIME_NIGHT_SHIFT_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.DP_TIME_NIGHT_SHIFT_ENABLED; else process.env.DP_TIME_NIGHT_SHIFT_ENABLED = previous; });
  const prefix = `night-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const userId = `${prefix}-employee`;
  const unitId = `${prefix}-unit`;
  // Turno que começa no último dia do mês e termina no mês seguinte.
  const workDate = '2026-09-30';
  const nextDate = '2026-10-01';
  const clock = { async read() { return { instant: new Date('2026-10-02T12:00:00.000Z') }; } };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, clock };
  const admin = { decoded: { uid: `${prefix}-admin` }, userDoc: { id: `${prefix}-admin` }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const titular = { decoded: { uid: userId }, userDoc: { id: userId, username: 'Maria', unitIds: [unitId] }, profileId: null,
    permissions: structuredClone(defaultGuestPermissions), isDefaultAdmin: false, workspace_id: workspaceId };
  titular.permissions.app.timeRecording.mark = true;
  const schedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
  await Promise.all([
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Quiosque', address: 'Rua fiscal, 1', cnpj: '14276603000125', timeZone: 'America/Fortaleza' }),
    dbAdmin.collection('users').doc(userId).set({ isActive: true, unitId, unitIds: [unitId] }),
    schedule.set({ year: 2026, month: 9, unitId, publicationStatus: 'published', publicationVersion: 1, createdAt: new Date('2026-08-20T12:00:00Z') }),
    schedule.collection('shifts').doc('night').set({ scheduleId: schedule.id, userId, unitId, type: 'work', date: workDate,
      startTime: '18:00', endTime: '00:00', overnight: true }),
  ]);
  await publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: `${prefix}-ref`, periods: [{
    validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId: unitId, unitId, unitIds: [unitId],
    jobFunctionIds: [], sourceDocumentId: 'admission', sourceReason: 'Admissão conferida para o ensaio' }] });
  const receiptId = `${prefix}-receipt`;
  const sameDayReceiptId = `${prefix}-receipt-start`;
  const seed = (id, recordedDate, time, nsr) => repPDbAdmin.collection('repP_receipts').doc(id).set({ workspaceId, employeeId: userId, recordedDate,
    status: 'issued', snapshot: { nsr, markedAt: `${recordedDate}T${time}:00-0300`, executionUnitId: unitId } });
  await Promise.all([seed(sameDayReceiptId, workDate, '18:02', 30), seed(receiptId, nextDate, '01:10', 31)]);
  const request = (overrides) => ({ attemptId: randomUUID(), workDate, reason: 'Saí depois da meia-noite no fechamento do quiosque.', ...overrides });

  process.env.DP_TIME_NIGHT_SHIFT_ENABLED = 'false';
  await assert.rejects(createOwnAdjustment(titular, request({ kind: 'discard', targetReceiptId: receiptId }), deps),
    { code: 'PTRP_ADJUSTMENT_TARGET_INVALID' }, 'desligada, a batida continua valendo só na data civil');

  process.env.DP_TIME_NIGHT_SHIFT_ENABLED = 'true';
  // A mesma batida não pode ser pedida nos dois dias.
  await assert.rejects(createOwnAdjustment(titular, request({ workDate: nextDate, kind: 'discard', targetReceiptId: receiptId }), deps),
    { code: 'PTRP_ADJUSTMENT_TARGET_INVALID' });
  await assert.rejects(createOwnAdjustment(titular, request({ workDate: nextDate, kind: 'include', newTime: '00:40' }), deps),
    { code: 'PTRP_ADJUSTMENT_OTHER_SHIFT' });
  const included = await createOwnAdjustment(titular, request({ kind: 'include', newTime: '00:30' }), deps);
  assert.equal(included.inclusion.markedAt, `${nextDate}T00:30:00-0300`);
  assert.equal(included.workDate, workDate);
  const entry = await createOwnAdjustment(titular, request({ kind: 'include', newTime: '17:55' }), deps);
  assert.equal(entry.inclusion.markedAt, `${workDate}T17:55:00-0300`);
  const corrected = await createOwnAdjustment(titular, request({ kind: 'correct', targetReceiptId: receiptId, newTime: '00:45' }), deps);
  assert.equal(corrected.target.markedAt, `${nextDate}T01:10:00-0300`);
  assert.equal(corrected.inclusion.markedAt, `${nextDate}T00:45:00-0300`);
  await assert.rejects(createOwnAdjustment(titular, request({ kind: 'discard', targetReceiptId: receiptId }), deps),
    { code: 'PTRP_ADJUSTMENT_DUPLICATE' });
});

test('turno que passa da meia-noite: leitores, alertas e falta automática chegam ao mesmo dia', async (t) => {
  const previous = process.env.DP_TIME_NIGHT_SHIFT_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.DP_TIME_NIGHT_SHIFT_ENABLED; else process.env.DP_TIME_NIGHT_SHIFT_ENABLED = previous; });
  const { listRepPMarkingsOfPerson, readClosureMarkings, readRepPMarkingsForMirror } = await import('../../src/features/dp/rep-p/service.server.ts');
  const { readRepPMonthOfPerson } = await import('../../src/features/dp/rep-p/own-month.server.ts');
  const { readWorkDateShifts } = await import('../../src/features/dp/time-bank/work-date.server.ts');
  const { buildMonthView } = await import('../../src/features/dp/rep-p/day-model.ts');
  const { registerOverdueAutomaticAbsences, AUTOMATIC_ABSENCES } = await import('../../src/features/dp/time-adjustments/automatic-absence.server.ts');
  const prefix = `reader-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const uid = `${prefix}-employee`;
  const unitId = `${prefix}-unit`;
  const sources = { mainDb: dbAdmin, hrDb: hrDbAdmin };
  const schedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
  // Mês próprio deste caso, para a varredura da falta automática não alcançar os turnos dos outros.
  const night = schedule.collection('shifts').doc(`${prefix}-night`);
  await Promise.all([
    dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Quiosque', timeZone: 'America/Fortaleza' }),
    dbAdmin.collection('users').doc(uid).set({ isActive: true, unitId, unitIds: [unitId] }),
    schedule.set({ year: 2025, month: 6, unitId, publicationStatus: 'published', publicationVersion: 1, createdAt: new Date('2025-05-20T12:00:00Z') }),
    night.set({ scheduleId: schedule.id, userId: uid, unitId, type: 'work', date: '2025-06-30', startTime: '22:00', endTime: '06:00', overnight: true }),
  ]);
  const seed = (id, recordedDate, time, nsr) => repPDbAdmin.collection('repP_receipts').doc(`${prefix}-${id}`).set({ workspaceId, employeeId: uid, recordedDate,
    status: 'issued', snapshot: { nsr, markedAt: `${recordedDate}T${time}:00-0300`, executionUnitId: unitId, employeeName: 'Maria', employeeCpf: '00000000000' } });
  await seed('exit', '2025-07-01', '06:03', 2);

  const read = async (start, end) => ({
    history: (await listRepPMarkingsOfPerson(workspaceId, uid, { startDate: start, endDate: end }, { repDb: repPDbAdmin, pilotDb: hrDbAdmin, hrDb: hrDbAdmin, mainDb: dbAdmin })).markings.map((item) => item.workDate),
    closure: (await readClosureMarkings(repPDbAdmin, workspaceId, uid, start, end, sources)).map((item) => item.workDate),
    mirror: (await readRepPMarkingsForMirror(workspaceId, uid, start, end, { repDb: repPDbAdmin, ...sources })).markings.map((item) => item.workDate),
  });
  const same = (dates) => ({ history: dates, closure: dates, mirror: dates });
  const june = ['2025-06-01', '2025-06-30'];
  const july = ['2025-07-01', '2025-07-31'];

  process.env.DP_TIME_NIGHT_SHIFT_ENABLED = 'false';
  assert.deepEqual(await read(...june), same([]));
  assert.deepEqual(await read(...july), same(['2025-07-01']));
  assert.equal((await readRepPMonthOfPerson([uid], '2025-06', { db: dbAdmin })).shifts[0].workDateRule, undefined);

  process.env.DP_TIME_NIGHT_SHIFT_ENABLED = 'true';
  assert.deepEqual(await read(...june), same(['2025-06-30']));
  assert.deepEqual(await read(...july), same([]));

  // Só a saída, depois da meia-noite: há batida no dia do turno, então a rotina não lança falta.
  const stats = await registerOverdueAutomaticAbsences(workspaceId, { lookbackDays: 3 }, { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin,
    now: () => new Date('2025-07-03T15:00:00Z') });
  assert.equal(stats.withMarking, 1);
  assert.equal(stats.created, 0);
  assert.equal((await hrDbAdmin.collection(AUTOMATIC_ABSENCES).where('workspaceId', '==', workspaceId).get()).size, 0);

  const incidents = async () => {
    const month = await readRepPMonthOfPerson([uid], '2025-06', { db: dbAdmin });
    return buildMonthView({ month: '2025-06', today: '9999-12-31', shifts: month.shifts,
      markings: await readClosureMarkings(repPDbAdmin, workspaceId, uid, ...june, sources), absences: [] }).find((day) => day.date === '2025-06-30').incidents;
  };
  assert.deepEqual(await incidents(), ['odd'], 'jornada incompleta passa a ser apontada');
  await seed('entry', '2025-06-30', '22:00', 1);
  assert.deepEqual(await incidents(), [], 'jornada completa não trava');
  // Mesmo caminho do fechamento: a jornada completa não gera alerta; sem a saída, gera.
  const { checkPersonAlerts } = await import('../../src/features/dp/time-adjustments/closure-alert-check.server.ts');
  const actor = { decoded: { uid: `${prefix}-admin` }, userDoc: { id: `${prefix}-admin` }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const nightAlerts = async () => (await checkPersonAlerts({ ...sources, repDb: repPDbAdmin }, actor, '2025-06', 0, { uid, absences: [] }, []))
    .filter((item) => item.alert.date === '2025-06-30').map((item) => item.alert.incidents);
  assert.deepEqual(await nightAlerts(), []);
  const exit = repPDbAdmin.collection('repP_receipts').doc(`${prefix}-exit`);
  const exitData = (await exit.get()).data();
  await exit.delete();
  assert.deepEqual(await nightAlerts(), [['odd']]);
  await exit.set(exitData);

  // Turno retirado da escala pela falta automática continua decidindo o dia, até ser restaurado.
  const removed = (await night.get()).data();
  await night.delete();
  const record = hrDbAdmin.collection(AUTOMATIC_ABSENCES).doc(`${prefix}-absence`);
  await record.set({ workspaceId, employeeUid: uid, workDate: '2025-06-30', status: 'active', scheduleSyncStatus: 'removed',
    displacedShifts: [{ scheduleId: schedule.id, shiftId: night.id, shift: removed }] });
  assert.deepEqual((await readWorkDateShifts(workspaceId, uid, '2025-06-30', '2025-06-30', sources)).map((shift) => [shift.date, shift.endTime]), [['2025-06-30', '06:00']]);
  await record.update({ scheduleSyncStatus: 'restored' });
  assert.deepEqual(await readWorkDateShifts(workspaceId, uid, '2025-06-30', '2025-06-30', sources), []);
});

test('turno que passa da meia-noite: o AEJ lê o dia seguinte e não inclui quem só aparece nele', async (t) => {
  const previous = process.env.DP_TIME_NIGHT_SHIFT_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.DP_TIME_NIGHT_SHIFT_ENABLED; else process.env.DP_TIME_NIGHT_SHIFT_ENABLED = previous; });
  const { exportAej } = await import('../../src/features/dp/time-adjustments/aej.server.ts');
  const prefix = `aej-night-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const nightUid = `${prefix}-night-person`;
  const otherUid = `${prefix}-other-person`;
  const unitId = `${prefix}-unit`;
  const admin = { decoded: { uid: `${prefix}-admin` }, userDoc: { id: `${prefix}-admin` }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const schedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
  await Promise.all([
    dbAdmin.collection('users').doc(nightUid).set({ isActive: true, unitId, unitIds: [unitId] }),
    dbAdmin.collection('users').doc(otherUid).set({ isActive: true, unitId, unitIds: [unitId] }),
    schedule.set({ year: 2025, month: 4, unitId, publicationStatus: 'published', publicationVersion: 1, createdAt: new Date('2025-03-20T12:00:00Z') }),
    schedule.collection('shifts').doc(`${prefix}-night`).set({ scheduleId: schedule.id, userId: nightUid, unitId, type: 'work', date: '2025-04-30',
      startTime: '22:00', endTime: '06:00', overnight: true }),
    hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_2025-04`).set({ workspaceId, competence: '2025-04', status: 'closed', version: 1 }),
  ]);
  const punch = (receiptId, nsr, employeeCpf, workDate, time) => ({ receiptId, nsr, employeeCpf, workDate, markedAt: `${workDate}T${time}:00-0300` });
  const all = [punch('a', 1, '52998224725', '2025-04-30', '22:00'), punch('b', 2, '52998224725', '2025-05-01', '06:00'),
    punch('c', 3, '11144477735', '2025-05-01', '08:00')];
  const asked = [];
  const readArp = async (_workspace, establishmentId, startDate, endDate) => {
    asked.push([startDate, endDate]);
    return { profile: { establishmentId, employerCnpj: '14276603000125', employerLegalName: 'Empregador do ensaio LTDA', inpiRegistration: '512026000001', developerCnpj: '14276603000125' },
      timeZone: 'America/Fortaleza', generatedAt: '2025-05-03T09:00:00-0300', markings: all.filter((item) => item.workDate >= startDate && item.workDate <= endDate),
      people: [{ cpf: '52998224725', uid: nightUid, name: 'Pessoa Noturna' }, { cpf: '11144477735', uid: otherUid, name: 'Pessoa de Maio' }] };
  };
  let generation = 0;
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, developerEmail: 'dev@exemplo.com', readArp,
    readIdentity: async () => { throw new Error('sem uso'); }, readBank: async () => ({ days: [] }), readMovements: async () => [],
    sign: async () => ({ bytes: Buffer.from('p7s'), format: 'CAdES', detached: true, certificateCnpj: '14276603000125' }),
    fiscalStore: { async put(path, bytes, contentType, sha256, retainUntilTime) {
      generation += 1; return { bucket: 'fiscal-test', generation: String(generation), retainUntilTime, retentionMode: 'Locked' }; } } };
  const input = { establishmentId: `${prefix}-establishment`, startDate: '2025-04-01', endDate: '2025-04-30' };
  const linesOf = (aej) => Buffer.from(aej.aejBase64, 'base64').toString('latin1').split('\r\n');

  process.env.DP_TIME_NIGHT_SHIFT_ENABLED = 'true';
  const lines = linesOf(await exportAej(admin, input, deps));
  assert.deepEqual(asked.at(-1), ['2025-04-01', '2025-05-01']);
  assert.deepEqual(lines.filter((line) => line.startsWith('03|')), ['03|1|52998224725|Pessoa Noturna']);
  assert.deepEqual(lines.filter((line) => line.startsWith('05|')).map((line) => line.split('|').slice(2, 6).join('|')),
    ['2025-04-30T22:00:00-0300|1|E|001', '2025-05-01T06:00:00-0300|1|S|001']);

  process.env.DP_TIME_NIGHT_SHIFT_ENABLED = 'false';
  const legacy = linesOf(await exportAej(admin, input, deps));
  assert.deepEqual(asked.at(-1), ['2025-04-01', '2025-04-30']);
  assert.equal(legacy.filter((line) => line.startsWith('05|')).length, 1);
});

test('turno que termina às 22h: só leva a regra noturna com a chave ligada e tolerância na jornada', async (t) => {
  const previous = process.env.DP_TIME_NIGHT_TOLERANCE_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.DP_TIME_NIGHT_TOLERANCE_ENABLED; else process.env.DP_TIME_NIGHT_TOLERANCE_ENABLED = previous; });
  const { readRepPMonthOfPerson } = await import('../../src/features/dp/rep-p/own-month.server.ts');
  const prefix = `night22-${randomUUID().slice(0, 6)}`;
  const uid = `${prefix}-employee`;
  const schedule = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
  const shift = (day, journeyId, endTime = '22:00') => schedule.collection('shifts').doc(`${prefix}-${day}`).set({ scheduleId: schedule.id, userId: uid,
    unitId: `${prefix}-unit`, type: 'work', date: `2025-05-${day}`, startTime: '14:00', endTime,
    ...(journeyId ? { journeyResolution: { journeyId: `${prefix}-${journeyId}` } } : {}) });
  await Promise.all([
    dbAdmin.collection('users').doc(uid).set({ isActive: true }),
    dbAdmin.collection('dp_journeys').doc(`${prefix}-with`).set({ toleranceMinutes: 5 }),
    dbAdmin.collection('dp_journeys').doc(`${prefix}-zero`).set({ toleranceMinutes: 0 }),
    dbAdmin.collection('dp_journeys').doc(`${prefix}-absent`).set({}),
    schedule.set({ year: 2025, month: 5, unitId: `${prefix}-unit`, publicationStatus: 'published', publicationVersion: 1, createdAt: new Date('2025-04-20T12:00:00Z') }),
    shift('05', 'with'), shift('06', 'zero'), shift('07', 'absent'), shift('08', null), shift('09', 'with', '21:00'),
  ]);
  const marked = async () => (await readRepPMonthOfPerson([uid], '2025-05', { db: dbAdmin })).shifts
    .filter((item) => item.nightToleranceRule).map((item) => item.date);

  process.env.DP_TIME_NIGHT_TOLERANCE_ENABLED = 'false';
  assert.deepEqual(await marked(), []);
  process.env.DP_TIME_NIGHT_TOLERANCE_ENABLED = 'true';
  assert.deepEqual(await marked(), ['2025-05-05']);
});

