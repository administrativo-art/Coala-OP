import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { exportSignedRepPAfd, getOwnRepPReceipt, listOwnRepPExecutionUnits, listOwnRepPMarkings, listPendingRepPReceipts, provisionRepPReferenceData,
  recordOwnRepPMarking, repPIdentifiersForTest, retryOwnRepPReceipt } = await import('../../src/features/dp/rep-p/service.server.ts');
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
    assurance: 'hlb_verified', observedOffsetMs: 12, verifiedAt: new Date() }; } };
  const profile = { establishmentId, employerCnpj, employerLegalName: 'CT Sorvetes LTDA',
    inpiRegistration: '12345678901234567', developerCnpj: employerCnpj };
  const dependencies = { repDb: hrDbAdmin, mainDb: dbAdmin, hrDb: hrDbAdmin, clock,
    signer: { async signDetached(bytes) { assert.ok(bytes.length > 0); return { bytes: Buffer.from('synthetic-cades'),
      format: 'CAdES', detached: true, certificateCnpj: employerCnpj }; } },
    receiptSigner: { async signPdf() { throw new Error('PAdES indisponível no primeiro ensaio'); } } };
  // Certificado autoassinado gerado no teste: exercita a assinatura real sem credencial ICP-Brasil.
  const icpSigners = createRepPIcpSigners(loadRepPIcpIdentity(createTestIcpCredential().pem, employerCnpj));
  const padesSigner = icpSigners.pades;
  const allRefs = [];
  try {
    await Promise.all([
      employer.set({ name: 'Empregadora', address: 'Rua fiscal, 1', cnpj: employerCnpj, timeZone: 'America/Belem' }),
      execution.set({ name: 'Execução excepcional', address: 'Rua operacional, 2', cnpj: '11222333000181', timeZone: 'America/Belem' }),
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
    assert.deepEqual(options.officialClock, { available: true, instant: '2026-10-18T11:15:42.000Z', timeZone: 'America/Belem' });
    assert.deepEqual((await listOwnRepPExecutionUnits(context, { workDate: '2026-10-18' }, { ...dependencies,
      clock: { async read() { throw new Error('fonte fora do ar'); } } })).officialClock,
    { available: false, issue: 'REP_P_TIME_UNAVAILABLE' });
    assert.deepEqual(options.executionUnits.map((unit) => [unit.id, unit.employer]),
      [[employerUnitId, true], [executionUnitId, false]]);
    assert.deepEqual((await listOwnRepPExecutionUnits({ ...context, decoded: { uid: `${prefix}-nobody` } },
      { workDate: '2026-10-18' }, dependencies)).executionUnits, []);

    const [first, second] = await Promise.all([
      recordOwnRepPMarking(context, { attemptId: 'attempt-1', workDate: '2026-10-18', executionUnitId, channel: 'mobile' }, dependencies),
      recordOwnRepPMarking(context, { attemptId: 'attempt-2', workDate: '2026-10-18', executionUnitId, channel: 'browser' }, dependencies),
    ]);
    assert.equal(first.status, 'recorded');
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
    const contents = Buffer.from(afd.afdBase64, 'base64').toString('latin1');
    assert.equal(contents.match(/\r\n/g)?.length, afd.lineCount);
    assert.ok(contents.includes(first.marking.hash));
    assert.ok(contents.includes(second.marking.hash));
    const exportAudit = await hrDbAdmin.collection('repP_exportAudit').where('establishmentId', '==', establishmentId).get();
    assert.equal(exportAudit.size, 2);
    assert.ok(exportAudit.docs.some((doc) => doc.get('sha256') === afd.sha256));

    const eventSnapshot = await hrDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId).get();
    const attemptSnapshot = await hrDbAdmin.collection('repP_attempts').where('employeeId', '==', userId).get();
    assert.equal(eventSnapshot.size, 4);
    assert.equal(attemptSnapshot.size, 2);
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
