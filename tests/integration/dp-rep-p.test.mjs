import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { Timestamp } = await import('firebase-admin/firestore');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { repPDbAdmin } = await import('../../src/lib/firebase-rep-p-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { classifyOwnRepPMarking, exportOwnRepPReceipts, exportSignedRepPAfd, getOwnRepPReceipt, listOwnRepPExecutionUnits, listOwnRepPMarkings, listPendingRepPReceipts, provisionRepPReferenceData, REP_P_PILOT_CLASSIFICATION_EVENTS,
  issueOwnRepPOfflinePermit, readRepPPilotMarkingsForBank, recordOwnRepPMarking, repPIdentifiersForTest, repPPilotDayGuardId,
  retryOwnRepPReceipt, retryPendingRepPReceipts } = await import('../../src/features/dp/rep-p/service.server.ts');
const { REP_P_LOCATION_EVIDENCE, repPLocationPolicyRef, saveRepPLocationPolicy }
  = await import('../../src/features/dp/rep-p/location-policy.server.ts');
const { readEmployeeTimeRecordingMonth } = await import('../../src/features/dp/rep-p/employee-month.server.ts');
const { runRepPDailyMonitor } = await import('../../src/features/dp/rep-p/monitor.server.ts');
const { recordRepPAvailabilityNotification } = await import('../../src/features/dp/rep-p/availability.server.ts');
const { generateRepPAfd } = await import('../../src/features/dp/rep-p/afd.ts');
const { readRepPForAej, readRepPMarkingsForMirror } = await import('../../src/features/dp/rep-p/service.server.ts');
const { createRepPIcpSigners, loadRepPIcpIdentity, verifyRepPDetachedCms, verifyRepPSignedPdf }
  = await import('../../src/features/dp/rep-p/icp-signer.ts');
const { createTestIcpCredential } = await import('../helpers/rep-p-test-certificate.ts');
const { canonicalRepPOfflineEvent, hashRepPOfflineEvent, repPDeviceKeyId }
  = await import('../../src/features/dp/rep-p/offline.ts');

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

test('ARP atribui NSR atomicamente, faz replay sem duplicar e exporta o mesmo original em AFD assinado', async (t) => {
  const prefix = 'rep-p-integration';
  const workspaceId = 'coala-one';
  const userId = `${prefix}-employee`;
  const employerUnitId = `${prefix}-employer`;
  const executionUnitId = `${prefix}-execution`;
  const cpf = '52998224725';
  const employerCnpj = '14276603000125';
  const establishmentId = repPIdentifiersForTest.establishmentKey(workspaceId, employerCnpj);
  const context = { decoded: { uid: userId }, userDoc: { id: userId }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const employer = dbAdmin.collection('dp_units').doc(employerUnitId);
  const execution = dbAdmin.collection('dp_units').doc(executionUnitId);
  const user = dbAdmin.collection('users').doc(userId);
  const anotherUser = dbAdmin.collection('users').doc(`${prefix}-other-user`);
  const employee = hrDbAdmin.collection('employees').doc(`${prefix}-hr`);
  const cpfField = employee.collection('field_values').doc('employee.cpf');
  const clock = { async read() { return { instant: new Date('2026-10-18T11:15:42.000Z'), source: 'synthetic-hlb-test',
    assurance: 'hlb_verified', observedOffsetMs: 12, verifiedAt: new Date(), attestationId: 'a'.repeat(64),
    attestationMode: 'fresh', quorum: 2, observations: [
      { server: '200.20.186.75', status: 'accepted', offsetMs: 10, roundTripMs: 20, stratum: 1 },
      { server: '200.20.186.94', status: 'accepted', offsetMs: 14, roundTripMs: 22, stratum: 1 },
    ] }; } };
  const profile = { establishmentId, employerCnpj, employerLegalName: 'CT Sorvetes LTDA',
    inpiRegistration: '12345678901234567', developerCnpj: employerCnpj };
  const fiscalObjects = new Map();
  const fiscalStore = {
    async put(path, bytes, contentType, sha256, retainUntilTime) {
      assert.equal(fiscalObjects.has(path), false); const generation = String(fiscalObjects.size + 1);
      fiscalObjects.set(path, { bytes: Buffer.from(bytes), contentType, sha256, generation, retainUntilTime });
      return { bucket: 'fiscal-test', generation, retainUntilTime, retentionMode: 'Locked' };
    },
  };
  const dependencies = { repDb: repPDbAdmin, pilotDb: hrDbAdmin, mainDb: dbAdmin, hrDb: hrDbAdmin, clock,
    markingEnabled: true, officialUserIds: new Set([userId]), fiscalStore,
    signer: { async signDetached(bytes) { assert.ok(bytes.length > 0); return { bytes: Buffer.from('synthetic-cades'),
      format: 'CAdES', detached: true, certificateCnpj: employerCnpj }; } },
    receiptSigner: { async signPdf() { throw new Error('PAdES indisponível no primeiro ensaio'); } } };
  // Certificado autoassinado gerado no teste: exercita a assinatura real sem credencial ICP-Brasil.
  const icpSigners = createRepPIcpSigners(loadRepPIcpIdentity(createTestIcpCredential().pem, employerCnpj));
  const padesSigner = icpSigners.pades;
  const allRefs = [];
  try {
    await assert.rejects(recordOwnRepPMarking(context,
      { attemptId: 'gate-check', workDate: '2026-10-18', executionUnitId, channel: 'browser' },
      { ...dependencies, markingEnabled: false, repDb: { collection() { throw new Error('gate touched database'); } } }),
    { code: 'REP_P_MARKING_DISABLED' });
    const profileWithoutPoint = structuredClone(context);
    profileWithoutPoint.permissions.app.timeRecording.mark = false;
    await assert.rejects(recordOwnRepPMarking(profileWithoutPoint,
      { attemptId: 'profile-gate-check', workDate: '2026-10-18', executionUnitId, channel: 'browser' },
      { ...dependencies, repDb: { collection() { throw new Error('profile gate touched database'); } } }),
    { code: 'REP_P_MARKING_PROFILE_DISABLED' });
    assert.deepEqual(await listOwnRepPExecutionUnits(profileWithoutPoint, { workDate: '2026-10-18' }, {
      ...dependencies, mainDb: { collection() { throw new Error('profile gate touched database'); } },
    }), { workDate: '2026-10-18', eligible: false, markingEnabled: false, mode: 'official', journeyLocationEnabled: false,
      executionUnits: [], officialClock: { available: true, instant: '2026-10-18T11:15:42.000Z', timeZone: 'America/Belem' } });
    await Promise.all([
      employer.set({ name: 'Empregadora', address: 'Rua fiscal, 1', cnpj: employerCnpj, timeZone: 'America/Belem' }),
      // Unidade de execução em outro fuso: a batida grava o fuso dela, não o do estabelecimento.
      execution.set({ name: 'Execução excepcional', address: 'Rua operacional, 2', cnpj: '11222333000181', timeZone: 'America/Manaus' }),
      user.set({ isActive: true, unitId: employerUnitId, unitIds: [employerUnitId, executionUnitId] }),
      anotherUser.set({ isActive: true, unitId: executionUnitId, unitIds: [executionUnitId] }),
      employee.set({ auth_uid: userId, name: 'Maria Teste', bizneo_employee_id: '99' }),
      cpfField.set({ value_text: cpf }),
    ]);
    await publishEmploymentReference(context, { userId, expectedRevision: 0, requestId: 'employment-1', periods: [{
      validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId, unitId: employerUnitId,
      unitIds: [employerUnitId, executionUnitId], jobFunctionIds: [], sourceDocumentId: 'admission-1',
      sourceReason: 'Admissão conferida para o ensaio',
    }] });
    const setup = await provisionRepPReferenceData({ workspaceId, responsibleCpf: cpf, timeZone: 'America/Belem', profile,
      employee: { userId, cpf, name: 'Maria Teste' }, workLocation: 'Rua fiscal, 1' }, dependencies);
    assert.deepEqual(setup, { establishmentId, replayed: false });
    assert.deepEqual(await provisionRepPReferenceData({ workspaceId, responsibleCpf: cpf, timeZone: 'America/Belem', profile,
      employee: { userId, cpf, name: 'Maria Teste' }, workLocation: 'Rua fiscal, 1' }, dependencies),
    { establishmentId, replayed: true });
    await assert.rejects(saveRepPLocationPolicy(context, executionUnitId, {
      expectedRevision: 0, mode: 'observe', center: { latitude: -1.4558, longitude: -48.4902 },
      radiusMeters: 150, maxAccuracyMeters: 100, maxAgeSeconds: 60, captureTimeoutMs: 10_000,
      privacyNoticeUrl: 'https://example.test/privacidade', legalBasisReference: 'Aditivo LGPD aprovado pelo controlador',
      retentionDays: 365, participantUserIds: [userId], activationConfirmation: true,
    }, { mainDb: dbAdmin, repDb: repPDbAdmin }), { code: 'DP_TIME_LOCATION_POLICY_INPUT_INVALID' });
    const savedLocationPolicy = await saveRepPLocationPolicy(context, executionUnitId, {
      expectedRevision: 0, mode: 'observe', center: { latitude: -1.4558, longitude: -48.4902 },
      radiusMeters: 150, maxAccuracyMeters: 100, maxAgeSeconds: 60, captureTimeoutMs: 10_000,
      privacyNoticeUrl: 'https://example.test/privacidade', legalBasisReference: 'Aditivo LGPD aprovado pelo controlador',
      retentionDays: 1_825, participantUserIds: [userId], activationConfirmation: true,
    }, { mainDb: dbAdmin, repDb: repPDbAdmin, now: () => new Date('2026-10-18T10:00:00.000Z') });
    assert.equal(savedLocationPolicy.policy.revision, 1);

    const options = await listOwnRepPExecutionUnits(context, { workDate: '2026-10-18' }, dependencies);
    assert.equal(options.eligible, true);
    assert.equal(options.markingEnabled, true);
    assert.equal(options.mode, 'official');
    // Com a coleta desligada, o atalho da barra superior some: as opções avisam sem esconder o vínculo.
    assert.equal((await listOwnRepPExecutionUnits(context, { workDate: '2026-10-18' }, { ...dependencies, markingEnabled: false })).markingEnabled, false);
    assert.deepEqual(options.officialClock, { available: true, instant: '2026-10-18T11:15:42.000Z', timeZone: 'America/Belem' });
    assert.deepEqual((await listOwnRepPExecutionUnits(context, { workDate: '2026-10-18' }, { ...dependencies,
      clock: { async read() { throw new Error('fonte fora do ar'); } } })).officialClock,
    { available: false, issue: 'REP_P_TIME_UNAVAILABLE' });
    assert.deepEqual(options.executionUnits.map((unit) => [unit.id, unit.employer, unit.timeZone]),
      [[employerUnitId, true, 'America/Belem'], [executionUnitId, false, 'America/Manaus']]);
    assert.equal(options.executionUnits.find((unit) => unit.id === executionUnitId).locationPolicy.mode, 'observe');
    assert.equal(options.executionUnits.find((unit) => unit.id === employerUnitId).locationPolicy.mode, 'disabled');
    assert.deepEqual(await listOwnRepPExecutionUnits({ ...context, decoded: { uid: `${prefix}-nobody` } },
      { workDate: '2026-10-18' }, dependencies), {
      workDate: '2026-10-18', eligible: false, markingEnabled: false, mode: 'official', journeyLocationEnabled: false,
      executionUnits: [], officialClock: { available: true, instant: '2026-10-18T11:15:42.000Z', timeZone: 'America/Belem' },
    });

    const mobileLocation = { captureId: 'capture-mobile', status: 'captured', capturedAt: '2026-10-18T11:15:40.000Z',
      latitude: -1.4558, longitude: -48.4902, accuracyMeters: 12, elapsedMs: 420 };
    const deniedLocation = { captureId: 'capture-browser', status: 'denied', elapsedMs: 15 };
    const [first, second] = await Promise.all([
      recordOwnRepPMarking(context, { attemptId: 'attempt-1', workDate: '2026-10-18', executionUnitId, channel: 'mobile', locationAttempt: mobileLocation }, dependencies),
      recordOwnRepPMarking(context, { attemptId: 'attempt-2', workDate: '2026-10-18', executionUnitId, channel: 'browser', locationAttempt: deniedLocation }, dependencies),
    ]);
    assert.equal(first.status, 'recorded');
    assert.equal(first.marking.markedAt, '2026-10-18T07:15:00-0400');
    assert.equal(second.status, 'recorded');
    assert.deepEqual([first.marking.nsr, second.marking.nsr].sort(), [3, 4]);
    assert.ok(first.marking.employerUnitId === employerUnitId && second.marking.employerUnitId === employerUnitId);
    assert.ok(first.marking.executionUnitId === executionUnitId && second.marking.executionUnitId === executionUnitId);
    assert.deepEqual(first.location, { captureStatus: 'captured', evaluation: 'inside' });
    assert.deepEqual(second.location, { captureStatus: 'denied', evaluation: 'indeterminate' });
    const locationEvidence = await repPDbAdmin.collection(REP_P_LOCATION_EVIDENCE).where('employeeId', '==', userId).get();
    assert.equal(locationEvidence.size, 2);
    const capturedEvidence = locationEvidence.docs.find((doc) => doc.get('capture.status') === 'captured');
    assert.equal(capturedEvidence.get('capture.location.latitude'), mobileLocation.latitude);
    assert.equal(capturedEvidence.get('result.evaluation'), 'inside');
    assert.equal(capturedEvidence.get('policy.retentionDays'), 1_825);
    assert.equal(capturedEvidence.get('policy.participantUserIds'), undefined);
    assert.equal(capturedEvidence.get('expiresAt').toDate().toISOString(), '2031-10-17T11:15:42.000Z');
    // Sem assinador, a batida é gravada e o comprovante fica pendente, nunca indisponível em silêncio.
    assert.equal(first.receiptStatus, 'pending');
    assert.equal(first.receiptId, repPIdentifiersForTest.receiptKey(establishmentId, first.marking.nsr));
    await assert.rejects(getOwnRepPReceipt(context, first.receiptId, dependencies), { code: 'REP_P_RECEIPT_PENDING' });
    const recovered = await retryOwnRepPReceipt(context, first.receiptId, { ...dependencies, receiptSigner: padesSigner });
    assert.deepEqual(recovered, { receiptId: first.receiptId, receiptStatus: 'available', receiptIssue: null });
    const receipt = await getOwnRepPReceipt(context, first.receiptId, dependencies);
    assert.equal(receipt.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(verifyRepPSignedPdf(receipt.bytes), { valid: true, certificateCnpj: employerCnpj });
    assert.equal(receipt.filename, `comprovante-ponto-2026-10-18-nsr-${first.marking.nsr}.pdf`);
    // Reemissão posterior não substitui os bytes já emitidos.
    await retryOwnRepPReceipt(context, first.receiptId, { ...dependencies, receiptSigner: { async signPdf() {
      throw new Error('não deve assinar de novo'); } } });
    assert.equal((await getOwnRepPReceipt(context, first.receiptId, dependencies)).sha256, receipt.sha256);
    const stranger = { ...context, decoded: { uid: `${prefix}-stranger` } };
    await assert.rejects(getOwnRepPReceipt(stranger, first.receiptId, dependencies), { code: 'REP_P_RECEIPT_NOT_FOUND' });
    await assert.rejects(retryOwnRepPReceipt(stranger, second.receiptId, dependencies), { code: 'REP_P_RECEIPT_NOT_FOUND' });
    const history = await listOwnRepPMarkings(context, { startDate: '2026-10-18', endDate: '2026-10-18' }, dependencies);
    assert.equal(history.truncated, false);
    assert.deepEqual(history.markings.map((item) => [item.nsr, item.receiptStatus]).sort(),
      [[first.marking.nsr, 'available'], [second.marking.nsr, 'pending']].sort());
    assert.ok(history.markings.every((item) => item.executionUnitId === executionUnitId && !('employeeCpf' in item)));
    const viewerContext = { ...context, decoded: { uid: `${prefix}-viewer` }, isDefaultAdmin: false,
      userDoc: { id: `${prefix}-viewer`, unitIds: [employerUnitId] }, permissions: structuredClone(defaultAdminPermissions) };
    viewerContext.permissions.dp.timeClosure = { close: false, reopen: false };
    viewerContext.permissions.dp.timeRecording = { view: true };
    const employeeMonth = await readEmployeeTimeRecordingMonth(viewerContext, userId, '2026-10');
    assert.deepEqual(employeeMonth.history.markings.map((item) => item.nsr).sort(),
      [first.marking.nsr, second.marking.nsr].sort());
    assert.equal(employeeMonth.employee.uid, userId);
    assert.equal(employeeMonth.unitNames[executionUnitId], 'Execução excepcional');
    await assert.rejects(readEmployeeTimeRecordingMonth({ ...viewerContext,
      userDoc: { id: `${prefix}-viewer`, unitIds: ['unit-without-access'] } }, userId, '2026-10'),
    { code: 'REP_P_EMPLOYEE_MONTH_NOT_FOUND' });
    assert.deepEqual((await listOwnRepPMarkings(stranger, { startDate: '2026-10-18', endDate: '2026-10-18' }, dependencies)).markings, []);
    await assert.rejects(listOwnRepPMarkings(context, { startDate: '2026-01-01', endDate: '2026-10-18' }, dependencies),
      { code: 'REP_P_HISTORY_INPUT_INVALID' });
    const pendingReceipts = await listPendingRepPReceipts(context, dependencies);
    assert.deepEqual(pendingReceipts.receipts.filter((item) => item.establishmentId === establishmentId).map((item) => item.receiptId),
      [second.receiptId]);
    assert.equal(pendingReceipts.receipts.find((item) => item.receiptId === second.receiptId).lastIssue, 'REP_P_RECEIPT_SIGNATURE_REJECTED');

    // Reemissão automática: emite os pendentes sem registrar batida nem mexer no NSR.
    const nsrBeforeRetry = (await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr');
    const arpSnapshot = async () => (await repPDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get())
      .docs.map((doc) => [doc.id, doc.get('nsr'), doc.get('hash') ?? null]).sort((a, b) => a[1] - b[1]);
    const arpBeforeRetry = await arpSnapshot();
    const at = (minutes) => () => new Date(Date.now() + minutes * 60_000);
    const secondRef = repPDbAdmin.collection('repP_receipts').doc(second.receiptId);
    // A falha na batida adiou a próxima tentativa em 15 min; antes disso a rotina não insiste.
    assert.deepEqual(await retryPendingRepPReceipts({ workspaceId }, dependencies), { attempted: 0, issued: 0, stillPending: 0, failed: 0 });
    // Fila justa: um pendente antigo que falha sempre é adiado e não ocupa o lote dos seguintes.
    const stuckRef = repPDbAdmin.collection('repP_receipts').doc(repPIdentifiersForTest.receiptKey(establishmentId, 999_999_999));
    await stuckRef.set({ schemaVersion: 1, workspaceId, establishmentId, employeeId: userId, status: 'pending', attempts: 3,
      lastIssue: null, createdAt: Timestamp.fromMillis(Date.now() - 86_400_000), nextAttemptAt: Timestamp.fromMillis(Date.now() - 86_400_000) });
    assert.deepEqual(await retryPendingRepPReceipts({ workspaceId, limit: 1 }, { ...dependencies, now: at(16) }),
      { attempted: 1, issued: 0, stillPending: 0, failed: 1 });
    const stuck = await stuckRef.get();
    assert.equal(stuck.get('lastIssue'), 'REP_P_RECEIPT_MARKING_UNVERIFIABLE');
    assert.equal(stuck.get('nextAttemptAt').toMillis() - stuck.get('lastAttemptAt').toMillis() >= 29 * 60_000, true);
    const failedRetry = await retryPendingRepPReceipts({ workspaceId, limit: 1 }, { ...dependencies, now: at(16) });
    assert.deepEqual(failedRetry, { attempted: 1, issued: 0, stillPending: 1, failed: 0 });
    // Segunda falha: a espera sobe para o teto de 30 min a partir da tentativa.
    const delayMs = (await secondRef.get()).get('nextAttemptAt').toMillis() - Date.now();
    assert.ok(delayMs > 45 * 60_000 && delayMs < 47 * 60_000, `espera inesperada: ${delayMs}`);
    await stuckRef.delete();
    // Caminho de sucesso pelo vigia diário: reemite e conta sem pendência deste estabelecimento.
    const monitorNow = at(47)();
    const monitored = await runRepPDailyMonitor({ workspaceId, now: monitorNow, signerPem: '', clock,
      repDependencies: { ...dependencies, receiptSigner: padesSigner } });
    assert.deepEqual(monitored.receiptRetry, { attempted: 1, issued: 1, stillPending: 0, failed: 0 });
    assert.equal(monitored.receiptsCheck, 'ok');
    const monitorNotices = await dbAdmin.collection('systemNotices').where('workspaceId', '==', workspaceId).get();
    await Promise.all(monitorNotices.docs.filter((doc) => monitored.opened.includes(doc.get('dedupeKey'))).map((doc) => doc.ref.delete()));
    assert.deepEqual(await retryPendingRepPReceipts({ workspaceId }, { ...dependencies, receiptSigner: padesSigner, now: at(47) }),
      { attempted: 0, issued: 0, stillPending: 0, failed: 0 });
    assert.equal((await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), nsrBeforeRetry);
    assert.deepEqual(await arpSnapshot(), arpBeforeRetry);
    assert.equal(verifyRepPSignedPdf((await getOwnRepPReceipt(context, second.receiptId, dependencies)).bytes).valid, true);
    const receiptArchive = await exportOwnRepPReceipts(context,
      { startDate: '2026-10-18', endDate: '2026-10-18' }, { ...dependencies, now: () => new Date('2026-10-19T12:00:00.000Z') });
    assert.deepEqual([receiptArchive.complete, receiptArchive.total, receiptArchive.exported, receiptArchive.unavailable], [true, 2, 2, 0]);
    assert.ok(receiptArchive.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
    assert.match(receiptArchive.filename, /-completo\.zip$/);
    assert.equal((await exportOwnRepPReceipts(stranger,
      { startDate: '2026-10-18', endDate: '2026-10-18' }, dependencies)).total, 0);

    // Acesso do próprio trabalhador sem prazo de expiração: um comprovante de 3 dias segue disponível (mínimo legal: 48 h).
    const receiptRef = repPDbAdmin.collection('repP_receipts').doc(first.receiptId);
    await receiptRef.update({ createdAt: Timestamp.fromMillis(Date.now() - 72 * 3_600_000) });
    assert.equal((await getOwnRepPReceipt(context, first.receiptId, dependencies)).sha256, receipt.sha256);

    const receiptSnapshot = await repPDbAdmin.collection('repP_receipts').doc(first.receiptId).get();
    assert.equal(receiptSnapshot.get('snapshot').workLocation, 'Rua operacional, 2');
    assert.equal(receiptSnapshot.get('snapshot').employerLegalName, 'CT Sorvetes LTDA');

    // Sem endereço da unidade de execução, o comprovante não poderia ser emitido: recusa sem consumir NSR.
    const nsrBefore = (await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr');
    await execution.update({ address: '' });
    await assert.rejects(recordOwnRepPMarking(context,
      { attemptId: 'attempt-no-address', workDate: '2026-10-18', executionUnitId, channel: 'browser' }, dependencies),
    { code: 'REP_P_RECEIPT_PREREQUISITES_MISSING' });
    assert.equal((await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), nsrBefore);
    await execution.update({ address: 'Rua operacional, 2' });

    const replay = await recordOwnRepPMarking(context,
      { attemptId: 'attempt-1', workDate: '2026-10-18', executionUnitId, channel: 'mobile', locationAttempt: mobileLocation },
      { ...dependencies, clock: { async read() { throw new Error('clock must not run during replay'); } } });
    assert.equal(replay.status, 'replayed');
    assert.equal(replay.marking.nsr, first.marking.nsr);
    assert.equal(replay.receiptStatus, 'available');
    assert.deepEqual(replay.location, first.location);

    const afd = await exportSignedRepPAfd(context,
      { establishmentId, startDate: '2026-10-18', endDate: '2026-10-18' }, dependencies);
    assert.equal(Buffer.from(afd.signatureBase64, 'base64').toString(), 'synthetic-cades');
    const signedAfd = await exportSignedRepPAfd(context,
      { establishmentId, startDate: '2026-10-18', endDate: '2026-10-18' }, { ...dependencies, signer: icpSigners.cades });
    assert.equal(verifyRepPDetachedCms(Buffer.from(signedAfd.signatureBase64, 'base64'),
      Buffer.from(signedAfd.afdBase64, 'base64')).valid, true);
    assert.deepEqual(afd.counts, { '2': 1, '3': 0, '4': 0, '5': 1, '6': 0, '7': 2 });
    // Leitura paginada (página de 1 evento) gera exatamente os mesmos bytes do AFD.
    const paged = await exportSignedRepPAfd(context,
      { establishmentId, startDate: '2026-10-18', endDate: '2026-10-18' }, { ...dependencies, afdPageSize: 1 });
    assert.equal(paged.sha256, afd.sha256);
    // Total múltiplo exato da página (4 eventos, página de 2) e de 4: mesma saída; teto excedido falha fechado.
    for (const afdPageSize of [2, 4]) {
      assert.equal((await exportSignedRepPAfd(context, { establishmentId, startDate: '2026-10-18', endDate: '2026-10-18' },
        { ...dependencies, afdPageSize })).sha256, afd.sha256);
    }
    await assert.rejects(exportSignedRepPAfd(context, { establishmentId, startDate: '2026-10-18', endDate: '2026-10-18' },
      { ...dependencies, afdPageSize: 2, afdMaxEvents: 3 }), { code: 'REP_P_AFD_RANGE_TOO_LARGE' });
    // AFD por intervalo: período sem eventos traz só cabeçalho, trailer e assinatura.
    const emptyRange = await exportSignedRepPAfd(context,
      { establishmentId, startDate: '2026-10-19', endDate: '2026-10-20' }, { ...dependencies, signer: icpSigners.cades });
    assert.deepEqual(emptyRange.counts, { '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0 });
    const emptyLines = Buffer.from(emptyRange.afdBase64, 'base64').toString('latin1').split('\r\n');
    assert.equal(emptyRange.lineCount, 3);
    assert.ok(emptyLines[0].startsWith('000000000') && emptyLines[1].startsWith('999999999') && emptyLines[2].startsWith('ASSINATURA_DIGITAL_EM_ARQUIVO_P7S'));
    assert.equal(verifyRepPDetachedCms(Buffer.from(emptyRange.signatureBase64, 'base64'), Buffer.from(emptyRange.afdBase64, 'base64')).valid, true);
    const contents = Buffer.from(afd.afdBase64, 'base64').toString('latin1');
    assert.equal(contents.match(/\r\n/g)?.length, afd.lineCount);
    assert.ok(contents.includes(first.marking.hash));
    assert.ok(contents.includes(second.marking.hash));
    await assert.rejects(exportSignedRepPAfd(context,
      { establishmentId, startDate: '2026-10-18', endDate: '2026-10-18' }, { ...dependencies, fiscalStore: {
        async put() { throw new Error('storage unavailable'); },
      } }), { code: 'REP_P_AFD_ARCHIVE_FAILED' });
    const exportAudit = await repPDbAdmin.collection('repP_exportAudit').where('establishmentId', '==', establishmentId).get();
    assert.equal(exportAudit.size, 7);
    assert.ok(exportAudit.docs.some((doc) => doc.get('status') === 'archive_failed'));
    const expectedSignatureSha = createHash('sha256').update(Buffer.from(afd.signatureBase64, 'base64')).digest('hex');
    const storedAfd = exportAudit.docs.find((doc) => doc.get('status') === 'exported' && doc.get('sha256') === afd.sha256
      && doc.get('artifacts.signature.sha256') === expectedSignatureSha).data();
    assert.equal(storedAfd.schemaVersion, 2);
    const afdBundle = fiscalObjects.get(storedAfd.artifacts.bundle.storagePath).bytes;
    const afdEntries = zipEntries(afdBundle);
    assert.equal(afdEntries.get(storedAfd.artifacts.content.filename).toString('base64'), afd.afdBase64);
    assert.equal(afdEntries.get(storedAfd.artifacts.signature.filename).toString('base64'), afd.signatureBase64);
    assert.equal(storedAfd.artifacts.retentionYears, 20);
    assert.equal(storedAfd.artifacts.bundle.retentionMode, 'Locked');
    assert.equal(storedAfd.artifacts.bundle.storageBucket, 'fiscal-test');

    // Piloto nominal: ativar a unidade não coleta de quem não está na lista, mesmo se um cliente adulterado enviar coordenadas.
    await saveRepPLocationPolicy(context, executionUnitId, {
      expectedRevision: 1, mode: 'observe', center: { latitude: -1.4558, longitude: -48.4902 },
      radiusMeters: 150, maxAccuracyMeters: 100, maxAgeSeconds: 60, captureTimeoutMs: 10_000,
      privacyNoticeUrl: 'https://example.test/privacidade', legalBasisReference: 'Aditivo LGPD aprovado pelo controlador',
      retentionDays: 1_825, participantUserIds: [anotherUser.id], activationConfirmation: true,
    }, { mainDb: dbAdmin, repDb: repPDbAdmin, now: () => new Date('2026-10-18T12:00:00.000Z') });
    const excludedOptions = await listOwnRepPExecutionUnits(context, { workDate: '2026-10-18' }, dependencies);
    assert.equal(excludedOptions.executionUnits.find((unit) => unit.id === executionUnitId).locationPolicy.mode, 'disabled');
    const excluded = await recordOwnRepPMarking(context, { attemptId: 'attempt-excluded-location', workDate: '2026-10-18',
      executionUnitId, channel: 'mobile', locationAttempt: { ...mobileLocation, captureId: 'capture-excluded' } }, dependencies);
    assert.equal(excluded.location, null);
    assert.equal((await repPDbAdmin.collection(REP_P_LOCATION_EVIDENCE).where('employeeId', '==', userId).get()).size, 2);

    const eventSnapshot = await repPDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get();
    const attemptSnapshot = await repPDbAdmin.collection('repP_attempts').where('employeeId', '==', userId).get();
    assert.equal(eventSnapshot.size, 5);
    assert.equal(attemptSnapshot.size, 3);
    const markingEvents = eventSnapshot.docs.filter((doc) => doc.get('recordType') === '7');
    assert.equal(markingEvents.length, 3);
    assert.ok(markingEvents.every((doc) => doc.get('trustedClock.attestationId') === 'a'.repeat(64)
      && doc.get('trustedClock.quorum') === 2 && doc.get('trustedClock.observations').length === 2));
    assert.ok(markingEvents.every((doc) => doc.get('capture') === undefined && doc.get('location') === undefined));
    assert.ok(attemptSnapshot.docs.every((doc) => doc.get('capture') === undefined && doc.get('location') === undefined));

    // Simulações de GPS: toda falha de posição permanece acessória e não bloqueia o ponto.
    const policyInput = {
      expectedRevision: 2, mode: 'observe', center: { latitude: -1.4558, longitude: -48.4902 },
      radiusMeters: 150, maxAccuracyMeters: 100, maxAgeSeconds: 60, captureTimeoutMs: 10_000,
      privacyNoticeUrl: 'https://example.test/privacidade', legalBasisReference: 'Aditivo LGPD de teste sintético',
      retentionDays: 1_825, participantUserIds: [userId], activationConfirmation: true,
    };
    const policyDeps = { mainDb: dbAdmin, repDb: repPDbAdmin };
    const restricted = { ...context, isDefaultAdmin: false,
      userDoc: { id: userId, unitAccessScope: 'selected', unitAccessUnitIds: ['other-unit'] } };
    await assert.rejects(saveRepPLocationPolicy(restricted, executionUnitId, policyInput, policyDeps),
      { code: 'DP_TIME_LOCATION_POLICY_FORBIDDEN' });
    for (const invalid of [{ privacyNoticeUrl: null }, { privacyNoticeUrl: 'http://example.test/privacy' },
      { legalBasisReference: null }, { activationConfirmation: false }, { participantUserIds: [] }]) {
      await assert.rejects(saveRepPLocationPolicy(context, executionUnitId, { ...policyInput, ...invalid }, policyDeps),
        { code: 'DP_TIME_LOCATION_POLICY_INPUT_INVALID' });
    }
    await saveRepPLocationPolicy(context, executionUnitId, policyInput, policyDeps);
    const cases = [
      ['outside', { ...mobileLocation, latitude: -1.4525 }, 'outside'],
      ['approximate', { ...mobileLocation, accuracyMeters: 500 }, 'indeterminate'],
      ['denied', { status: 'denied', elapsedMs: 10 }, 'indeterminate'],
      ['gps-off', { status: 'unavailable', elapsedMs: 10 }, 'indeterminate'],
      ['timeout', { status: 'timeout', elapsedMs: 10_000 }, 'indeterminate'],
      ['unsupported', { status: 'unsupported', elapsedMs: 0 }, 'indeterminate'],
      ['stale', { ...mobileLocation, capturedAt: '2026-10-18T11:00:00.000Z' }, 'indeterminate'],
    ];
    for (const [name, capture, evaluation] of cases) {
      const input = { attemptId: `simulation-${name}`, workDate: '2026-10-18', executionUnitId,
        channel: 'mobile', locationAttempt: { ...capture, captureId: `capture-${name}` } };
      const result = await recordOwnRepPMarking(context, input, dependencies);
      assert.equal(result.status, 'recorded', name);
      assert.equal(result.location.evaluation, evaluation, name);
      const replay = await recordOwnRepPMarking(context, input, dependencies);
      assert.equal(replay.status, 'replayed', name);
      assert.equal(replay.marking.nsr, result.marking.nsr, name);
    }
    const finalEvidence = await repPDbAdmin.collection(REP_P_LOCATION_EVIDENCE).where('employeeId', '==', userId).get();
    assert.equal(finalEvidence.size, 2 + cases.length, 'reenvio não duplica evidência');
    assert.ok(finalEvidence.docs.every((doc) => doc.get('expiresAt') instanceof Timestamp));
    const finalEvents = await repPDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get();
    assert.equal(finalEvents.size, 5 + cases.length);
    assert.ok(finalEvents.docs.every((doc) => doc.get('capture') === undefined && doc.get('location') === undefined));
    const policyAudit = await repPLocationPolicyRef(repPDbAdmin, workspaceId, executionUnitId).collection('audit').get();
    assert.equal(policyAudit.size, 3, 'ativações e alterações da política são auditadas');

    await t.test('AFD particionado na meia-noite do fuso da execução preserva todos os NSRs entre páginas', async () => {
      const at = (instant) => ({ async read() { return { ...(await clock.read()), instant: new Date(instant) }; } });
      const previousDay = await recordOwnRepPMarking(context, { attemptId: 'boundary-before-midnight',
        workDate: '2026-10-17', executionUnitId, channel: 'mobile' },
      { ...dependencies, clock: at('2026-10-18T03:59:30Z') });
      const nextDay = await recordOwnRepPMarking(context, { attemptId: 'boundary-after-midnight',
        workDate: '2026-10-18', executionUnitId, channel: 'mobile' },
      { ...dependencies, clock: at('2026-10-18T04:00:30Z') });
      assert.ok(previousDay.marking.markedAt.startsWith('2026-10-17T23:59:'));
      assert.ok(nextDay.marking.markedAt.startsWith('2026-10-18T00:00:'));
      const exportDeps = { ...dependencies, clock: at('2026-10-19T12:00:00Z') };
      const range = { establishmentId, startDate: '2026-10-17', endDate: '2026-10-18' };
      const full = await exportSignedRepPAfd(context, range, exportDeps);
      for (const afdPageSize of [1, 2, 3, 4]) {
        assert.equal((await exportSignedRepPAfd(context, range, { ...exportDeps, afdPageSize })).sha256, full.sha256);
      }
      const rows = (value) => Buffer.from(value.afdBase64, 'base64').toString('latin1').split('\r\n')
        .filter((line) => !line.startsWith('999999999') && /^[24567]$/.test(line[9] ?? ''));
      const oldPart = await exportSignedRepPAfd(context, { ...range, endDate: '2026-10-17' }, { ...exportDeps, afdPageSize: 1 });
      const newPart = await exportSignedRepPAfd(context, { ...range, startDate: '2026-10-18' }, { ...exportDeps, afdPageSize: 2 });
      const partitioned = [...rows(oldPart), ...rows(newPart)].sort((a, b) => Number(a.slice(0, 9)) - Number(b.slice(0, 9)));
      assert.deepEqual(partitioned, rows(full));
      assert.equal(new Set(partitioned.map((line) => Number(line.slice(0, 9)))).size, partitioned.length);
      assert.ok(rows(oldPart).some((line) => line.includes(previousDay.marking.hash)));
      assert.equal(rows(oldPart).some((line) => line.includes(nextDay.marking.hash)), false);
      assert.ok(rows(newPart).some((line) => line.includes(nextDay.marking.hash)));
    });

    await t.test('AFD mantém fotografia única quando uma batida entra entre duas páginas', async () => {
      const source = repPDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId);
      const before = (await source.get()).docs.map((doc) => doc.get('nsr')).sort((a, b) => a - b);
      let newMarking;
      let intercepted = false;
      const snapshotDb = {
        collection: (name) => repPDbAdmin.collection(name),
        runTransaction: (callback, options) => repPDbAdmin.runTransaction(async (transaction) => {
          const wrapped = new Proxy(transaction, { get(target, property) {
            if (property === 'get') return async (query) => {
              const page = await target.get(query);
              if (!intercepted && page.size) {
                intercepted = true;
                newMarking = await recordOwnRepPMarking(context, { attemptId: 'marking-during-afd-export',
                  workDate: '2026-10-18', executionUnitId, channel: 'mobile' }, dependencies);
              }
              return page;
            };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          } });
          return callback(wrapped);
        }, options),
      };
      const range = { establishmentId, startDate: '2026-10-17', endDate: '2026-10-18' };
      const exported = await exportSignedRepPAfd(context, range, { ...dependencies, repDb: snapshotDb, afdPageSize: 1 });
      const nsrs = (pkg) => Buffer.from(pkg.afdBase64, 'base64').toString('latin1').split('\r\n')
        .filter((line) => !line.startsWith('999999999') && /^[24567]$/.test(line[9] ?? ''))
        .map((line) => Number(line.slice(0, 9)));
      assert.ok(intercepted && newMarking);
      assert.deepEqual(nsrs(exported), before, 'a batida nova não pode vazar apenas para páginas posteriores');
      const after = await exportSignedRepPAfd(context, range, { ...dependencies, afdPageSize: 1 });
      assert.deepEqual(nsrs(after), [...before, newMarking.marking.nsr].sort((a, b) => a - b));
    });

    await t.test('reenvios concorrentes da batida e do monitor compartilham NSR sem colisão', async () => {
      const ref = repPDbAdmin.collection('repP_establishments').doc(establishmentId);
      const before = (await ref.get()).get('lastNsr');
      const incident = { incidentId: `${prefix}-concurrent-monitor`, state: 'open', startedAt: 1792321200,
        policyName: 'synthetic-policy', conditionName: 'synthetic-condition' };
      const input = { attemptId: 'marking-monitor-concurrent', workDate: '2026-10-18', executionUnitId, channel: 'mobile' };
      const notify = () => recordRepPAvailabilityNotification(workspaceId, incident,
        { repDb: repPDbAdmin, clock, markingEnabled: true });
      try {
        const [one, replay, eventOne, eventReplay] = await Promise.all([
          recordOwnRepPMarking(context, input, dependencies), recordOwnRepPMarking(context, input, dependencies), notify(), notify(),
        ]);
        assert.equal(one.marking.nsr, replay.marking.nsr);
        assert.equal(eventOne.events + eventReplay.events, 1);
        assert.equal((await ref.get()).get('lastNsr'), before + 2);
        const added = (await repPDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId)
          .where('nsr', '>', before).get()).docs.map((doc) => doc.data());
        assert.deepEqual(added.map((row) => row.nsr).sort((a, b) => a - b), [before + 1, before + 2]);
        assert.deepEqual(added.map((row) => row.recordType).sort(), ['6', '7']);
        const closed = await recordRepPAvailabilityNotification(workspaceId,
          { ...incident, state: 'closed', endedAt: 1792321500 }, { repDb: repPDbAdmin, clock, markingEnabled: true });
        assert.equal(closed.events, 1);
        assert.equal((await ref.get()).get('lastNsr'), before + 3);
      } finally {
        const incidents = await repPDbAdmin.collection('repP_availabilityIncidents').where('establishmentId', '==', establishmentId).get();
        for (const doc of incidents.docs) await doc.ref.delete();
        await repPDbAdmin.collection('repP_availabilityStates').doc(establishmentId).delete();
      }
    });
    allRefs.push(...eventSnapshot.docs.map((doc) => doc.ref), ...attemptSnapshot.docs.map((doc) => doc.ref),
      ...exportAudit.docs.map((doc) => doc.ref), ...locationEvidence.docs.map((doc) => doc.ref));
  } finally {
    const referenceEmployee = repPDbAdmin.collection('repP_employees')
      .doc(repPIdentifiersForTest.employeeKey(establishmentId, userId));
    const referenceEstablishment = repPDbAdmin.collection('repP_establishments').doc(establishmentId);
    const locationPolicyRef = repPLocationPolicyRef(repPDbAdmin, workspaceId, executionUnitId);
    const [eventsToDelete, attemptsToDelete, exportsToDelete, receiptsToDelete, evidenceToDelete, policyRevisions, policyAudit, accessAudit] = await Promise.all([
      repPDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get(),
      repPDbAdmin.collection('repP_attempts').where('employeeId', '==', userId).get(),
      repPDbAdmin.collection('repP_exportAudit').where('establishmentId', '==', establishmentId).get(),
      repPDbAdmin.collection('repP_receipts').where('establishmentId', '==', establishmentId).get(),
      repPDbAdmin.collection(REP_P_LOCATION_EVIDENCE).where('employeeId', '==', userId).get(),
      locationPolicyRef.collection('revisions').get(),
      locationPolicyRef.collection('audit').get(),
      hrDbAdmin.collection('dp_timeRecordingAccessAudit').where('employeeUid', '==', userId).get(),
    ]);
    await Promise.all([...allRefs, ...eventsToDelete.docs.map((doc) => doc.ref), ...attemptsToDelete.docs.map((doc) => doc.ref),
      ...exportsToDelete.docs.map((doc) => doc.ref), ...receiptsToDelete.docs.map((doc) => doc.ref), ...evidenceToDelete.docs.map((doc) => doc.ref),
      ...policyRevisions.docs.map((doc) => doc.ref), ...policyAudit.docs.map((doc) => doc.ref), ...accessAudit.docs.map((doc) => doc.ref),
      referenceEmployee, referenceEstablishment, cpfField, employee, employer, execution, user, anotherUser]
      .map((ref) => ref.delete().catch(() => undefined)));
    await locationPolicyRef.delete().catch(() => undefined);
    const headId = createHash('sha256').update(JSON.stringify([workspaceId, userId])).digest('hex');
    const cleanup = await Promise.all(['dp_employmentReferenceHistories', 'dp_employmentReferenceRequests']
      .map((collection) => dbAdmin.collection(collection).where('userId', '==', userId).get()));
    await Promise.all([...cleanup.flatMap((snapshot) => snapshot.docs.map((doc) => doc.ref)),
      dbAdmin.collection('dp_employmentReferenceHeads').doc(headId)].map((ref) => ref.delete().catch(() => undefined)));
  }
});

test('ensaio nominal usa Hora Legal, mas permanece fora da ARP e do fechamento oficial', async (t) => {
  const workspaceId = 'coala-one-pilot';
  const userId = 'rep-p-pilot-employee';
  const unitId = 'rep-p-pilot-unit';
  const context = { decoded: { uid: userId }, userDoc: { id: userId, username: 'Pessoa Piloto' }, profileId: 'pilot-profile',
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: false, workspace_id: workspaceId };
  context.permissions.app.timeRecording.mark = true;
  const unit = dbAdmin.collection('dp_units').doc(unitId);
  const user = dbAdmin.collection('users').doc(userId);
  const employee = hrDbAdmin.collection('employees').doc('rep-p-pilot-hr');
  const cpfField = employee.collection('field_values').doc('employee.cpf');
  let clockInstant = '2026-10-22T12:15:42.000Z';
  const clock = { async read() { return { instant: new Date(clockInstant), source: 'synthetic-hlb-test',
    assurance: 'hlb_verified', observedOffsetMs: 8, verifiedAt: new Date(), attestationId: 'b'.repeat(64),
    attestationMode: 'fresh', quorum: 2, observations: [
      { server: '200.20.186.75', status: 'accepted', offsetMs: 6, roundTripMs: 20, stratum: 1 },
      { server: '200.20.186.94', status: 'accepted', offsetMs: 10, roundTripMs: 22, stratum: 1 },
    ] }; } };
  const dependencies = { repDb: repPDbAdmin, pilotDb: hrDbAdmin, mainDb: dbAdmin, hrDb: hrDbAdmin, clock,
    markingEnabled: false, pilotEnabled: true, pilotUserIds: new Set([userId]) };
  assert.deepEqual(await listOwnRepPExecutionUnits({ ...context, decoded: { uid: 'rep-p-pilot-not-allowed' } },
    { workDate: '2026-10-22' }, dependencies), {
    workDate: '2026-10-22', eligible: false, markingEnabled: false, mode: 'pilot', journeyLocationEnabled: false,
    executionUnits: [], officialClock: { available: true, instant: '2026-10-22T12:15:42.000Z', timeZone: 'America/Belem' },
  });
  const activeLocationPolicy = repPLocationPolicyRef(hrDbAdmin, workspaceId, unitId);
  const pilotDayGuard = hrDbAdmin.collection('repP_pilotDayGuards')
    .doc(repPPilotDayGuardId(workspaceId, userId, '2026-10-22'));
  const formalAdjustment = hrDbAdmin.collection('ptrp_adjustmentRequests').doc('pilot-existing-formal-adjustment');
  try {
    await Promise.all([
      unit.set({ name: 'Unidade Piloto', address: 'Rua do Ensaio, 10', cnpj: '14276603000125', timeZone: 'America/Fortaleza' }),
      user.set({ isActive: true, username: 'Pessoa Piloto', unitId, unitIds: [unitId] }),
      employee.set({ auth_uid: userId, name: 'Pessoa Piloto' }),
      cpfField.set({ value_text: '52998224725' }),
      activeLocationPolicy.set({ schemaVersion: 1, workspaceId, executionUnitId: unitId, revision: 7, mode: 'observe',
        center: { latitude: -1.4558, longitude: -48.4902 }, radiusMeters: 150, maxAccuracyMeters: 100,
        maxAgeSeconds: 60, captureTimeoutMs: 10_000, privacyNoticeUrl: 'https://example.test/privacidade',
        legalBasisReference: 'Política antiga que não pode alcançar o ensaio nominal', retentionDays: 1_825,
        participantUserIds: [userId], activatedAt: '2026-10-20T12:00:00.000Z', activatedBy: 'legacy-admin' }),
    ]);
    await publishEmploymentReference({ ...context, isDefaultAdmin: true }, {
      userId, expectedRevision: 0, requestId: 'pilot-employment-1', periods: [{ validFrom: '2026-10-01',
        employmentRelationshipType: 'clt', employerUnitId: unitId, unitId, unitIds: [unitId], jobFunctionIds: [],
        sourceDocumentId: 'pilot-source-1', sourceReason: 'Identidade nominal de ensaio autorizada.' }],
    });
    const options = await listOwnRepPExecutionUnits(context, { workDate: '2026-10-22' }, dependencies);
    assert.equal(options.mode, 'pilot');
    assert.equal(options.markingEnabled, true);
    assert.equal(options.journeyLocationEnabled, false);
    assert.equal(options.executionUnits[0].locationPolicy.mode, 'disabled',
      'o ensaio ignora até uma política anterior ativa para o participante');
    assert.deepEqual(options.officialClock, { available: true, instant: '2026-10-22T12:15:42.000Z', timeZone: 'America/Fortaleza' });
    await unit.delete();
    assert.deepEqual(await listOwnRepPExecutionUnits(context, { workDate: '2026-10-22' }, dependencies), {
      workDate: '2026-10-22', eligible: true, markingEnabled: true, mode: 'pilot', journeyLocationEnabled: false,
      executionUnits: [], officialClock: { available: true, instant: '2026-10-22T12:15:42.000Z', timeZone: 'America/Belem' },
    });
    await unit.set({ name: 'Unidade Piloto', address: 'Rua do Ensaio, 10', cnpj: '14276603000125', timeZone: 'America/Fortaleza' });

    const request = { attemptId: 'pilot-attempt-1', workDate: '2026-10-22', executionUnitId: unitId,
      channel: 'browser', declaredPurpose: 'journey_start', locationAttempt: { captureId: 'ignored-pilot-location',
        status: 'captured', elapsedMs: 280, latitude: -1.4558, longitude: -48.4902, accuracyMeters: 12,
        capturedAt: '2026-10-22T12:15:40.000Z' } };
    await formalAdjustment.set({ workspaceId, employeeUid: userId, workDate: '2026-10-22', status: 'approved' });
    await assert.rejects(recordOwnRepPMarking(context, { ...request, attemptId: 'blocked-by-formal-adjustment' }, dependencies),
      { code: 'REP_P_PILOT_DAY_ADJUSTMENT_FORBIDDEN' });
    await formalAdjustment.delete();
    const recorded = await recordOwnRepPMarking(context, request, dependencies);
    assert.equal(recorded.status, 'recorded');
    assert.equal(recorded.pilot, true);
    assert.equal(recorded.marking.sequence, 1);
    assert.equal(recorded.marking.markedAt, '2026-10-22T09:15:00-0300');
    assert.deepEqual(recorded.marking.snapshot, {
      schemaVersion: 2, title: 'Ensaio de registro de ponto', sequence: 1,
      markedAt: '2026-10-22T09:15:00-0300', hash: recorded.marking.hash,
      employerName: 'CT SORVETES LTDA', employerCnpj: '14276603000125',
      employeeName: 'Pessoa Piloto', employeeCpf: '52998224725', unitName: 'Unidade Piloto',
      workLocation: 'Rua do Ensaio, 10', collectorId: '02', developerName: 'CT SORVETES LTDA',
      developerCnpj: '14276603000125',
    });
    assert.equal(recorded.location, null);
    assert.equal((await repPDbAdmin.collection(REP_P_LOCATION_EVIDENCE).where('employeeId', '==', userId).get()).size, 0,
      'o servidor não persiste localização no ensaio, mesmo se um cliente adulterado a enviar');
    assert.equal((await pilotDayGuard.get()).exists, true, 'o dia do ensaio recebe trava transacional para ajustes formais');
    assert.equal((await pilotDayGuard.get()).get('domain'), 'pilot');
    assert.match(recorded.receiptId, /^pilot_[a-f0-9]{64}$/);
    assert.equal(recorded.receiptStatus, 'available');
    assert.equal((await recordOwnRepPMarking(context, request, dependencies)).status, 'replayed');

    const receipt = await getOwnRepPReceipt(context, recorded.receiptId, dependencies);
    assert.equal(receipt.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.match(receipt.filename, /^ensaio-ponto-/);
    const history = await listOwnRepPMarkings(context, { startDate: '2026-10-22', endDate: '2026-10-22' }, dependencies);
    assert.deepEqual(history.markings.map((item) => [item.pilot, item.nsr]), [[true, 1]]);
    assert.equal(history.markings[0].classification.purpose, 'journey_start');
    assert.equal((await classifyOwnRepPMarking(context, recorded.receiptId, { purpose: 'break_start' }, dependencies)).changeStatus, 'applied');
    const reclassified = await listOwnRepPMarkings(context, { startDate: '2026-10-22', endDate: '2026-10-22' }, dependencies);
    assert.equal(reclassified.markings[0].classification.purpose, 'break_start');
    for (let index = 0; index < 104; index += 1) {
      await classifyOwnRepPMarking(context, recorded.receiptId,
        { purpose: index % 2 === 0 ? 'journey_start' : 'break_start' }, dependencies);
    }
    const classificationEvents = await hrDbAdmin.collection(REP_P_PILOT_CLASSIFICATION_EVENTS)
      .where('markingId', '==', recorded.receiptId).get();
    assert.equal(classificationEvents.size, 106, 'a trilha somente de inclusão preserva mais de cem alterações');
    assert.deepEqual(classificationEvents.docs.map((doc) => doc.get('revision')).sort((left, right) => left - right),
      Array.from({ length: 106 }, (_, index) => index + 1));
    assert.equal((await hrDbAdmin.collection('repP_pilotMarkings').doc(recorded.receiptId).get()).get('classificationRevision'), 106);
    const bankPreview = await readRepPPilotMarkingsForBank(workspaceId, userId, '2026-10-22', '2026-10-22', dependencies);
    assert.equal(bankPreview.markings.length, 1);
    assert.equal((await repPDbAdmin.collection('repP_events').where('workspaceId', '==', workspaceId).get()).size, 0);
    assert.equal((await repPDbAdmin.collection('repP_receipts').where('workspaceId', '==', workspaceId).get()).size, 0);

    const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const deviceKeyId = repPDeviceKeyId(publicKey);
    const permit = await issueOwnRepPOfflinePermit(context, { permitRequestId: 'pilot-permit-request-1',
      workDate: '2026-10-22', installationId: '11111111-1111-4111-8111-111111111111', deviceKeyId,
      devicePublicKey: publicKey, keySecurity: 'tee', bootCount: 7, anchorElapsedRealtimeMs: 1_000 }, dependencies);
    assert.equal(permit.scope, 'pilot');
    assert.match(permit.permitId, /^pilot_[a-f0-9]{64}$/);
    const offlineCore = { scope: 'pilot', permitId: permit.permitId, attemptId: 'pilot-offline-attempt-1',
      executionUnitId: unitId, deviceKeyId, elapsedRealtimeMs: 61_000, bootCount: 7, sequence: 1,
      previousLocalHash: null, markedAt: '2026-10-22T09:16:00-0300' };
    const canonical = canonicalRepPOfflineEvent(offlineCore);
    const localHash = hashRepPOfflineEvent(canonical);
    const offlineRequest = { attemptId: offlineCore.attemptId, workDate: '2026-10-22', executionUnitId: unitId,
      channel: 'mobile', declaredPurpose: 'break_start', offline: { scope: 'pilot', permitId: permit.permitId,
        deviceKeyId, elapsedRealtimeMs: offlineCore.elapsedRealtimeMs, bootCount: 7, sequence: 1,
        previousLocalHash: null, markedAt: offlineCore.markedAt, localHash,
        signature: sign('sha256', Buffer.from(canonical), keys.privateKey).toString('base64') } };
    clockInstant = '2026-10-22T12:20:42.000Z';
    const synchronized = await recordOwnRepPMarking(context, offlineRequest, dependencies);
    assert.equal(synchronized.pilot, true);
    assert.equal(synchronized.marking.sequence, 2);
    assert.equal(synchronized.marking.markedAt, '2026-10-22T09:16:00-0300');
    assert.equal((await recordOwnRepPMarking(context, offlineRequest, { ...dependencies, markingEnabled: true,
      pilotEnabled: false, officialUserIds: new Set() })).status, 'replayed',
    'uma fila piloto continua no domínio piloto mesmo depois da troca dos gates');
    await assert.rejects(recordOwnRepPMarking(context, { ...offlineRequest, attemptId: 'pilot-rebooted-attempt',
      offline: { ...offlineRequest.offline, bootCount: 8 } }, dependencies),
    { code: 'REP_P_PILOT_OFFLINE_PERMIT_INVALID' });
    await assert.rejects(recordOwnRepPMarking(context, { ...offlineRequest, attemptId: 'pilot-expired-attempt',
      offline: { ...offlineRequest.offline, elapsedRealtimeMs: 43_201_001 } }, dependencies),
    { code: 'REP_P_PILOT_OFFLINE_TIME_INVALID' });

    const secondCore = { ...offlineCore, attemptId: 'pilot-offline-attempt-2', elapsedRealtimeMs: 121_000,
      sequence: 2, previousLocalHash: localHash, markedAt: '2026-10-22T09:17:00-0300' };
    const secondCanonical = canonicalRepPOfflineEvent(secondCore);
    const secondHash = hashRepPOfflineEvent(secondCanonical);
    const secondRequest = { ...offlineRequest, attemptId: secondCore.attemptId, offline: { ...offlineRequest.offline,
      elapsedRealtimeMs: secondCore.elapsedRealtimeMs, sequence: 2, previousLocalHash: localHash,
      markedAt: secondCore.markedAt, localHash: secondHash,
      signature: sign('sha256', Buffer.from(secondCanonical), keys.privateKey).toString('base64') } };
    const skippedCore = { ...secondCore, attemptId: 'pilot-offline-skipped-sequence', sequence: 3 };
    const skippedCanonical = canonicalRepPOfflineEvent(skippedCore);
    await assert.rejects(recordOwnRepPMarking(context, { ...secondRequest, attemptId: skippedCore.attemptId,
      offline: { ...secondRequest.offline, sequence: 3, localHash: hashRepPOfflineEvent(skippedCanonical),
        signature: sign('sha256', Buffer.from(skippedCanonical), keys.privateKey).toString('base64') } }, dependencies),
    { code: 'REP_P_PILOT_OFFLINE_SEQUENCE_INVALID' });
    await unit.update({ timeZone: 'America/Belem' });
    await assert.rejects(recordOwnRepPMarking(context, secondRequest, dependencies),
      { code: 'REP_P_PILOT_OFFLINE_CONTEXT_CHANGED' });
    await unit.update({ timeZone: 'America/Fortaleza' });
    clockInstant = '2026-10-22T12:21:42.000Z';
    const secondSynchronized = await recordOwnRepPMarking(context, secondRequest, dependencies);
    assert.equal(secondSynchronized.marking.sequence, 3);
    assert.equal(secondSynchronized.marking.markedAt, secondCore.markedAt);
    assert.equal((await hrDbAdmin.collection('repP_pilotOfflinePermits').doc(permit.permitId).get()).get('lastAcceptedSequence'), 2);
    const storedOffline = await hrDbAdmin.collection('repP_pilotMarkings').doc(synchronized.receiptId).get();
    assert.equal(storedOffline.get('pilotOfflineEvidence.scope'), 'pilot');
    assert.equal((await repPDbAdmin.collection('repP_events').where('workspaceId', '==', workspaceId).get()).size, 0,
      'a contingência do ensaio não cria evento nem NSR oficial');

    await assert.rejects(recordOwnRepPMarking({ ...context, decoded: { uid: 'rep-p-pilot-not-allowed' } },
      { ...request, attemptId: 'not-allowed' }, { ...dependencies, pilotUserIds: new Set([userId]) }),
    { code: 'REP_P_MARKING_PROFILE_DISABLED' });

    await t.test('corte oficial drena fila piloto no domínio original sem promovê-la a AFD, AEJ ou espelho', async () => {
      clockInstant = '2026-11-01T12:00:00.000Z';
      const officialDeps = { ...dependencies, markingEnabled: true, pilotEnabled: false, officialUserIds: new Set([userId]),
        officialStartDate: '2026-11-01' };
      const queuedCore = { ...secondCore, attemptId: 'pilot-pending-at-cutover', elapsedRealtimeMs: 181_000,
        sequence: 3, previousLocalHash: secondHash, markedAt: '2026-10-22T09:18:00-0300' };
      const queuedCanonical = canonicalRepPOfflineEvent(queuedCore);
      const queuedHash = hashRepPOfflineEvent(queuedCanonical);
      const queued = { ...offlineRequest, attemptId: queuedCore.attemptId, offline: { ...offlineRequest.offline,
        elapsedRealtimeMs: queuedCore.elapsedRealtimeMs, sequence: 3, previousLocalHash: secondHash,
        markedAt: queuedCore.markedAt, localHash: queuedHash,
        signature: sign('sha256', Buffer.from(queuedCanonical), keys.privateKey).toString('base64') } };
      const drained = await recordOwnRepPMarking(context, queued, officialDeps);
      assert.equal(drained.pilot, true);
      assert.equal(drained.marking.sequence, 4);
      assert.equal((await repPDbAdmin.collection('repP_events').where('workspaceId', '==', workspaceId).get()).size, 0);
      await assert.rejects(recordOwnRepPMarking(context, { ...request, attemptId: 'new-pilot-on-official-date', workDate: '2026-11-01' },
        { ...officialDeps, markingEnabled: false, pilotEnabled: true, pilotUserIds: new Set([userId]) }),
      { code: 'REP_P_PILOT_CUTOVER_REACHED' });
      await assert.rejects(recordOwnRepPMarking(context, { ...queued, attemptId: 'promoted-pilot-attempt',
        offline: { ...queued.offline, scope: 'official' } }, officialDeps), { code: 'REP_P_OFFLINE_PERMIT_INVALID' });

      const establishmentId = repPIdentifiersForTest.establishmentKey(workspaceId, '14276603000125');
      const profile = { establishmentId, employerCnpj: '14276603000125', employerLegalName: 'CT Sorvetes LTDA',
        inpiRegistration: '1234567890123', developerCnpj: '14276603000125' };
      try {
        await provisionRepPReferenceData({ workspaceId, responsibleCpf: '52998224725', timeZone: 'America/Fortaleza', profile,
          employee: { userId, cpf: '52998224725', name: 'Pessoa Piloto' }, workLocation: 'Rua do Ensaio, 10' }, officialDeps);
        const official = await recordOwnRepPMarking(context, { attemptId: 'first-official-after-cutover',
          workDate: '2026-11-01', executionUnitId: unitId, channel: 'browser' }, officialDeps);
        assert.equal(official.marking.nsr, 3, 'os quatro ensaios anteriores não consomem a sequência fiscal');
        const events = (await repPDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get()).docs.map((doc) => doc.data());
        const afd = generateRepPAfd({ profile, startDate: '2026-10-22', endDate: '2026-11-01',
          generatedAt: '2026-11-01T09:00:00-0300', events });
        assert.equal(afd.counts['7'], 1);
        assert.ok(afd.bytes.toString('latin1').includes(official.marking.hash));
        assert.equal(afd.bytes.toString('latin1').includes(queuedHash), false);
        const aej = await readRepPForAej(workspaceId, establishmentId, '2026-10-22', '2026-11-01', officialDeps);
        const mirror = await readRepPMarkingsForMirror(workspaceId, userId, '2026-10-22', '2026-11-01', officialDeps);
        assert.deepEqual(aej.markings.map((row) => [row.nsr, row.workDate]), [[3, '2026-11-01']]);
        assert.deepEqual(mirror.markings.map((row) => [row.nsr, row.workDate]), [[3, '2026-11-01']]);
        assert.equal((await recordOwnRepPMarking(context, queued, officialDeps)).status, 'replayed');
        assert.equal((await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), 3);
      } finally {
        for (const collection of ['repP_events', 'repP_receipts']) {
          const rows = await repPDbAdmin.collection(collection).where('establishmentId', '==', establishmentId).get();
          for (const doc of rows.docs) await doc.ref.delete();
        }
        const attempts = await repPDbAdmin.collection('repP_attempts').where('employeeId', '==', userId).get();
        for (const doc of attempts.docs) await doc.ref.delete();
        await repPDbAdmin.collection('repP_employees').doc(repPIdentifiersForTest.employeeKey(establishmentId, userId)).delete();
        await repPDbAdmin.collection('repP_establishments').doc(establishmentId).delete();
      }
    });
  } finally {
    const [markings, heads, classificationEvents, permits, histories, requests] = await Promise.all([
      hrDbAdmin.collection('repP_pilotMarkings').where('employeeId', '==', userId).get(),
      hrDbAdmin.collection('repP_pilotHeads').where('employeeId', '==', userId).get(),
      hrDbAdmin.collection(REP_P_PILOT_CLASSIFICATION_EVENTS).where('employeeId', '==', userId).get(),
      hrDbAdmin.collection('repP_pilotOfflinePermits').where('employeeId', '==', userId).get(),
      dbAdmin.collection('dp_employmentReferenceHistories').where('userId', '==', userId).get(),
      dbAdmin.collection('dp_employmentReferenceRequests').where('userId', '==', userId).get(),
    ]);
    await Promise.all([...markings.docs, ...heads.docs, ...classificationEvents.docs, ...permits.docs, ...histories.docs, ...requests.docs]
      .map((doc) => doc.ref.delete().catch(() => undefined)));
    const employmentHeadId = createHash('sha256').update(JSON.stringify([workspaceId, userId])).digest('hex');
    await Promise.all([dbAdmin.collection('dp_employmentReferenceHeads').doc(employmentHeadId), activeLocationPolicy,
      formalAdjustment, pilotDayGuard, cpfField, employee, unit, user]
      .map((ref) => ref.delete().catch(() => undefined)));
  }
});
