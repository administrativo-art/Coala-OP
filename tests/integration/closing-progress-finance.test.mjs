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
const { financialDbAdmin } = await import('../../src/lib/firebase-financial-admin.ts');
const { readClosingProgress } = await import('../../src/features/dp/time-adjustments/closing-progress.server.ts');
const { previewPayrollFinance, submitPayrollFinance, readPayrollFinance, listPayrollFinanceTitles } = await import('../../src/features/dp/time-adjustments/payroll-finance.server.ts');
const hash = (value) => createHash('sha256').update(value).digest('hex');

test('acompanhamento e conferência financeira preservam títulos e segregam salário, guia e pagamento', async () => {
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
  const selection={grantId,employeeUid:uid,includePayslip:false};
  const preview=await previewClosureRelease(context,selection,deps);
  const delivery=await releaseClosureToProvider(context,{...selection,requestId:randomUUID(),expectedSourceHash:preview.sourceHash,expectedEmploymentProofHash:preview.employmentProofHash},deps);
  const reconciliationDeps={mainDb:dbAdmin,hrDb:hrDbAdmin,now,randomId:randomUUID,readStorage:async()=>pdf,releaseDependencies:deps};
  const progressDeps={mainDb:dbAdmin,hrDb:hrDbAdmin,now};
  assert.equal((await readClosingProgress(context,competence,progressDeps)).people[0].phase,'awaiting_review');
  const payslipRef=hrDbAdmin.collection('employeeDocuments').doc(documentId),originalPayslip=(await payslipRef.get()).data();
  await payslipRef.delete();assert.equal((await readClosingProgress(context,competence,progressDeps)).people[0].phase,'awaiting_payslip');await payslipRef.set(originalPayslip);
  const review=await submitPayslipReconciliation(context,{competence,employeeUid:uid,releaseId:delivery.releaseId,documentId,documentHash:pdfHash,lines:[{kind:'overtime',unit:'minutes',quantity:60,ratePercent:50}],absentKinds:['discount','expired_credit','bank_payroll'],acknowledgment:true,expectedVersion:0,requestId:randomUUID()},reconciliationDeps);
  assert.equal((await readClosingProgress(context,competence,progressDeps)).people[0].phase,'ready');
  await payslipRef.update({contentHash:'b'.repeat(64)});assert.equal((await readClosingProgress(context,competence,progressDeps)).people[0].phase,'stale');await payslipRef.update({contentHash:pdfHash});
  const packageRef=frozen.collection('packages').doc(uid);
  for(const [status,phase] of [['signed','signed'],['sending','sending'],['refused','refused'],['failed','send_failed'],['sent','awaiting_signature']]){
    await packageRef.set({uid,status,signatureRequestId:randomUUID(),sentAt:now().toISOString(),signedAt:status==='signed'?now().toISOString():null});
    assert.equal((await readClosingProgress(context,competence,progressDeps)).people[0].phase,phase);
  }
  await packageRef.update({sentAt:'2026-03-01T00:00:00Z'});assert.equal((await readClosingProgress(context,competence,progressDeps)).people[0].phase,'overdue');await packageRef.delete();
  const files=new Map([['local-test/payslip.pdf',pdf]]),financeDeps={mainDb:dbAdmin,hrDb:hrDbAdmin,financialDb:financialDbAdmin,now,randomId:randomUUID,readStorage:async(path)=>{if(!files.has(path))throw Error('unexpected storage');return files.get(path);},reconciliation:reconciliationDeps};
  const salaryId=randomUUID(),salaryRef=financialDbAdmin.collection('expenses').doc(salaryId);
  const salary={workspaceId,status:'pending',provisionType:'actual',payrollEarningType:'salary',employeeId:uid,employeeUserId:uid,payrollIdentityKey:`payroll:salary:${competence}:${uid}`,provisionCompetence:competence,competenceMonth:competence,totalValue:1000,netPayableValue:950,description:'Salário teste'};
  await salaryRef.set(salary);const salaryQuery={mode:'salary',competence,employeeUid:uid,expenseId:salaryId};
  assert.equal((await listPayrollFinanceTitles(context,{mode:'salary',competence,employeeUid:uid},financeDeps)).titles[0].id,salaryId);
  const input={...salaryQuery,amountCents:90000,acknowledgment:true};
  const mismatch=await previewPayrollFinance(context,input,financeDeps);assert.equal(mismatch.comparison.status,'divergent');assert.equal(mismatch.comparison.nominalCents,100000);assert.equal(mismatch.comparison.titleCents,95000);
  const first={...input,expectedVersion:0,expectedSourceHash:mismatch.sourceHash,requestId:randomUUID()};
  const [one,retry]=await Promise.all([submitPayrollFinance(context,first,financeDeps),submitPayrollFinance(context,first,financeDeps)]);assert.equal(one.id,retry.id);
  const correct={...input,amountCents:95000};const matched=await previewPayrollFinance(context,correct,financeDeps);assert.equal(matched.comparison.status,'match');
  await submitPayrollFinance(context,{...correct,expectedVersion:1,expectedSourceHash:matched.sourceHash,requestId:randomUUID()},financeDeps);
  assert.equal((await readPayrollFinance(context,salaryQuery,financeDeps)).current.status,'match');assert.deepEqual((await salaryRef.get()).data(),salary);
  await salaryRef.update({status:'paid'});assert.equal((await readPayrollFinance(context,salaryQuery,financeDeps)).current.status,'match');await salaryRef.update({status:'pending'});
  await salaryRef.update({netPayableValue:960});assert.equal((await readPayrollFinance(context,salaryQuery,financeDeps)).current.status,'stale');await salaryRef.update({netPayableValue:950});
  const duplicate=financialDbAdmin.collection('expenses').doc(randomUUID());await duplicate.set(salary);await assert.rejects(previewPayrollFinance(context,correct,financeDeps));await duplicate.delete();
  const permissions=structuredClone(defaultAdminPermissions);permissions.financial.view=false;
  await assert.rejects(readPayrollFinance({...context,isDefaultAdmin:false,permissions},salaryQuery,financeDeps));
  await assert.rejects(readPayrollFinance({...context,workspace_id:'foreign'},salaryQuery,financeDeps));
  const {FieldValue}=await import('firebase-admin/firestore');
  await salaryRef.update({employeeUserId:FieldValue.delete()});assert.equal((await previewPayrollFinance(context,correct,financeDeps)).comparison.status,'match');
  const collisionUser= dbAdmin.collection('users').doc(employeeId);
  await collisionUser.set({username:'Other person',hrEmployeeId:'other-'+randomUUID()});
  await salaryRef.update({employeeId,employeeUserId:FieldValue.delete(),payrollIdentityKey:`payroll:salary:${competence}:${employeeId}`});
  await assert.rejects(previewPayrollFinance(context,correct,financeDeps));
  await salaryRef.update({employeeUserId:uid});assert.equal((await previewPayrollFinance(context,correct,financeDeps)).comparison.status,'match');
  await collisionUser.delete();await salaryRef.set(salary);
  const collisionEmployee=hrDbAdmin.collection('employees').doc(uid);
  await collisionEmployee.set({auth_uid:'other-user',source_user_id:'other-user'});await salaryRef.update({employeeUserId:FieldValue.delete()});await assert.rejects(previewPayrollFinance(context,correct,financeDeps));await collisionEmployee.delete();await salaryRef.set(salary);
  const guideId=randomUUID(),messageId=randomUUID(),attachmentId=randomUUID();const guideRef=financialDbAdmin.collection('expenses').doc(guideId);
  const fiscalIdentity={documentKind:'fgts',taxpayerTaxId:cnpj,documentNumber:'FGTS-123'};
  const allocations=[{employeeId:uid,employeeName:'Pessoa teste',analysisType:'employer_cost',accountPlanId:'fgts',accountPlanName:'FGTS',amount:70,resultCenter:'A',payrollDocumentId:documentId},{employeeId,employeeName:'Pessoa teste',analysisType:'employee_deduction',accountPlanId:'loan',accountPlanName:'Consignado',amount:30,resultCenter:'A',payrollDocumentId:documentId}];
  const guide={workspaceId,status:'paid',provisionType:'actual',competenceMonth:competence,totalValue:100,netPayableValue:90,description:'Guia FGTS e consignado',fiscalIdentity,hasAccountAllocations:true,accountAllocations:[{accountPlanId:'fgts',amount:70},{accountPlanId:'loan',amount:30}],hasPersonAllocations:true,personAllocations:allocations};
  await guideRef.set(guide);files.set('guide-one.pdf',pdf);
  const message={workspaceId,linkedExpenseId:guideId,reviewedAt:now().toISOString(),classification:{documentType:'fgts',competence,fiscalIdentity},attachments:[{id:attachmentId,filename:'Guia.pdf',contentType:'application/pdf',size:pdf.length,archiveStatus:'stored',storagePath:'guide-one.pdf',sha256:pdfHash}]};
  await financialDbAdmin.collection('financialInboxMessages').doc(messageId).set(message);
  const guideQuery={mode:'guide',competence,employeeUid:uid,expenseId:guideId};const guideInput={...guideQuery,amountCents:10000,acknowledgment:true,document:{messageId,attachmentId,sha256:pdfHash,documentKind:'fgts',documentNumber:'FGTS-123',taxpayerCnpj:cnpj,competence}};
  const messageRef=financialDbAdmin.collection('financialInboxMessages').doc(messageId);
  await messageRef.update({'classification.fiscalIdentity.documentNumber':'FGTS-999'});await assert.rejects(previewPayrollFinance(context,guideInput,financeDeps));await messageRef.set(message);
  await guideRef.update({'fiscalIdentity.documentKind':'darf'});await assert.rejects(previewPayrollFinance(context,guideInput,financeDeps));await guideRef.set(guide);
  await messageRef.update({attachments:[...message.attachments,{...message.attachments[0],id:randomUUID(),filename:'Payment-receipt.pdf'}]});await assert.rejects(previewPayrollFinance(context,guideInput,financeDeps));await messageRef.set(message);
  for(const patch of [{documentNumber:'FGTS-999'},{documentKind:'darf'},{taxpayerCnpj:'14276603000125'},{competence:'2026-03'}])await assert.rejects(previewPayrollFinance(context,{...guideInput,document:{...guideInput.document,...patch}},financeDeps));
  const oldEmployee=randomUUID();await hrDbAdmin.collection('employees').doc(oldEmployee).set({auth_uid:uid,source_user_id:uid});
  const mixed=[{...allocations[0],employeeId:oldEmployee},{...allocations[1],employeeId}];
  for(const ordered of [mixed,[...mixed].reverse()]){await guideRef.update({personAllocations:ordered});await assert.rejects(previewPayrollFinance(context,guideInput,financeDeps));}
  await guideRef.set(guide);await hrDbAdmin.collection('employees').doc(oldEmployee).delete();
  const guidePreview=await previewPayrollFinance(context,guideInput,financeDeps);assert.equal(guidePreview.comparison.status,'match');assert.equal(guidePreview.comparison.titleCents,10000);assert.equal(guidePreview.comparison.allocationCents,10000);assert.equal(guidePreview.lines.length,2);
  const transactionRaceDb={collection:(...args)=>financialDbAdmin.collection(...args),runTransaction:async callback=>{await messageRef.update({'classification.fiscalIdentity.documentNumber':'FGTS-999'});return financialDbAdmin.runTransaction(callback);}};
  await assert.rejects(submitPayrollFinance(context,{...guideInput,expectedSourceHash:guidePreview.sourceHash,expectedVersion:0,requestId:randomUUID()},{...financeDeps,financialDb:transactionRaceDb}));await messageRef.set(message);
  const guideSnapshot=await guideRef.get();await guideRef.update({totalValue:101});await assert.rejects(submitPayrollFinance(context,{...guideInput,expectedSourceHash:guidePreview.sourceHash,expectedVersion:0,requestId:randomUUID()},financeDeps));await guideRef.set(guideSnapshot.data());
  await guideRef.update({hasPersonAllocations:false});await assert.rejects(previewPayrollFinance(context,guideInput,financeDeps));await guideRef.update({hasPersonAllocations:true});
  await guideRef.update({accountAllocations:[{accountPlanId:'fgts',amount:70},{accountPlanId:'fgts',amount:30}]});assert.equal((await previewPayrollFinance(context,guideInput,financeDeps)).comparison.status,'divergent');await guideRef.update({accountAllocations:guide.accountAllocations});
  const divergent=await previewPayrollFinance(context,{...guideInput,amountCents:11000},financeDeps);assert.equal(divergent.comparison.status,'divergent');
  await submitPayrollFinance(context,{...guideInput,amountCents:11000,expectedSourceHash:divergent.sourceHash,expectedVersion:0,requestId:randomUUID()},financeDeps);
  const finalGuide=await previewPayrollFinance(context,guideInput,financeDeps);await submitPayrollFinance(context,{...guideInput,expectedSourceHash:finalGuide.sourceHash,expectedVersion:1,requestId:randomUUID()},financeDeps);
  assert.equal((await readPayrollFinance(context,guideQuery,financeDeps)).current.status,'match');assert.deepEqual((await guideRef.get()).data(),guide);
  const cloneId=randomUUID(),cloneMessage=randomUUID(),cloneAttachment=randomUUID(),clonePdf=Buffer.concat([pdf,Buffer.from('\n')]),cloneHash=hash(clonePdf);files.set('guide-two.pdf',clonePdf);
  await financialDbAdmin.collection('expenses').doc(cloneId).set(guide);
  await financialDbAdmin.collection('financialInboxMessages').doc(cloneMessage).set({...message,linkedExpenseId:cloneId,attachments:[{...message.attachments[0],id:cloneAttachment,size:clonePdf.length,sha256:cloneHash,storagePath:'guide-two.pdf'}]});
  const cloned={...guideInput,expenseId:cloneId,document:{...guideInput.document,messageId:cloneMessage,attachmentId:cloneAttachment,sha256:cloneHash}};const clonedPreview=await previewPayrollFinance(context,cloned,financeDeps);
  await assert.rejects(submitPayrollFinance(context,{...cloned,expectedSourceHash:clonedPreview.sourceHash,expectedVersion:0,requestId:randomUUID()},financeDeps));
  assert.equal((await financialDbAdmin.collection('bankPaymentRequests').where('workspaceId','==',workspaceId).limit(1).get()).size,0);
  assert.equal((await financialDbAdmin.collection('payrollFinancialReviews').where('workspaceId','==',workspaceId).limit(10).get()).size,4);
  await user.update({workspaceId,workspace_id:workspaceId});await dbAdmin.collection('users').doc(context.decoded.uid).set({workspaceId,workspace_id:workspaceId,username:'Revisor'});
  const {collectPersonSource}=await import('../../src/features/privacy/person-inventory.server.ts');
  const subjects=await collectPersonSource({actor:context,sourceId:'payroll-money-review-subjects',ref:{namespace:'main.users',id:uid},limit:20});assert.equal(subjects.items.length,4);
  const actors=await collectPersonSource({actor:context,sourceId:'payroll-money-review-actors',ref:{namespace:'main.users',id:uid},limit:20});assert.equal(actors.items.length,0);
  assert.equal((await collectPersonSource({actor:{...context,viewAs:{targetUserId:uid,targetUsername:'Pessoa',readOnly:true}},sourceId:'payroll-money-review-subjects',ref:{namespace:'main.users',id:uid},limit:20})).status,'restricted');
  await closure.update({status:'open'});await assert.rejects(previewPayrollFinance(context,guideInput,financeDeps));
});

test('conferências financeiras não admitem leitura/escrita pelo cliente administrador',async()=>{
 const {readFile}=await import('node:fs/promises');const {initializeTestEnvironment,assertFails,assertSucceeds}=await import('@firebase/rules-unit-testing');const {doc,getDoc,setDoc}=await import('firebase/firestore');
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');const env=await initializeTestEnvironment({projectId:'demo-coala-repository',firestore:{host,port:Number(port),rules:await readFile(new URL('../../firestore.financial.rules',import.meta.url),'utf8')}});
 try{await env.withSecurityRulesDisabled(async ctx=>{await setDoc(doc(ctx.firestore(),'users/finance-admin'),{active:true,isDefaultAdmin:true,sessionVersion:0,permissions:{view:true,expenses:{view:true}}});await setDoc(doc(ctx.firestore(),'expenses/expense-existing'),{workspaceId:'coala',status:'pending',totalValue:100});});
 const client=env.authenticatedContext('finance-admin',{isDefaultAdmin:true,sessionVersion:0}).firestore();await assertSucceeds(getDoc(doc(client,'expenses/expense-existing')));
 for(const collection of ['payrollFinancialReviews','payrollFinancialReviewState','payrollFinancialReviewClaims']){await assertFails(getDoc(doc(client,collection+'/private')));await assertFails(setDoc(doc(client,collection+'/private'),{workspaceId:'coala'}));}
 }finally{await env.cleanup();}
});
