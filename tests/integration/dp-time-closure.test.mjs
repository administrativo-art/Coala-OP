import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { classifyOwnRepPMarking } = await import('../../src/features/dp/rep-p/service.server.ts');
const { assertRepPCompetenceAcceptsMarking, repPCompetenceFenceRef } = await import('../../src/features/dp/rep-p/competence-fence.server.ts');
const { createOwnAdjustment, decideAdjustment, CLOSURES } = await import('../../src/features/dp/time-adjustments/service.server.ts');
const { closeCompetence, readCompetenceClosure, reopenCompetence } = await import('../../src/features/dp/time-adjustments/closure.server.ts');
const { generateMirror, mirrorPdf, readMirrorStatus } = await import('../../src/features/dp/time-adjustments/mirror.server.ts');
const { checkOverdueClosingPackages, finalizeClosingMonth, readClosingPackage, readClosingSummary, sendClosingPackage, syncClosingPackageSignature } = await import('../../src/features/dp/time-adjustments/closing-package.server.ts');
const { PDFDocument } = await import('pdf-lib');
const { exportAej } = await import('../../src/features/dp/time-adjustments/aej.server.ts');
const { TREATMENTS, AEJ_EXPORTS } = await import('../../src/features/dp/time-adjustments/service.server.ts');
const { createBankMovement, generateBankMonth, readBankStatement, reverseBankMovement, settleBankCycle } = await import('../../src/features/dp/time-bank/service.server.ts');

test('fechamento concorrente com classificação converge sem editar diretamente um mês já fechado', async () => {
  const prefix = `closure-classification-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const employeeId = `${prefix}-employee`;
  const unitId = `${prefix}-unit`;
  const competence = '2026-08';
  const workDate = `${competence}-12`;
  const receiptId = `${prefix}-receipt`;
  const clock = { async read() { return { instant: new Date('2026-10-17T12:00:00.000Z') }; } };
  const admin = { decoded: { uid: `${prefix}-admin` }, userDoc: { id: `${prefix}-admin`, unitIds: [unitId] }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const owner = { decoded: { uid: employeeId }, userDoc: { id: employeeId, username: 'Maria', unitIds: [unitId] }, profileId: null,
    permissions: structuredClone(defaultGuestPermissions), isDefaultAdmin: false, workspace_id: workspaceId };
  const closureDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock, readRoster: async () => [] };
  const classificationDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock };
  const receiptRef = hrDbAdmin.collection('repP_receipts').doc(receiptId);
  await receiptRef.set({ workspaceId, employeeId, recordedDate: workDate, status: 'issued', snapshot: {
    nsr: 21, markedAt: `${workDate}T08:00:00-0300`, executionUnitId: unitId,
  } });
  const [closed, classified] = await Promise.allSettled([
    closeCompetence(admin, { competence, expectedVersion: 0 }, closureDeps),
    classifyOwnRepPMarking(owner, receiptId, { purpose: 'journey_start' }, classificationDeps),
  ]);
  assert.equal(classified.status, 'fulfilled');
  const closure = await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_${competence}`).get();
  if (closed.status === 'fulfilled') assert.equal(closure.get('status'), 'closed');
  if (classified.value.changeStatus === 'in_review') {
    assert.equal(closure.get('status'), 'closed');
    assert.equal((await receiptRef.get()).get('classification'), undefined);
  } else {
    assert.equal((await hrDbAdmin.collection('ptrp_markingClassifications').doc(receiptId).get()).get('classification.purpose'), 'journey_start');
    assert.equal((await receiptRef.get()).get('classification'), undefined);
  }
});

function zipEntries(zip) {
  const entries = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameSize = zip.readUInt16LE(offset + 26);
    const extraSize = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameSize + extraSize;
    entries.set(zip.subarray(nameStart, nameStart + nameSize).toString('utf8'), zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

test('fechamento da competência: pendência bloqueia, declaração congela, mês fechado recusa pedido, reabertura gera nova versão', async () => {
  const prefix = `closure-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const userId = `${prefix}-employee`;
  const otherUserId = `${prefix}-other`;
  const unitId = `${prefix}-unit`;
  const competence = '2026-08';
  const clock = { async read() { return { instant: new Date('2026-10-17T12:00:00.000Z') }; } };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock };
  const roster = [{ uid: userId, name: 'Maria' }];
  const closureDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock, readRoster: async () => [...roster] };
  const actor = (uid, permissions, extra = {}) => ({ decoded: { uid }, userDoc: { id: uid, unitIds: [unitId], ...extra }, profileId: null,
    permissions, isDefaultAdmin: false, workspace_id: workspaceId });
  const admin = { ...actor(`${prefix}-admin`, structuredClone(defaultAdminPermissions)), isDefaultAdmin: true };
  const titular = actor(userId, structuredClone(defaultGuestPermissions), { username: 'Maria' });
  const reviewerPermissions = structuredClone(defaultGuestPermissions);
  reviewerPermissions.dp.requests.review = true;
  const reviewer = actor(`${prefix}-reviewer`, reviewerPermissions);
  const closerPermissions = structuredClone(defaultGuestPermissions);
  closerPermissions.dp.timeClosure = { close: true, reopen: false };
  const closer = actor(`${prefix}-closer`, closerPermissions);
  const absenceRef = hrDbAdmin.collection('dp_absenceRequests').doc(`${prefix}-absence`);
  const shiftSwapRef = dbAdmin.collection('dp_shiftSwapRequests').doc(`${prefix}-shift-swap`);
  const fenceRef = repPCompetenceFenceRef(hrDbAdmin, workspaceId, competence);

  try {
    await Promise.all([
      dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Quiosque', address: 'Rua fiscal, 1', cnpj: '14276603000125', timeZone: 'America/Fortaleza' }),
      dbAdmin.collection('users').doc(userId).set({ isActive: true, unitId, unitIds: [unitId] }),
    ]);
    await publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: `${prefix}-ref`, periods: [{
      validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId: unitId, unitId, unitIds: [unitId],
      jobFunctionIds: [], sourceDocumentId: 'admission', sourceReason: 'Admissão conferida para o ensaio' }] });

    // Sem permissão não lê nem fecha; quem só fecha não reabre.
    await assert.rejects(readCompetenceClosure(reviewer, competence, closureDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    await assert.rejects(closeCompetence(closer, { competence: '2026-10', expectedVersion: 0 }, closureDeps), { code: 'PTRP_CLOSURE_TOO_EARLY' });

    const pending = await createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-08-12', kind: 'include', newTime: '08:00',
      reason: 'Esqueci de bater a entrada.' }, deps);
    await absenceRef.set({ id: absenceRef.id, workspaceId, beneficiaryUid: userId, beneficiaryName: 'Maria', status: 'in_review', startDate: '2026-07-30', endDate: '2026-08-02',
      input: { startDate: '2026-07-30', endDate: '2026-08-02', unit: 'day' }, quantity: 4, unit: 'day', typeId: 'medical', typeSnapshot: { name: 'Atestado médico' },
      attachments: [{ id: 'a' }], history: [], reason: 'dado de saúde que não entra na declaração' });
    await shiftSwapRef.set({ schemaVersion: 1, workspaceId, workDate: '2026-08-15', unitId, status: 'pending', version: 1,
      requesterUid: userId, requesterName: 'Maria', targetUid: otherUserId, targetName: 'Outra pessoa', participantUids: [userId, otherUserId],
      offeredShift: { scheduleId: 'schedule', shiftId: 'morning', unitId, unitName: 'Quiosque', date: '2026-08-15', startTime: '08:00', endTime: '16:00',
        shiftDefinitionId: null, shiftName: 'Manhã', occupantUid: userId, occupantName: 'Maria', fingerprint: 'a' },
      requestedShift: { scheduleId: 'schedule', shiftId: 'afternoon', unitId, unitName: 'Quiosque', date: '2026-08-15', startTime: '12:00', endTime: '20:00',
        shiftDefinitionId: null, shiftName: 'Tarde', occupantUid: otherUserId, occupantName: 'Outra pessoa', fingerprint: 'b' },
      reason: 'Compromisso familiar.', createdAt: '2026-08-10T12:00:00.000Z', updatedAt: '2026-08-10T12:00:00.000Z', decidedAt: null,
      events: [{ action: 'submitted', at: '2026-08-10T12:00:00.000Z', actorUid: userId, actorName: 'Maria', declaration: 'Solicito a troca.', evidence: { authenticatedUid: userId } }] });

    const before = await readCompetenceClosure(closer, competence, closureDeps);
    assert.deepEqual(before.pending, { adjustments: 1, absences: 1, shiftSwaps: 1 });
    assert.equal(before.people.length, 2);
    assert.equal(JSON.stringify(before.people).includes('dado de saúde'), false);
    await assert.rejects(closeCompetence(closer, { competence, expectedVersion: 0 }, closureDeps), { code: 'PTRP_CLOSURE_PENDING' });

    await decideAdjustment(reviewer, pending.id, { action: 'approve', expectedVersion: 1, reason: 'Conferido com a gerente da unidade.' }, deps);
    await absenceRef.update({ status: 'approved', approvalOrigin: 'tacit_timeout', decidedAt: '2026-08-05T12:00:00.000Z' });
    await assert.rejects(closeCompetence(closer, { competence, expectedVersion: 0 }, closureDeps), { code: 'PTRP_CLOSURE_PENDING' });
    await shiftSwapRef.update({ status: 'accepted', version: 2, decidedAt: '2026-08-10T13:00:00.000Z', updatedAt: '2026-08-10T13:00:00.000Z',
      events: [{ action: 'submitted', at: '2026-08-10T12:00:00.000Z', actorUid: userId, actorName: 'Maria', declaration: 'Solicito a troca.', evidence: { authenticatedUid: userId } },
        { action: 'accepted', at: '2026-08-10T13:00:00.000Z', actorUid: otherUserId, actorName: 'Outra pessoa', declaration: 'Aceito a troca.', evidence: { authenticatedUid: otherUserId } }] });
    await assert.rejects(closeCompetence(closer, { competence, expectedVersion: 3 }, closureDeps), { code: 'PTRP_CLOSURE_VERSION_CONFLICT' });
    let releaseFence;
    let confirmFence;
    const fenceAcquired = new Promise((resolve) => { confirmFence = resolve; });
    const continueClosure = new Promise((resolve) => { releaseFence = resolve; });
    const closing = closeCompetence(closer, { competence, expectedVersion: 0 }, { ...closureDeps,
      afterFenceAcquired: async () => { confirmFence(); await continueClosure; } });
    await fenceAcquired;
    assert.equal((await fenceRef.get()).get('status'), 'closing');
    await assert.rejects(hrDbAdmin.runTransaction(async (tx) => {
      assertRepPCompetenceAcceptsMarking(await tx.get(fenceRef), workspaceId, competence);
    }), { code: 'REP_P_COMPETENCE_CLOSED' });
    releaseFence();
    const first = await closing;
    assert.equal(first.status, 'closed');
    assert.equal(first.version, 1);
    assert.deepEqual(first.counts, { adjustments: 1, absences: 1, shiftSwaps: 1 });
    assert.equal(first.closedBy, closer.decoded.uid);
    assert.equal(first.clockSource, 'hora_legal');
    assert.match(first.manifestHash, /^[a-f0-9]{64}$/);
    assert.equal(first.changes, null);
    assert.equal((await fenceRef.get()).get('status'), 'closed');
    assert.equal((await fenceRef.get()).get('closureVersion'), 1);

    const frozen = await readCompetenceClosure(closer, competence, closureDeps);
    assert.equal(frozen.people[0].adjustments[0].decidedBy, reviewer.decoded.uid);
    assert.equal(frozen.people[0].absences[0].approval, 'tacit_timeout');
    assert.deepEqual(frozen.people.map((person) => [person.uid, person.shiftSwaps[0]?.status]), [[userId, 'accepted'], [otherUserId, 'accepted']]);
    await assert.rejects(closeCompetence(closer, { competence, expectedVersion: 1 }, closureDeps), { code: 'PTRP_CLOSURE_ALREADY_CLOSED' });
    await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-08-20', kind: 'include', newTime: '08:00',
      reason: 'Esqueci de bater a entrada.' }, deps), { code: 'PTRP_COMPETENCE_CLOSED' });

    await assert.rejects(reopenCompetence(closer, competence, { action: 'reopen', expectedVersion: 1, reason: 'Atestado entregue depois.' }, closureDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    const reopened = await reopenCompetence(admin, competence, { action: 'reopen', expectedVersion: 1, reason: 'Atestado entregue depois do fechamento.' }, closureDeps);
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.reopenings[0].fromVersion, 1);
    assert.equal((await fenceRef.get()).get('status'), 'open');

    const late = await createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-08-20', kind: 'include', newTime: '08:00',
      reason: 'Esqueci de bater a entrada.' }, deps);
    await decideAdjustment(reviewer, late.id, { action: 'reject', expectedVersion: 1, reason: 'Sem registro da presença neste dia.' }, deps);
    roster.push({ uid: otherUserId, name: 'Outra pessoa' });
    const second = await closeCompetence(closer, { competence, expectedVersion: 1 }, closureDeps);
    assert.equal(second.version, 2);
    assert.equal(second.peopleCount, 2);
    assert.deepEqual(second.changes, { added: [`adjustment:${late.id}`], changed: [], removed: [] });
    // A versão anterior continua guardada.
    const versions = await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_${competence}`).collection('versions').get();
    assert.deepEqual(versions.docs.map((doc) => doc.id).sort(), ['1', '2']);

    // Espelho da versão 2: gerado uma vez por pessoa e versão; a assinatura é a do pacote do fechamento.
    await hrDbAdmin.collection('repP_receipts').doc(`${prefix}-r1`).set({ workspaceId, employeeId: userId, recordedDate: '2026-08-12', status: 'issued',
      snapshot: { nsr: 41, markedAt: '2026-08-12T12:00:00-0300', executionUnitId: unitId, collectorId: '01', employeeName: 'Maria Fiscal', employeeCpf: '52998224725',
        employerLegalName: 'Empregador do ensaio LTDA', employerCnpj: '14276603000125' } });
    const mirrorDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock };
    assert.equal((await readMirrorStatus(titular, competence, undefined, mirrorDeps)).mirror, null);
    await assert.rejects(generateMirror(titular, { action: 'generate', competence, expectedVersion: 1 }, mirrorDeps), { code: 'PTRP_CLOSURE_VERSION_CONFLICT' });
    await assert.rejects(generateMirror(reviewer, { action: 'generate', competence, expectedVersion: 2, employeeUid: userId }, mirrorDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    const mirror = await generateMirror(titular, { action: 'generate', competence, expectedVersion: 2 }, mirrorDeps);
    assert.equal(mirror.snapshot.employee.name, 'Maria Fiscal');
    assert.equal(mirror.snapshot.employer.cnpj, '14276603000125');
    const day = mirror.snapshot.days.find((item) => item.date === '2026-08-12');
    assert.deepEqual(day.punches.map((item) => `${item.time}:${item.mark}`), ['08:00:included', '12:00:original']);
    assert.equal(day.pairedMinutes, 240);
    assert.equal(mirror.snapshot.adjustments.length, 2);
    assert.deepEqual([mirror.snapshot.shiftSwaps[0].status, mirror.snapshot.shiftSwaps[0].acts.length], ['accepted', 2]);
    assert.equal(mirror.snapshot.actors[reviewer.decoded.uid], undefined);
    assert.equal((await generateMirror(closer, { action: 'generate', competence, expectedVersion: 2, employeeUid: userId }, mirrorDeps)).snapshotHash, mirror.snapshotHash);
    const pdf = await mirrorPdf(titular, competence, undefined, mirrorDeps);
    assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');
    assert.equal(pdf.filename, 'espelho-ponto-2026-08-v2.pdf');
    await assert.rejects(mirrorPdf(reviewer, competence, userId, mirrorDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });

    // Pacote do fechamento: espelho e contracheque num PDF, e-CNPJ destacado, Autentique para o trabalhador.
    const files = new Map();
    const payslipDoc = await PDFDocument.create();
    payslipDoc.addPage([595, 842]);
    files.set('payslips/agosto.pdf', Buffer.from(await payslipDoc.save()));
    const sent = [];
    const notices = { opened: [], resolved: [] };
    const packageDeps = {
      notices: { open: async (input) => { notices.opened.push(input); }, resolve: async (_ws, keys, onlyThese) => { notices.resolved.push({ keys, onlyThese }); } },
      mainDb: dbAdmin, hrDb: hrDbAdmin, now: () => new Date('2026-10-17T12:00:00.000Z'), mirror: mirrorDeps,
      storage: { async save(path, bytes) { files.set(path, Buffer.from(bytes)); }, async download(path) { if (!files.has(path)) throw new Error('missing'); return files.get(path); } },
      sign: async () => ({ bytes: Buffer.from('p7s'), certificateCnpj: '14276603000125' }),
      createDocument: async (params) => { sent.push(params); return { sandbox: true, document: { id: `${prefix}-autentique`, created_at: '2026-10-17T12:00:01Z', signatures: [] } }; },
      downloadSigned: async () => Buffer.from(sent[0].buffer),
    };
    const packageInput = { action: 'send', competence, expectedVersion: 2, employeeUid: userId };
    await assert.rejects(sendClosingPackage(reviewer, packageInput, packageDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    await assert.rejects(sendClosingPackage(closer, packageInput, packageDeps), { code: 'PTRP_PACKAGE_CONTACT_REQUIRED' });
    await dbAdmin.collection('users').doc(userId).set({ username: 'Maria Fiscal', email: 'maria@exemplo.com' }, { merge: true });
    await assert.rejects(sendClosingPackage(closer, packageInput, packageDeps), { code: 'PTRP_PACKAGE_PAYSLIP_MISSING' });
    const payslipRef = hrDbAdmin.collection('employeeDocuments').doc(`${prefix}-payslip`);
    await payslipRef.set({ employeeId: userId, documentTypeCode: 'PAYSLIP', caseId: `month-${competence}`, status: 'validated', storagePath: 'payslips/agosto.pdf',
      version: 1, deletedAt: null, displayName: 'Contracheque — agosto de 2026' });
    // Sem código de conferência, o contracheque não entra no pacote.
    await assert.rejects(sendClosingPackage(closer, packageInput, packageDeps), { code: 'PTRP_PACKAGE_PAYSLIP_UNVERIFIED' });
    await payslipRef.update({ contentHash: createHash('sha256').update(files.get('payslips/agosto.pdf')).digest('hex') });
    assert.deepEqual((await readClosingPackage(closer, { competence, employeeUid: userId }, packageDeps)).payslip, { documentId: payslipRef.id, name: 'Contracheque — agosto de 2026' });
    const pack = await sendClosingPackage(closer, packageInput, packageDeps);
    assert.deepEqual([pack.status, pack.providerDocumentId, pack.employerSignature.certificateCnpj], ['sent', `${prefix}-autentique`, '14276603000125']);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].signers[0].email, 'maria@exemplo.com');
    assert.equal((await PDFDocument.load(sent[0].buffer)).getPageCount(), pack.bundle.pageCount);
    assert.ok(files.has(pack.employerSignature.storagePath));
    // Segundo envio não manda de novo; a situação aparece no espelho.
    assert.equal((await sendClosingPackage(closer, packageInput, packageDeps)).sentAt, pack.sentAt);
    assert.equal(sent.length, 1);
    assert.equal((await readMirrorStatus(titular, competence, undefined, mirrorDeps)).package.status, 'sent');
    // Recusa chega pela solicitação (webhook genérico) e aparece como recusado.
    const requestRef = hrDbAdmin.collection('hrSignatureRequests').doc(pack.signatureRequestId);
    await requestRef.update({ status: 'rejected' });
    assert.equal((await readClosingPackage(closer, { competence, employeeUid: userId }, packageDeps)).package.status, 'refused');
    await requestRef.update({ status: 'sent' });
    // Webhook: assinado arquiva nos documentos do colaborador, uma vez.
    const signed = await syncClosingPackageSignature({ signatureRequestId: pack.signatureRequestId, eventType: 'document.finished', signedUrl: 'https://api.autentique.com.br/x.pdf', at: '2026-10-18T09:00:00.000Z' }, packageDeps);
    assert.equal(signed.status, 'signed');
    const archived = (await hrDbAdmin.collection('employeeDocuments').doc(signed.archivedDocumentId).get()).data();
    assert.deepEqual([archived.documentTypeCode, archived.employeeId, archived.caseId, archived.signatureStatus], ['TIME_CLOSING_PACKAGE', userId, `month-${competence}`, 'signed']);
    // Política do tipo: automática ao assinar; o pacote assinado entra na pasta do colaborador.
    assert.equal(archived.publication?.status, 'published');
    assert.equal((await syncClosingPackageSignature({ signatureRequestId: pack.signatureRequestId, eventType: 'signature.rejected' }, packageDeps)).status, 'signed');
    // A equipe congelada tem duas pessoas: a ausência de pacote da segunda já impede o fechamento geral.
    await assert.rejects(finalizeClosingMonth(closer, { competence, expectedVersion: 2 }, packageDeps), { code: 'PTRP_FINALIZE_PENDING' });
    assert.deepEqual((await readClosingSummary(closer, competence, packageDeps)).counts, { total: 2, closed: 1, pending: 1, overdue: 0 });
    // Prazo de 24 horas: fechamento individual sem assinatura mantém o geral pendente e abre aviso no sino.
    const otherPack = hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_${competence}`).collection('versions').doc('2').collection('packages').doc(otherUserId);
    await otherPack.set({ schemaVersion: 1, status: 'sent', uid: otherUserId, employeeId: otherUserId, competence, closureVersion: 2,
      signatureRequestId: `${prefix}-other-request`, providerDocumentId: 'x', sentAt: '2026-10-15T00:00:00.000Z', attempts: [] });
    await assert.rejects(finalizeClosingMonth(closer, { competence, expectedVersion: 2 }, packageDeps), { code: 'PTRP_FINALIZE_PENDING' });
    assert.deepEqual((await readClosingSummary(closer, competence, packageDeps)).overdue.map((item) => item.uid), [otherUserId]);
    await checkOverdueClosingPackages(workspaceId, packageDeps);
    assert.equal(notices.opened.length, 1);
    assert.deepEqual([notices.opened[0].audience, notices.opened[0].category, notices.opened[0].path], ['dp.time-closure', 'dp.time-closing', '/dashboard/dp/fechamento']);
    // Só a assinatura fecha a pessoa; não existe mais liberação administrativa sem assinatura.
    await otherPack.update({ status: 'signed', signedAt: '2026-10-20T13:00:00.000Z' });
    await checkOverdueClosingPackages(workspaceId, packageDeps);
    assert.equal(notices.opened.length, 1);
    assert.deepEqual(notices.resolved.at(-1), { keys: [], onlyThese: false });
    const finalization = await finalizeClosingMonth(closer, { competence, expectedVersion: 2 }, packageDeps);
    assert.deepEqual([finalization.people, finalization.signed], [2, 2]);
    assert.equal(notices.resolved.at(-1).onlyThese, true);
    assert.equal((await readClosingSummary(closer, competence, packageDeps)).finalization.at, finalization.at);
    await payslipRef.delete();

    // Banco de horas do mês fechado: jornada de 7h20, turno de 4h com batida incluída, dia escalado sem batida e folga.
    const journeyId = `${prefix}-journey`;
    const scheduleRef = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
    await Promise.all([
      dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1, status: 'published', validFrom: '2026-08-10', cycleLengthDays: 7,
        days: [1, 2, 3, 4, 5, 6, 7].map((dayIndex) => ({ dayIndex, plannedMinutes: dayIndex === 7 ? 0 : 440, isRestDay: dayIndex === 7 })), toleranceMinutes: 5 }),
      dbAdmin.collection('dp_overtimePolicies').doc(`${prefix}-policy`).set({ lineageId: `${prefix}-policy`, version: 1, status: 'published', name: 'Banco do ensaio',
        applicability: { scope: { kind: 'company' }, collaboratorIds: [userId] }, validFrom: '2026-01-01', externalCoverageRule: 'origin',
        categories: [{ id: 'banco', name: 'Banco', trigger: 'workday', ratePercent: 50, destination: 'time_bank', bankCreditFactor: 1, requiresApproval: false }],
        timeBank: { enabled: true, allowNegativeBalance: true, expiredBalanceDestination: 'review', cycle: { unit: 'month', length: 1, anchorDate: '2026-01-01', residualDestination: 'review' } } }),
      scheduleRef.set({ year: 2026, month: 8, unitId, locked: true, createdAt: new Date('2026-07-20T00:00:00Z') }),
    ]);
    const plannedShift = (id, data) => scheduleRef.collection('shifts').doc(id).set({ scheduleId: scheduleRef.id, unitId, userId, type: 'work', startTime: '08:00', endTime: '12:00',
      journeyResolution: { journeyId, lineageId: journeyId, version: 1 }, ...data });
    await Promise.all([plannedShift('a', { date: '2026-08-12' }), plannedShift('b', { date: '2026-08-13' }), plannedShift('c', { date: '2026-08-16', type: 'day_off', startTime: '00:00', endTime: '00:00' })]);
    const bankDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, now: () => new Date('2026-10-17T12:00:00.000Z') };
    await assert.rejects(generateBankMonth(titular, { action: 'generate', competence, expectedVersion: 1 }, bankDeps), { code: 'PTRP_CLOSURE_VERSION_CONFLICT' });
    await assert.rejects(readBankStatement(reviewer, { employeeUid: userId }, bankDeps), { code: 'PTRP_BANK_SUBJECT_FORBIDDEN' });
    const pendingStatement = await readBankStatement(titular, { date: '2026-08-20' }, bankDeps);
    assert.deepEqual([pendingStatement.statement.missing, pendingStatement.closures], [['2026-08'], { '2026-08': 2 }]);
    const bankMonth = await generateBankMonth(titular, { action: 'generate', competence, expectedVersion: 2 }, bankDeps);
    assert.deepEqual(bankMonth.days.filter((item) => item.lines.length).map((item) => [item.date, item.lines.map((line) => `${line.nature}:${line.minutes}:${line.reason}`)]),
      [['2026-08-12', ['bank_debit:200:worked_less']], ['2026-08-13', ['review:440:missing_day']]]);
    // Dia sem batida e sem ausência fica a tratar pelo DP: não entra no saldo. A ausência de 01 e 02/08, sem efeito no tipo, também vai para revisão.
    assert.deepEqual([bankMonth.totals.balance, bankMonth.totals.review, bankMonth.totals.reviewDays], [-200, 440, 3]);
    assert.deepEqual(bankMonth.policies, [{ id: `${prefix}-policy`, version: 1 }]);
    assert.equal((await generateBankMonth(closer, { action: 'generate', competence, expectedVersion: 2, employeeUid: userId }, bankDeps)).generatedAt, bankMonth.generatedAt);
    const statement = (await readBankStatement(closer, { employeeUid: userId, date: '2026-08-20' }, bankDeps)).statement;
    assert.deepEqual([statement.balanceMinutes, statement.debit, statement.missing, statement.ended], [-200, 200, [], true]);
    assert.deepEqual(statement.residual, { minutes: -200, destination: 'review' });
    assert.equal(statement.settlement, null);
    // Dia sem batida a tratar no ciclo bloqueia o encerramento.
    await assert.rejects(settleBankCycle(closer, { action: 'settle', employeeUid: userId, date: '2026-08-31', expectedMinutes: -200 }, bankDeps), { code: 'PTRP_BANK_PENDING_DAYS' });
    // Encerramento do ciclo: só quem fecha, com o residual conferido; uma vez, sem apagar nada.
    await assert.rejects(settleBankCycle(titular, { action: 'settle', employeeUid: userId, date: '2026-08-31', expectedMinutes: -200 }, bankDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });

    // Duas operações diferentes sobre o mesmo saldo não passam juntas; o movimento vencedor também integra o registro 07.
    const concurrent = await Promise.allSettled([1, 2].map((attempt) => createBankMovement(closer, { action: 'movement', operationId: randomUUID(),
      employeeUid: userId, date: '2026-08-20', kind: 'adjustment', minutes: 10, expectedBalance: -200,
      reason: `Ajuste concorrente de ensaio número ${attempt}.` }, bankDeps)));
    assert.equal(concurrent.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter((item) => item.status === 'rejected').length, 1);
    assert.equal((await readBankStatement(closer, { employeeUid: userId, date: '2026-08-20' }, bankDeps)).statement.balanceMinutes, -190);

    // AEJ do estabelecimento: só de competência fechada, com a inclusão aprovada e o motivo do AEJ.
    const treatment = (await hrDbAdmin.collection(TREATMENTS).where('workspaceId', '==', workspaceId).where('employeeUid', '==', userId).limit(1).get()).docs[0].data();
    const readArp = async () => ({ profile: { establishmentId: treatment.establishmentId, employerCnpj: '14276603000125', employerLegalName: 'Empregador do ensaio LTDA',
      inpiRegistration: '512026000001', developerCnpj: '14276603000125' }, timeZone: 'America/Fortaleza', generatedAt: '2026-10-17T09:00:00-0300',
      markings: [{ receiptId: `${prefix}-r1`, nsr: 41, markedAt: '2026-08-12T12:00:00-0300', employeeCpf: '52998224725', workDate: '2026-08-12' }],
      people: [{ cpf: '52998224725', uid: userId, name: 'Maria Fiscal' }] });
    const sign = async () => ({ bytes: Buffer.from('p7s'), format: 'CAdES', detached: true, certificateCnpj: '14276603000125' });
    const readIdentity = async () => ({ cpf: '52998224725', name: 'Maria Fiscal' });
    const fiscalObjects = new Map();
    const fiscalStore = {
      async put(path, bytes, contentType, sha256, retainUntilTime) {
        assert.equal(fiscalObjects.has(path), false); const generation = String(fiscalObjects.size + 1);
        fiscalObjects.set(path, { bytes: Buffer.from(bytes), contentType, sha256, generation, retainUntilTime });
        return { bucket: 'fiscal-test', generation, retainUntilTime, retentionMode: 'Locked' };
      },
    };
    const aejDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, developerEmail: 'dev@exemplo.com', readArp, readIdentity, sign, fiscalStore };
    const input = { establishmentId: treatment.establishmentId, startDate: '2026-08-01', endDate: '2026-08-31' };
    await assert.rejects(exportAej(admin, { ...input, endDate: '2026-09-30' }, aejDeps), { code: 'PTRP_AEJ_COMPETENCE_OPEN' });
    await assert.rejects(exportAej(admin, input, { ...aejDeps, developerEmail: undefined }), { code: 'PTRP_AEJ_DEVELOPER_EMAIL_MISSING' });
    // Batida na ARP sem comprovante catalogado: o AEJ não pode divergir do AFD.
    const orphan = async () => ({ ...(await readArp()), people: [] });
    await assert.rejects(exportAej(admin, input, { ...aejDeps, readArp: orphan }), { code: 'PTRP_AEJ_MARKING_WITHOUT_CATALOG' });
    // Quem só tem inclusão (esqueceu o dia todo) entra pelo cadastro do RH.
    const onlyInclusion = async () => ({ ...(await readArp()), markings: [], people: [] });
    const inclusionOnly = await exportAej(admin, input, { ...aejDeps, readArp: onlyInclusion });
    assert.match(Buffer.from(inclusionOnly.aejBase64, 'base64').toString('latin1'), /03\|1\|52998224725\|Maria Fiscal/);
    await assert.rejects(exportAej(admin, input, { ...aejDeps, readArp: onlyInclusion, readIdentity: async () => { throw new Error('x'); } }), { code: 'PTRP_AEJ_IDENTITY_UNRESOLVED' });
    const aej = await exportAej(admin, input, aejDeps);
    const lines = Buffer.from(aej.aejBase64, 'base64').toString('latin1').split('\r\n');
    assert.deepEqual(lines.filter((line) => line.startsWith('05|')), [
      '05|1|2026-08-12T08:00:00-0300||E|001|I|HC001|Esqueci de bater a entrada.',
      '05|1|2026-08-12T12:00:00-0300|1|S|001|O||',
    ]);
    assert.equal(aej.counts['05'], 2);
    assert.deepEqual(aej.warnings.map((item) => `${item.code}:${item.date}`), ['PENDING_DAY:2026-08-13']);
    // Registro 07: débito do banco por dia e folga como DSR; o dia sem batida ainda não tratado não vira falta ("2").
    assert.deepEqual(lines.filter((line) => line.startsWith('07|')), ['07|1|3|2026-08-12|200|2', '07|1|1|2026-08-16||', '07|1|3|2026-08-20|10|1']);
    const audit = (await hrDbAdmin.collection(AEJ_EXPORTS).where('workspaceId', '==', workspaceId).where('sha256', '==', aej.sha256).get()).docs[0].data();
    assert.equal(audit.sha256, aej.sha256);
    assert.equal(audit.schemaVersion, 2);
    const aejBundle = fiscalObjects.get(audit.artifacts.bundle.storagePath).bytes;
    const aejEntries = zipEntries(aejBundle);
    assert.equal(aejEntries.get(audit.artifacts.content.filename).toString('base64'), aej.aejBase64);
    assert.equal(aejEntries.get(audit.artifacts.signature.filename).toString('base64'), aej.signatureBase64);
    assert.equal(audit.artifacts.retentionYears, 20);
    assert.equal(audit.artifacts.bundle.retentionMode, 'Locked');
    assert.equal(audit.artifacts.bundle.storageBucket, 'fiscal-test');
    assert.deepEqual(audit.closureVersions, { '2026-08': 2 });

    // Uma extra estornada pode ser aprovada de novo por uma nova operação; repetir a mesma operação continua idempotente.
    const policyRef = dbAdmin.collection('dp_overtimePolicies').doc(`${prefix}-policy`);
    const policyRecord = (await policyRef.get()).data();
    await policyRef.update({ categories: policyRecord.categories.map((item) => ({ ...item, requiresApproval: item.id === 'banco' })) });
    const bankRecordRef = hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_${competence}`).collection('versions').doc('2').collection('timeBank').doc(userId);
    const bankRecord = (await bankRecordRef.get()).data();
    await bankRecordRef.update({ days: bankRecord.days.map((item) => item.date === '2026-08-12' ? { ...item,
      lines: [{ nature: 'review', minutes: 60, reason: 'pending_approval', categoryId: 'banco', ratePercent: 50, requiresApproval: true }] } : item) });
    const firstOperationId = randomUUID();
    const firstApproval = await createBankMovement(closer, { action: 'approve_overtime', operationId: firstOperationId,
      employeeUid: userId, date: '2026-08-12', categoryId: 'banco', minutes: 60, reason: 'Extra conferida no ensaio.' }, bankDeps);
    await reverseBankMovement(closer, { action: 'reverse', employeeUid: userId, date: '2026-08-12', movementId: firstApproval.id,
      reason: 'A aprovação precisava ser refeita.' }, bankDeps);
    const secondOperationId = randomUUID();
    const secondApproval = await createBankMovement(closer, { action: 'approve_overtime', operationId: secondOperationId,
      employeeUid: userId, date: '2026-08-12', categoryId: 'banco', minutes: 60, reason: 'Extra reconferida no ensaio.' }, bankDeps);
    assert.notEqual(secondApproval.id, firstApproval.id);
    assert.equal(secondApproval.status, 'active');
    assert.equal((await createBankMovement(closer, { action: 'approve_overtime', operationId: secondOperationId,
      employeeUid: userId, date: '2026-08-12', categoryId: 'banco', minutes: 60, reason: 'Extra reconferida no ensaio.' }, bankDeps)).id, secondApproval.id);
    await assert.rejects(createBankMovement(closer, { action: 'approve_overtime', operationId: secondOperationId,
      employeeUid: userId, date: '2026-08-12', categoryId: 'banco', minutes: 60, reason: 'Payload diferente.' }, bankDeps), { code: 'PTRP_BANK_OPERATION_CONFLICT' });
    await assert.rejects(createBankMovement(closer, { action: 'approve_overtime', operationId: secondOperationId,
      employeeUid: userId, date: '2026-09-12', categoryId: 'banco', minutes: 60, reason: 'Extra reconferida no ensaio.' }, bankDeps), { code: 'PTRP_BANK_OPERATION_CONFLICT' });

    // A liquidação que materializa o encerramento do ciclo não pode ser estornada separadamente.
    const lockedMovementRef = hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_${competence}`).collection('timeBankMovements').doc('locked-payroll');
    await lockedMovementRef.set({ id: lockedMovementRef.id, uid: userId, date: '2026-08-31', competence, status: 'active', kind: 'payroll', minutes: 30,
      reason: 'Liquidação do ciclo.', createdAt: '2026-10-17T12:00:00.000Z', createdBy: closer.decoded.uid,
      settlementCycle: { start: '2026-08-01', end: '2026-08-31' }, line: { nature: 'bank_credit', minutes: 30, reason: 'payroll_settlement' } });
    await assert.rejects(reverseBankMovement(closer, { action: 'reverse', employeeUid: userId, date: '2026-08-31', movementId: lockedMovementRef.id,
      reason: 'Tentativa isolada.' }, bankDeps), { code: 'PTRP_BANK_SETTLEMENT_REVERSAL_FORBIDDEN' });

    // Operador limitado a outra unidade não consegue consultar nem movimentar o banco da pessoa.
    const foreignCloser = actor(`${prefix}-foreign`, closerPermissions, { unitIds: [`${prefix}-foreign-unit`] });
    await assert.rejects(readBankStatement(foreignCloser, { employeeUid: userId, date: '2026-08-20' }, bankDeps), { code: 'PTRP_BANK_SUBJECT_FORBIDDEN' });
    await assert.rejects(readMirrorStatus(foreignCloser, competence, userId, mirrorDeps), { code: 'PTRP_MIRROR_SUBJECT_NOT_FOUND' });
  } finally {
    await Promise.all([absenceRef.delete(), shiftSwapRef.delete()]);
  }
});
