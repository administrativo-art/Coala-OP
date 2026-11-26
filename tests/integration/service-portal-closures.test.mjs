import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { monthTotals, TIME_BANK_ALGORITHM_VERSION } = await import('../../src/features/dp/time-bank/core.ts');
const { readBankStatementForProvider, readPayrollReadiness } = await import('../../src/features/dp/time-bank/service.server.ts');
const { mirrorSnapshotHash, MIRROR_RENDERER_VERSION } = await import('../../src/features/dp/time-adjustments/mirror-core.ts');
const { listClosureReleaseCandidates, previewClosureRelease, releaseClosureToProvider, listReleasedClosures,
  readReleasedClosure, readReleasedPayslip, recordClosureAccess } = await import('../../src/features/service-portal/closure-server.ts');
const hash = (value) => createHash('sha256').update(value).digest('hex');

test('liberação individual usa extrato real e invalida versão, movimento, vínculo e concessão', async () => {
  const workspaceId = 'closure-portal-' + randomUUID();
  const uid = randomUUID(); const employeeId = randomUUID(); const grantId = randomUUID();
  const officeId = randomUUID(); const memberId = randomUUID(); const employerUnitId = randomUUID(); const policyId = randomUUID();
  const competence = '2026-02'; const manifestHash = 'a'.repeat(64); const cnpj = '11222333000181';
  const closure = hrDbAdmin.collection('ptrp_competenceClosures').doc(workspaceId + '_' + competence);
  const frozen = closure.collection('versions').doc('1');
  const days = Array.from({ length: 28 }, (_, index) => ({
    date: competence + '-' + String(index + 1).padStart(2, '0'), kind: index === 0 ? 'workday' : 'no_schedule',
    holiday: false, sunday: false, referenceMinutes: index === 0 ? 480 : null, plannedMinutes: index === 0 ? 480 : null,
    workedMinutes: index === 0 ? 540 : 0, consideredMinutes: index === 0 ? 540 : null, deltaMinutes: index === 0 ? 60 : null,
    toleranceApplied: false, abonoMinutes: 0, nightMinutes: 0, absences: [], unjustifiedAbsence: false,
    policy: { id: policyId, version: 1 }, issues: [],
    lines: index === 0 ? [{ nature: 'payroll_overtime', minutes: 60, reason: 'worked_more', ratePercent: 50 }] : [],
  }));
  days[1].absences = [{ id: 'private-absence', effect: 'excused_absence' }];
  const snapshot = {
    schemaVersion: 1, title: 'Espelho de ponto', workspaceId, competence, closureVersion: 1, manifestHash,
    employee: { uid, name: 'Pessoa teste', cpf: '12345678901' }, employer: { legalName: 'Empresa teste', cnpj },
    generatedAt: '2026-03-03T12:00:00Z', clockSource: 'server',
    days: days.map((day, index) => ({ date: day.date, shift: index === 0 ? '08–18' : null,
      pairedMinutes: index === 0 ? 540 : 0, absences: index === 1 ? ['Diagnóstico privado'] : [],
      punches: index === 0 ? ['08:00', '12:00', '13:00', '18:00'].map((time, position) =>
        ({ time, at: day.date + 'T' + time + ':00-0300', nsr: position + 1, mark: 'original' })) : [] })),
    adjustments: [], absences: [], shiftSwaps: [], actors: { unrelated: 'Revisor privado' }, truncated: false,
    arpReading: { count: 4, maxNsr: 4, readAt: '2026-03-03T12:00:00Z' },
  };
  const mirrorHash = mirrorSnapshotHash(snapshot);
  const headId = hash(JSON.stringify([workspaceId, uid])); const historyId = headId + '_r1';
  const user = dbAdmin.collection('users').doc(uid);
  const grant = dbAdmin.collection('providerPortalGrants').doc(grantId);
  const bank = frozen.collection('timeBank').doc(uid);
  const main = dbAdmin.batch();
  main.set(user, { username: 'Pessoa teste', hrEmployeeId: employeeId, unitId: employerUnitId, unitIds: [employerUnitId] });
  main.set(dbAdmin.collection('dp_units').doc(employerUnitId), { name: 'Empresa teste', cnpj });
  main.set(dbAdmin.collection('providerMembers').doc(memberId), { id: memberId, workspaceId, officeId, active: true, status: 'active', accountType: 'service_provider', profile: 'accounting' });
  main.set(dbAdmin.collection('providerOffices').doc(officeId), { id: officeId, workspaceId, active: true });
  main.set(grant, { id: grantId, workspaceId, officeId, memberId, employerUnitId, competence, revokedAt: null, expiresAt: '2026-04-01T12:00:00Z' });
  main.set(dbAdmin.collection('dp_employmentReferenceHeads').doc(headId), { revision: 1, historyId });
  main.set(dbAdmin.collection('dp_employmentReferenceHistories').doc(historyId), {
    workspaceId, userId: uid, revision: 1, historyId, periods: [{
      validFrom: '2026-02-01', employmentRelationshipType: 'clt', employerUnitId, unitId: employerUnitId, unitIds: [employerUnitId],
      jobFunctionIds: [], jobRoleName: null, jobFunctionNames: [], sourceDocumentId: 'contract', sourceReason: 'Vínculo confirmado',
      employer: { unitId: employerUnitId, unitName: 'Empresa teste', cnpj, address: 'Endereço teste', identityStatus: 'catalog_identifiers_consistent_unverified' },
    }],
  });
  main.set(dbAdmin.collection('dp_overtimePolicies').doc(policyId), {
    id: policyId, name: 'Política teste', lineageId: policyId, version: 1, status: 'published', validFrom: '2026-02-01',
    applicability: { scope: { kind: 'company' }, collaboratorIds: [uid] }, categories: [], timeBank: {
      enabled: true, allowNegativeBalance: true, cycle: { unit: 'month', length: 1, anchorDate: '2026-02-01', residualDestination: 'carry' },
    },
  });
  await main.commit();
  const pdf = Buffer.from('%PDF-1.4\n% synthetic test payslip\n%%EOF'); const pdfHash = hash(pdf); const documentId = randomUUID();
  const hr = hrDbAdmin.batch();
  hr.set(closure, { workspaceId, competence, status: 'closed', version: 1, peopleCount: 1, manifestHash });
  hr.set(frozen, { manifestHash });
  hr.set(frozen.collection('people').doc(uid), { uid, name: 'Pessoa teste', adjustments: [], absences: [], shiftSwaps: [] });
  hr.set(frozen.collection('mirrors').doc(uid), { snapshot, snapshotHash: mirrorHash, rendererVersion: MIRROR_RENDERER_VERSION });
  hr.set(bank, { schemaVersion: 1, algorithmVersion: TIME_BANK_ALGORITHM_VERSION, uid, competence, closureVersion: 1,
    days, totals: monthTotals(days), inputHash: 'b'.repeat(64), generatedAt: '2026-03-03T12:00:00Z', createdBy: 'manager', policies: [{ id: policyId, version: 1 }] });
  hr.set(hrDbAdmin.collection('employees').doc(employeeId), { auth_uid: uid, source_user_id: uid });
  hr.set(hrDbAdmin.collection('employeeDocuments').doc(documentId), { employeeId, documentTypeCode: 'PAYSLIP', caseId: 'month-' + competence,
    version: 1, storagePath: 'local-test/payslip.pdf', contentHash: pdfHash, status: 'approved' });
  hr.set(frozen.collection('packages').doc(uid), { uid, employeeId, competence, closureVersion: 1, mirrorHash,
    payslip: { documentId, sha256: pdfHash } });
  await hr.commit();
  const context = { decoded: { uid: 'manager' }, workspace_id: workspaceId, userDoc: {}, permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true };
  const principal = { memberId, officeId, workspaceId, name: 'Contador teste', email: 'accountant@example.test', accountType: 'service_provider', profile: 'accounting' };
  const now = () => new Date('2026-03-04T12:00:00Z');
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, now, randomId: randomUUID, readStorage: async () => pdf,
    readReadiness: (actor, month) => readPayrollReadiness(actor, month, { mainDb: dbAdmin, hrDb: hrDbAdmin }),
    readStatement: (workspace, person, month, tx) => readBankStatementForProvider(workspace, person, month, tx, { mainDb: dbAdmin, hrDb: hrDbAdmin, now }),
  };
  const selection = { grantId, employeeUid: uid, includePayslip: true };
  assert.equal((await listClosureReleaseCandidates(context, grantId, deps)).people[0].uid, uid);
  const preview = await previewClosureRelease(context, selection, deps);
  assert.equal(preview.content.payroll.payrollOvertimeMinutes, 60);
  const releaseInput = { ...selection, requestId: randomUUID(), expectedSourceHash: preview.sourceHash, expectedEmploymentProofHash: preview.employmentProofHash };
  const [first, retry] = await Promise.all([releaseClosureToProvider(context, releaseInput, deps), releaseClosureToProvider(context, releaseInput, deps)]);
  assert.equal(first.releaseId, retry.releaseId);
  const original = await readReleasedClosure(principal, grantId, first.releaseId, deps);
  assert.equal(original.documents.length, 1);
  assert.doesNotMatch(JSON.stringify(original), /Diagnóstico privado|Revisor privado|private-absence|12345678901/);
  assert.equal((await listReleasedClosures(principal, grantId, deps))[0].status, 'available');
  const before = await dbAdmin.collection('providerPortalAudit').where('employeeUid', '==', uid).limit(100).get();
  await listReleasedClosures(principal, grantId, deps);
  assert.equal((await dbAdmin.collection('providerPortalAudit').where('employeeUid', '==', uid).limit(100).get()).size, before.size);
  await recordClosureAccess(principal, { grantId, releaseId: first.releaseId, action: 'open' }, deps);
  assert.ok((await dbAdmin.collection('providerPortalAudit').where('employeeUid', '==', uid).limit(100).get()).size > before.size);
  assert.equal(hash((await readReleasedPayslip(principal, grantId, first.releaseId, deps)).bytes), pdfHash);
  await assert.rejects(readReleasedClosure({ ...principal, memberId: randomUUID() }, grantId, first.releaseId, deps));
  await assert.rejects(readReleasedPayslip(principal, grantId, first.releaseId, { ...deps, readStorage: async () => Buffer.from('%PDF-altered') }));
  const movement = closure.collection('timeBankMovements').doc(randomUUID());
  await movement.set({ id: movement.id, uid, competence, date: '2026-02-01', status: 'active', kind: 'compensation', minutes: 30,
    reason: 'Nota privada', createdBy: 'manager', createdAt: now().toISOString(), line: { nature: 'bank_debit', minutes: 30, reason: 'manual_compensation' } });
  assert.equal((await listReleasedClosures(principal, grantId, deps))[0].status, 'outdated');
  await assert.rejects(readReleasedClosure(principal, grantId, first.releaseId, deps));
  const nextPreview = await previewClosureRelease(context, selection, deps);
  const next = await releaseClosureToProvider(context, { ...selection, requestId: randomUUID(), expectedSourceHash: nextPreview.sourceHash, expectedEmploymentProofHash: nextPreview.employmentProofHash }, deps);
  assert.equal(next.content.payroll.debitMinutes, 30);
  await assert.rejects(readReleasedClosure(principal, grantId, first.releaseId, deps));
  await dbAdmin.collection('dp_overtimePolicies').doc(policyId).update({ 'timeBank.expirationDays': 5, 'timeBank.expiredBalanceDestination': 'payroll' });
  const credit = closure.collection('timeBankMovements').doc(randomUUID());
  await credit.set({ id: credit.id, uid, competence, date: '2026-02-01', status: 'active', kind: 'adjustment', minutes: 120,
    reason: 'Acerto reservado', createdBy: 'manager', createdAt: now().toISOString(), line: { nature: 'bank_credit', minutes: 120, reason: 'manual_adjustment' } });
  const expired = await previewClosureRelease(context, selection, deps);
  assert.ok(expired.content.payroll.expiredCreditMinutes > 0);
  assert.equal(expired.content.payroll.payrollOvertimeMinutes, 60 + expired.content.payroll.expiredCreditMinutes);
  const active = await releaseClosureToProvider(context, { ...selection, requestId: randomUUID(), expectedSourceHash: expired.sourceHash, expectedEmploymentProofHash: expired.employmentProofHash }, deps);
  await closure.update({ status: 'open' });
  assert.equal((await listReleasedClosures(principal, grantId, deps))[0].status, 'reopened');
  await assert.rejects(readReleasedClosure(principal, grantId, active.releaseId, deps));
  await closure.update({ status: 'closed' });
  await user.update({ hrEmployeeId: randomUUID() });
  assert.equal((await listReleasedClosures(principal, grantId, deps))[0].status, 'employment_changed');
  await user.update({ hrEmployeeId: employeeId });
  await grant.update({ revokedAt: now().toISOString() });
  await assert.rejects(readReleasedClosure(principal, grantId, active.releaseId, deps));
});

test('entregas contábeis recusam acesso direto pelo cliente RH administrador', async () => {
  const { readFile } = await import('node:fs/promises');
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const { doc, getDoc, setDoc } = await import('firebase/firestore');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-coala-repository',
    firestore: { host, port: Number(port), rules: await readFile(new URL('../../firestore.rh.rules', import.meta.url), 'utf8') } });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'rh_access_cache/rule-manager'), { is_active: true, session_version: 0, profile_compliance_status: 'complete', profile_compliance_policy_version: 1, rh_role: 'admin' });
      await setDoc(doc(context.firestore(), 'employees/rule-employee'), { unit_id: 'A' });
    });
    const client = env.authenticatedContext('rule-manager', { isDefaultAdmin: true, sessionVersion: 0 }).firestore();
    await assertSucceeds(getDoc(doc(client, 'employees/rule-employee')));
    for (const collection of ['providerClosureReleases', 'providerClosureAccess']) {
      await assertFails(getDoc(doc(client, collection + '/private-test')));
      await assertFails(setDoc(doc(client, collection + '/private-test'), { employeeUid: 'private-test' }));
    }
  } finally { await env.cleanup(); }
});
