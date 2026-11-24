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
const { previewClosureRelease, releaseClosureToProvider } = await import('../../src/features/service-portal/closure-server.ts');
const { PDFDocument } = await import('pdf-lib');
const { readPayslipReconciliation, previewPayslipReconciliation, submitPayslipReconciliation, readReconciliationPayslip, assertCurrentPayslipReconciliation, reserveReconciliationForPackage, releaseReconciliationPackageLease } = await import('../../src/features/dp/time-adjustments/payslip-reconciliation.server.ts');
const { sendClosingPackage, syncClosingPackageSignature } = await import('../../src/features/dp/time-adjustments/closing-package.server.ts');
const hash = (value) => createHash('sha256').update(value).digest('hex');

test('retorno versionado bloqueia assinatura divergente e libera somente documento e entrega atuais', async () => {
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
  main.set(user, { username: 'Pessoa teste', email: 'person@example.test', hrEmployeeId: employeeId, unitId: employerUnitId, unitIds: [employerUnitId] });
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
  const pdfDoc = await PDFDocument.create(); pdfDoc.addPage([595, 842]); const pdf = Buffer.from(await pdfDoc.save()); const pdfHash = hash(pdf); const documentId = randomUUID();
  const hr = hrDbAdmin.batch();
  hr.set(closure, { workspaceId, competence, status: 'closed', version: 1, peopleCount: 1, manifestHash });
  hr.set(frozen, { manifestHash, workspaceId, competence, status: 'closed' });
  hr.set(frozen.collection('people').doc(uid), { uid, name: 'Pessoa teste', adjustments: [], absences: [], shiftSwaps: [] });
  hr.set(frozen.collection('mirrors').doc(uid), { snapshot, snapshotHash: mirrorHash, rendererVersion: MIRROR_RENDERER_VERSION });
  hr.set(bank, { schemaVersion: 1, algorithmVersion: TIME_BANK_ALGORITHM_VERSION, uid, competence, closureVersion: 1,
    days, totals: monthTotals(days), inputHash: 'b'.repeat(64), generatedAt: '2026-03-03T12:00:00Z', createdBy: 'manager', policies: [{ id: policyId, version: 1 }] });
  hr.set(hrDbAdmin.collection('employees').doc(employeeId), { auth_uid: uid, source_user_id: uid });
  hr.set(hrDbAdmin.collection('employeeDocuments').doc(documentId), { employeeId, documentTypeCode: 'PAYSLIP', caseId: 'month-' + competence,
    version: 1, storagePath: 'local-test/payslip.pdf', contentHash: pdfHash, status: 'approved' });
  await hr.commit();
  const context = { decoded: { uid: 'manager' }, workspace_id: workspaceId, userDoc: {}, permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true };
  const principal = { memberId, officeId, workspaceId, name: 'Contador teste', email: 'accountant@example.test', accountType: 'service_provider', profile: 'accounting' };
  const now = () => new Date('2026-03-04T12:00:00Z');
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, now, randomId: randomUUID, readStorage: async () => pdf,
    readReadiness: (actor, month) => readPayrollReadiness(actor, month, { mainDb: dbAdmin, hrDb: hrDbAdmin }),
    readStatement: (workspace, person, month, tx) => readBankStatementForProvider(workspace, person, month, tx, { mainDb: dbAdmin, hrDb: hrDbAdmin, now }),
  };
  const selection = { grantId, employeeUid: uid, includePayslip: false };
  const preview = await previewClosureRelease(context, selection, deps);
  const delivered = await releaseClosureToProvider(context, { ...selection, requestId: randomUUID(), expectedSourceHash: preview.sourceHash, expectedEmploymentProofHash: preview.employmentProofHash }, deps);
  const reconciliationDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, now, randomId: randomUUID, readStorage: async () => pdf, releaseDependencies: deps };
  const query = { competence, employeeUid: uid };
  const input = { ...query, releaseId: delivered.releaseId, documentId, documentHash: pdfHash,
    lines: [{ kind: 'overtime', unit: 'minutes', quantity: 30, ratePercent: 50 }], absentKinds: ['discount','expired_credit','bank_payroll'], acknowledgment: true };
  const before = await hrDbAdmin.collection('ptrp_payslipReconciliations').where('workspaceId','==',workspaceId).limit(10).get();
  assert.equal((await readPayslipReconciliation(context, query, reconciliationDeps)).version,0);
  assert.equal((await previewPayslipReconciliation(context,input,reconciliationDeps)).comparison.status,'divergent');
  assert.equal((await hrDbAdmin.collection('ptrp_payslipReconciliations').where('workspaceId','==',workspaceId).limit(10).get()).size,before.size);
  const firstInput = {...input,expectedVersion:0,requestId:randomUUID()};
  const [first,replay] = await Promise.all([submitPayslipReconciliation(context,firstInput,reconciliationDeps),submitPayslipReconciliation(context,firstInput,reconciliationDeps)]);
  assert.equal(first.id,replay.id);
  const effects = {sign:0,save:0,create:0}; const files = new Map();
  const packageDeps = {mainDb:dbAdmin,hrDb:hrDbAdmin,now,mirror:{mainDb:dbAdmin,hrDb:hrDbAdmin},reconciliationDependencies:reconciliationDeps,
    storage:{download:async()=>pdf, save:async(path,bytes)=>{effects.save++;files.set(path,bytes);}},
    sign:async()=>{effects.sign++;return {bytes:Buffer.from('test-signature'),certificateCnpj:cnpj};},
    createDocument:async()=>{effects.create++;return {sandbox:true,document:{id:randomUUID(),created_at:now().toISOString()}};}};
  const send = {action:'send',...query,expectedVersion:1};
  await assert.rejects(sendClosingPackage(context,send,packageDeps));
  assert.deepEqual(effects,{sign:0,save:0,create:0});
  const corrected = {...input,lines:[{kind:'overtime',unit:'minutes',quantity:60,ratePercent:50}],expectedVersion:1,requestId:randomUUID()};
  const match = await submitPayslipReconciliation(context,corrected,reconciliationDeps);
  assert.equal(match.comparison.status,'match');
  assert.equal((await readPayslipReconciliation(context,query,reconciliationDeps)).current.id,match.id);
  assert.equal(hash((await readReconciliationPayslip(context,{...query,documentId,documentHash:pdfHash},reconciliationDeps)).bytes),pdfHash);
  await assert.rejects(readPayslipReconciliation({...context,workspace_id:'different'},query,reconciliationDeps));
  const {collectPersonSource} = await import('../../src/features/privacy/person-inventory.server.ts');
  await user.update({workspaceId,workspace_id:workspaceId});
  await dbAdmin.collection('users').doc(context.decoded.uid).set({workspaceId,workspace_id:workspaceId,username:'Revisor'});
  for (const [sourceId,person,count] of [['payslip-reconciliation-employees',uid,2],['payslip-reconciliation-actors',uid,0],['payslip-reconciliation-actors',context.decoded.uid,2],['payslip-reconciliation-state-employees',uid,1],['payslip-reconciliation-audit-employees',uid,1]]) {
    const inventory = await collectPersonSource({actor:context,sourceId,ref:{namespace:'main.users',id:person},limit:20});
    assert.equal(inventory.status,'complete',sourceId); assert.equal(inventory.items.length,count,sourceId);
  }
  const lease = await reserveReconciliationForPackage(context,{...query,closureVersion:1},reconciliationDeps);
  await assert.rejects(submitPayslipReconciliation(context,{...corrected,expectedVersion:2,requestId:randomUUID()},reconciliationDeps));
  await releaseReconciliationPackageLease(context,query,lease.lease,reconciliationDeps);
  const secondPreview = await previewClosureRelease(context,selection,deps);
  const second = await releaseClosureToProvider(context,{...selection,requestId:randomUUID(),expectedSourceHash:secondPreview.sourceHash,expectedEmploymentProofHash:secondPreview.employmentProofHash},deps);
  assert.equal((await readPayslipReconciliation(context,query,reconciliationDeps)).current.status,'stale');
  await assert.rejects(sendClosingPackage(context,send,packageDeps));
  assert.deepEqual(effects,{sign:0,save:0,create:0});
  const refreshed = await submitPayslipReconciliation(context,{...corrected,releaseId:second.releaseId,expectedVersion:2,requestId:randomUUID()},reconciliationDeps);
  await hrDbAdmin.collection('employeeDocuments').doc(documentId).update({contentHash:'f'.repeat(64)});
  await assert.rejects(assertCurrentPayslipReconciliation(context,{...query,closureVersion:1},reconciliationDeps));
  await assert.rejects(sendClosingPackage(context,send,packageDeps));
  assert.deepEqual(effects,{sign:0,save:0,create:0});
  await hrDbAdmin.collection('employeeDocuments').doc(documentId).update({contentHash:pdfHash});
  const pack = await sendClosingPackage(context,send,packageDeps);
  assert.equal(pack.status,'sent'); assert.equal(pack.reconciliation.id,refreshed.id);
  assert.equal(effects.create,1); assert.equal(effects.sign,1); assert.equal(effects.save,2);
  assert.ok(files.has(pack.bundle.storagePath));
  assert.equal((await hrDbAdmin.collection('hrSignatureRequests').doc(pack.signatureRequestId).get()).get('reconciliation.id'),refreshed.id);
  await assert.rejects(submitPayslipReconciliation(context,{...corrected,releaseId:second.releaseId,expectedVersion:3,requestId:randomUUID()},reconciliationDeps));
  assert.equal((await sendClosingPackage(context,send,packageDeps)).signatureRequestId,pack.signatureRequestId);
  assert.equal(effects.create,1);
  // A result from an older provider call must update only its own historical attempt.
  await syncClosingPackageSignature({signatureRequestId:pack.signatureRequestId,eventType:'signature.rejected'},packageDeps);
  let providerEntered;const entered=new Promise(resolve=>{providerEntered=resolve;});
  let providerContinue;const continuation=new Promise(resolve=>{providerContinue=resolve;});
  const delayed=sendClosingPackage(context,send,{...packageDeps,createDocument:async()=>{providerEntered();await continuation;return {sandbox:true,document:{id:'late-provider-id',created_at:now().toISOString()}};}});
  await entered;
  const target=frozen.collection('packages').doc(uid);
  const pending=(await target.get()).data();
  const newer={...pending,attempt:3,signatureRequestId:pending.signatureRequestId+'_new',status:'sent',providerDocumentId:'new-provider',
    reconciliation:{...pending.reconciliation,id:'newer-review'},bundle:{...pending.bundle,sha256:'e'.repeat(64)},
    attempts:[...pending.attempts,{attempt:pending.attempt,signatureRequestId:pending.signatureRequestId,providerDocumentId:null,sentAt:null,endedStatus:'sending',bundle:pending.bundle,employerSignaturePath:pending.employerSignature.storagePath,reconciliation:pending.reconciliation}]};
  await target.set(newer);providerContinue();const late=await delayed;
  assert.equal(late.signatureRequestId,newer.signatureRequestId);assert.equal(late.providerDocumentId,'new-provider');assert.equal(late.status,'sent');
  assert.equal(late.attempts.find(a=>a.signatureRequestId===pending.signatureRequestId).providerDocumentId,'late-provider-id');
  await closure.update({status:'open'});
  await assert.rejects(assertCurrentPayslipReconciliation(context,{...query,closureVersion:1},reconciliationDeps));
  await closure.update({status:'closed'});
  const history=await dbAdmin.collection('dp_employmentReferenceHistories').doc(historyId).get();
  const originalPeriod=history.get('periods')[0];
  await dbAdmin.collection('dp_employmentReferenceHistories').doc(historyId).update({periods:[{...originalPeriod,validTo:'2026-02-27'},{...originalPeriod,validFrom:'2026-02-28',employerUnitId:'other-employer',employer:{...originalPeriod.employer,unitId:'other-employer',cnpj:'14276603000125'}}]});
  // Activity still belongs to A, so an events-only release can exist. The indivisible returned PDF must fail.
  const mixedPreview=await previewClosureRelease(context,selection,deps);
  const mixed=await releaseClosureToProvider(context,{...selection,requestId:randomUUID(),expectedSourceHash:mixedPreview.sourceHash,expectedEmploymentProofHash:mixedPreview.employmentProofHash},deps);
  await assert.rejects(previewPayslipReconciliation(context,{...input,releaseId:mixed.releaseId},reconciliationDeps));

  assert.equal((await hrDbAdmin.collection('ptrp_payslipReconciliations').where('workspaceId','==',workspaceId).limit(10).get()).size,3);
});

test('conferências de retorno recusam acesso direto pelo cliente RH administrador', async () => {
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
    for (const collection of ['ptrp_payslipReconciliations', 'ptrp_payslipReconciliationState', 'ptrp_payslipReconciliationAudit']) {
      await assertFails(getDoc(doc(client, collection + '/private-test')));
      await assertFails(setDoc(doc(client, collection + '/private-test'), { employeeUid: 'private-test' }));
    }
  } finally { await env.cleanup(); }
});


test('webhook antigo preserva tentativa nova e arquiva sua assinatura somente no histórico',async()=>{
 const workspaceId='callback-'+randomUUID(),uid=randomUUID(),competence='2026-02';
 const target=hrDbAdmin.collection('ptrp_competenceClosures').doc(workspaceId+'_'+competence).collection('versions').doc('1').collection('packages').doc(uid);
 const pdf=await PDFDocument.create();pdf.addPage();const bytes=Buffer.from(await pdf.save());
 const stamp={id:'review-one',inputHash:'a'.repeat(64),releaseId:'release-one',documentId:'pdf-one',documentHash:'b'.repeat(64),documentVersion:1};
 const one={schemaVersion:1,status:'sent',uid,employeeId:'hr-'+uid,competence,closureVersion:1,attempt:1,signatureRequestId:'request-'+randomUUID(),providerDocumentId:'provider1',reconciliation:stamp,
  mirrorHash:'c'.repeat(64),payslip:{documentId:'pdf-one',sha256:stamp.documentHash},bundle:{storagePath:'private/one.pdf',sha256:'d'.repeat(64),pageCount:2},employerSignature:{storagePath:'private/one.p7s',certificateCnpj:'11222333000181'},attempts:[],sentAt:'2026-03-01T00:00:00Z',createdAt:'2026-03-01T00:00:00Z',createdBy:'rh',signedAt:null,signedStoragePath:null,signedSha256:null,archivedDocumentId:null,lastError:null};
 await target.set(one);
 const request=(record)=>({purpose:'time_closing_package',workspaceId,employeeUid:uid,employeeId:record.employeeId,competence,closureVersion:1,documentHash:record.bundle.sha256,reconciliation:record.reconciliation});
 await hrDbAdmin.collection('hrSignatureRequests').doc(one.signatureRequestId).set(request(one));
 let downloadEntered;const entered=new Promise(resolve=>{downloadEntered=resolve;});let downloadContinue;const continuation=new Promise(resolve=>{downloadContinue=resolve;});
 const stored=new Map(),published=[];
 const deps={hrDb:hrDbAdmin,mainDb:dbAdmin,storage:{save:async(path,value)=>{stored.set(path,value);},download:async()=>bytes},downloadSigned:async()=>{downloadEntered();await continuation;return bytes;},publish:async(id)=>{published.push(id);}};
 const callback=syncClosingPackageSignature({signatureRequestId:one.signatureRequestId,eventType:'document.finished',signedUrl:'https://example.test/signed'},deps);
 await entered;
 const two={...one,status:'sent',attempt:2,signatureRequestId:'request-'+randomUUID(),reconciliation:{...stamp,id:'review-two'},bundle:{...one.bundle,sha256:'f'.repeat(64)},attempts:[{attempt:1,signatureRequestId:one.signatureRequestId,providerDocumentId:'provider1',sentAt:one.sentAt,endedStatus:'sent',bundle:one.bundle,employerSignaturePath:one.employerSignature.storagePath,reconciliation:stamp}]};
 await target.set(two);await hrDbAdmin.collection('hrSignatureRequests').doc(two.signatureRequestId).set(request(two));
 downloadContinue();const result=await callback;
 assert.equal(result.signatureRequestId,two.signatureRequestId);assert.equal(result.status,'sent');assert.equal(result.reconciliation.id,'review-two');assert.equal(result.signedStoragePath,null);assert.equal(result.attempts[0].endedStatus,'signed');assert.ok(stored.has(result.attempts[0].signedStoragePath));assert.equal(published.length,0);
 const archive=hrDbAdmin.collection('employeeDocuments').doc(`time_closing_${competence}_v1_${uid}`);assert.equal((await archive.get()).exists,false);
 await syncClosingPackageSignature({signatureRequestId:one.signatureRequestId,eventType:'signature.rejected'},deps);
 assert.equal((await target.get()).get('status'),'sent');assert.equal((await target.get()).get('attempts')[0].endedStatus,'signed');
 const signed=await syncClosingPackageSignature({signatureRequestId:two.signatureRequestId,eventType:'document.finished',signedUrl:'https://example.test/signed'}, {...deps,downloadSigned:async()=>bytes});
 assert.equal(signed.status,'signed');assert.equal((await archive.get()).get('signatureRequestId'),two.signatureRequestId);assert.equal((await archive.get()).get('reconciliation.id'),'review-two');assert.equal(published.length,1);
 await syncClosingPackageSignature({signatureRequestId:two.signatureRequestId,eventType:'signature.rejected'},deps);assert.equal((await target.get()).get('status'),'signed');
});
