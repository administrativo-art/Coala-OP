import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { Timestamp } = await import('firebase-admin/firestore');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { exportSignedRepPAfd, getOwnRepPReceipt, listOwnRepPExecutionUnits, listOwnRepPMarkings, listPendingRepPReceipts, provisionRepPReferenceData,
  recordOwnRepPMarking, repPIdentifiersForTest, retryOwnRepPReceipt, retryPendingRepPReceipts } = await import('../../src/features/dp/rep-p/service.server.ts');
const { runRepPDailyMonitor } = await import('../../src/features/dp/rep-p/monitor.server.ts');
const { createRepPIcpSigners, loadRepPIcpIdentity, verifyRepPDetachedCms, verifyRepPSignedPdf }
  = await import('../../src/features/dp/rep-p/icp-signer.ts');
const { createTestIcpCredential } = await import('../helpers/rep-p-test-certificate.ts');

test('ARP atribui NSR atomicamente, faz replay sem duplicar e exporta o mesmo original em AFD assinado', async () => {
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
  const dependencies = { repDb: hrDbAdmin, mainDb: dbAdmin, hrDb: hrDbAdmin, clock,
    markingEnabled: true,
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
    await Promise.all([
      employer.set({ name: 'Empregadora', address: 'Rua fiscal, 1', cnpj: employerCnpj, timeZone: 'America/Belem' }),
      // Unidade de execução em outro fuso: a batida grava o fuso dela, não o do estabelecimento.
      execution.set({ name: 'Execução excepcional', address: 'Rua operacional, 2', cnpj: '11222333000181', timeZone: 'America/Manaus' }),
      user.set({ isActive: true, unitId: employerUnitId, unitIds: [employerUnitId, executionUnitId] }),
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

    const options = await listOwnRepPExecutionUnits(context, { workDate: '2026-10-18' }, dependencies);
    assert.equal(options.eligible, true);
    assert.equal(options.markingEnabled, true);
    // Com a coleta desligada, o atalho da barra superior some: as opções avisam sem esconder o vínculo.
    assert.equal((await listOwnRepPExecutionUnits(context, { workDate: '2026-10-18' }, { ...dependencies, markingEnabled: false })).markingEnabled, false);
    assert.deepEqual(options.officialClock, { available: true, instant: '2026-10-18T11:15:42.000Z', timeZone: 'America/Belem' });
    assert.deepEqual((await listOwnRepPExecutionUnits(context, { workDate: '2026-10-18' }, { ...dependencies,
      clock: { async read() { throw new Error('fonte fora do ar'); } } })).officialClock,
    { available: false, issue: 'REP_P_TIME_UNAVAILABLE' });
    assert.deepEqual(options.executionUnits.map((unit) => [unit.id, unit.employer, unit.timeZone]),
      [[employerUnitId, true, 'America/Belem'], [executionUnitId, false, 'America/Manaus']]);
    assert.deepEqual((await listOwnRepPExecutionUnits({ ...context, decoded: { uid: `${prefix}-nobody` } },
      { workDate: '2026-10-18' }, dependencies)).executionUnits, []);

    const [first, second] = await Promise.all([
      recordOwnRepPMarking(context, { attemptId: 'attempt-1', workDate: '2026-10-18', executionUnitId, channel: 'mobile' }, dependencies),
      recordOwnRepPMarking(context, { attemptId: 'attempt-2', workDate: '2026-10-18', executionUnitId, channel: 'browser' }, dependencies),
    ]);
    assert.equal(first.status, 'recorded');
    assert.equal(first.marking.markedAt, '2026-10-18T07:15:00-0400');
    assert.equal(second.status, 'recorded');
    assert.deepEqual([first.marking.nsr, second.marking.nsr].sort(), [3, 4]);
    assert.ok(first.marking.employerUnitId === employerUnitId && second.marking.employerUnitId === employerUnitId);
    assert.ok(first.marking.executionUnitId === executionUnitId && second.marking.executionUnitId === executionUnitId);
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
    assert.deepEqual((await listOwnRepPMarkings(stranger, { startDate: '2026-10-18', endDate: '2026-10-18' }, dependencies)).markings, []);
    await assert.rejects(listOwnRepPMarkings(context, { startDate: '2026-01-01', endDate: '2026-10-18' }, dependencies),
      { code: 'REP_P_HISTORY_INPUT_INVALID' });
    const pendingReceipts = await listPendingRepPReceipts(context, dependencies);
    assert.deepEqual(pendingReceipts.receipts.filter((item) => item.establishmentId === establishmentId).map((item) => item.receiptId),
      [second.receiptId]);
    assert.equal(pendingReceipts.receipts.find((item) => item.receiptId === second.receiptId).lastIssue, 'REP_P_RECEIPT_SIGNATURE_REJECTED');

    // Reemissão automática: emite os pendentes sem registrar batida nem mexer no NSR.
    const nsrBeforeRetry = (await hrDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr');
    const arpSnapshot = async () => (await hrDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get())
      .docs.map((doc) => [doc.id, doc.get('nsr'), doc.get('hash') ?? null]).sort((a, b) => a[1] - b[1]);
    const arpBeforeRetry = await arpSnapshot();
    const at = (minutes) => () => new Date(Date.now() + minutes * 60_000);
    const secondRef = hrDbAdmin.collection('repP_receipts').doc(second.receiptId);
    // A falha na batida adiou a próxima tentativa em 15 min; antes disso a rotina não insiste.
    assert.deepEqual(await retryPendingRepPReceipts({ workspaceId }, dependencies), { attempted: 0, issued: 0, stillPending: 0, failed: 0 });
    // Fila justa: um pendente antigo que falha sempre é adiado e não ocupa o lote dos seguintes.
    const stuckRef = hrDbAdmin.collection('repP_receipts').doc(repPIdentifiersForTest.receiptKey(establishmentId, 999_999_999));
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
    assert.equal((await hrDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), nsrBeforeRetry);
    assert.deepEqual(await arpSnapshot(), arpBeforeRetry);
    assert.equal(verifyRepPSignedPdf((await getOwnRepPReceipt(context, second.receiptId, dependencies)).bytes).valid, true);

    // Acesso do próprio trabalhador sem prazo de expiração: um comprovante de 3 dias segue disponível (mínimo legal: 48 h).
    const receiptRef = hrDbAdmin.collection('repP_receipts').doc(first.receiptId);
    await receiptRef.update({ createdAt: Timestamp.fromMillis(Date.now() - 72 * 3_600_000) });
    assert.equal((await getOwnRepPReceipt(context, first.receiptId, dependencies)).sha256, receipt.sha256);

    const receiptSnapshot = await hrDbAdmin.collection('repP_receipts').doc(first.receiptId).get();
    assert.equal(receiptSnapshot.get('snapshot').workLocation, 'Rua operacional, 2');
    assert.equal(receiptSnapshot.get('snapshot').employerLegalName, 'CT Sorvetes LTDA');

    // Sem endereço da unidade de execução, o comprovante não poderia ser emitido: recusa sem consumir NSR.
    const nsrBefore = (await hrDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr');
    await execution.update({ address: '' });
    await assert.rejects(recordOwnRepPMarking(context,
      { attemptId: 'attempt-no-address', workDate: '2026-10-18', executionUnitId, channel: 'browser' }, dependencies),
    { code: 'REP_P_RECEIPT_PREREQUISITES_MISSING' });
    assert.equal((await hrDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), nsrBefore);
    await execution.update({ address: 'Rua operacional, 2' });

    const replay = await recordOwnRepPMarking(context,
      { attemptId: 'attempt-1', workDate: '2026-10-18', executionUnitId, channel: 'mobile' },
      { ...dependencies, clock: { async read() { throw new Error('clock must not run during replay'); } } });
    assert.equal(replay.status, 'replayed');
    assert.equal(replay.marking.nsr, first.marking.nsr);
    assert.equal(replay.receiptStatus, 'available');

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
    const exportAudit = await hrDbAdmin.collection('repP_exportAudit').where('establishmentId', '==', establishmentId).get();
    assert.equal(exportAudit.size, 6);
    assert.ok(exportAudit.docs.some((doc) => doc.get('sha256') === afd.sha256));

    const eventSnapshot = await hrDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get();
    const attemptSnapshot = await hrDbAdmin.collection('repP_attempts').where('employeeId', '==', userId).get();
    assert.equal(eventSnapshot.size, 4);
    assert.equal(attemptSnapshot.size, 2);
    const markingEvents = eventSnapshot.docs.filter((doc) => doc.get('recordType') === '7');
    assert.equal(markingEvents.length, 2);
    assert.ok(markingEvents.every((doc) => doc.get('trustedClock.attestationId') === 'a'.repeat(64)
      && doc.get('trustedClock.quorum') === 2 && doc.get('trustedClock.observations').length === 2));
    allRefs.push(...eventSnapshot.docs.map((doc) => doc.ref), ...attemptSnapshot.docs.map((doc) => doc.ref),
      ...exportAudit.docs.map((doc) => doc.ref));
  } finally {
    const referenceEmployee = hrDbAdmin.collection('repP_employees')
      .doc(repPIdentifiersForTest.employeeKey(establishmentId, userId));
    const referenceEstablishment = hrDbAdmin.collection('repP_establishments').doc(establishmentId);
    const [eventsToDelete, attemptsToDelete, exportsToDelete, receiptsToDelete] = await Promise.all([
      hrDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get(),
      hrDbAdmin.collection('repP_attempts').where('employeeId', '==', userId).get(),
      hrDbAdmin.collection('repP_exportAudit').where('establishmentId', '==', establishmentId).get(),
      hrDbAdmin.collection('repP_receipts').where('establishmentId', '==', establishmentId).get(),
    ]);
    await Promise.all([...allRefs, ...eventsToDelete.docs.map((doc) => doc.ref), ...attemptsToDelete.docs.map((doc) => doc.ref),
      ...exportsToDelete.docs.map((doc) => doc.ref), ...receiptsToDelete.docs.map((doc) => doc.ref),
      referenceEmployee, referenceEstablishment, cpfField, employee, employer, execution, user]
      .map((ref) => ref.delete().catch(() => undefined)));
    const headId = createHash('sha256').update(JSON.stringify([workspaceId, userId])).digest('hex');
    const cleanup = await Promise.all(['dp_employmentReferenceHistories', 'dp_employmentReferenceRequests']
      .map((collection) => dbAdmin.collection(collection).where('userId', '==', userId).get()));
    await Promise.all([...cleanup.flatMap((snapshot) => snapshot.docs.map((doc) => doc.ref)),
      dbAdmin.collection('dp_employmentReferenceHeads').doc(headId)].map((ref) => ref.delete().catch(() => undefined)));
  }
});
