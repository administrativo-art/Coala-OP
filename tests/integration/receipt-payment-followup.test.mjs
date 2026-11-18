import test from'node:test';import assert from'node:assert/strict';import{createHash}from'node:crypto';
import{assertFirestoreEmulatorSafety}from'../helpers/firestore-emulator-safety.mjs';import{enableServerOnlyTestImports}from'../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({projectId:'demo-coala-repository',databaseId:'coala-financeiro'});enableServerOnlyTestImports('demo-coala-repository');
const{financialDbAdmin:db}=await import('../../src/lib/firebase-financial-admin.ts');const{WORKSPACE_ID}=await import('../../src/lib/workspace.ts');
const{queryStoneReceiptReconciliation}=await import('../../src/features/financial/receipts-reconciliation/reconciliation.server.ts');
const{readPersistedReceiptDay,readPersistedPaymentPage}=await import('../../src/features/financial/receipts-reconciliation/payment-cache.server.ts');
const{mergeReceiptPaymentPage,receiptNextDay}=await import('../../src/features/financial/receipts-reconciliation/payment-followup.ts');
const{receiptFile,octoberReceiptCases}=await import('../helpers/receipt-payment-fixtures.ts');
const refs=new Map();const own=r=>{refs.set(r.path,r);return r;};test.after(async()=>{for(const ref of refs.values())await db.recursiveDelete(ref);});
const scope={workspaceId:WORKSPACE_ID,kioskId:'receipt-followup-unit',mappingId:'receipt-followup-mapping',stoneCode:'123'};
const key=createHash('sha256').update(`${WORKSPACE_ID}:123`).digest('hex');
async function store(day,captures=[],payments=[]){const{xml}=receiptFile(day,captures,payments);const r=own(db.collection('stonePortfolioFiles').doc(`${key}_${day}`));await r.set({workspaceId:WORKSPACE_ID,stoneCode:'123',referenceDate:day,sourceHash:createHash('sha256').update(xml).digest('hex'),xml});return r;}
const deps={now:new Date('2026-11-18T12:00:00Z'),readStone:async()=>{throw Error('PROVIDER_MUST_NOT_BE_CALLED');},readMapping:async()=>({...scope,id:scope.mappingId,accountId:'receipt-account',stoneCodes:['123'],terminalIds:[],validFrom:'2020-01-01',validTo:null,status:'active'}),readPortfolio:async()=>null,readPix:async()=>({status:'not_configured',coverage:null,facts:[],excludedCount:0,fileId:null}),readPdvCalendar:async()=>[]};
const request={view:'saved',kioskId:scope.kioskId,stoneCode:'123',month:'2026-10'};
test('on-demand cache/API service:11itens, pagamentosNov não importam nem escrevem snapshot, paginação atéasOf',async()=>{
 for(let n=1;n<=31;n++){const day=`2026-10-${String(n).padStart(2,'0')}`;await store(day,octoberReceiptCases.filter(r=>r.soldOn===day),octoberReceiptCases.filter(r=>r.id.startsWith('paid')&&r.due===day));}
 for(let n=1;n<=17;n++){const day=`2026-11-${String(n).padStart(2,'0')}`;await store(day,[],octoberReceiptCases.slice(0,7).filter(r=>r.due===day));}
 const first=await queryStoneReceiptReconciliation(request,{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},deps);assert.equal(first.status,'ready');assert.equal(first.result.parcels.length,11);assert.equal(first.result.coverage.payments.fileCount,16);assert.equal(first.result.coverage.payments.nextCursor,'2026-11-17');
 const c=first.result.coverage.payments;const second=await queryStoneReceiptReconciliation({...request,paymentCursor:c.nextCursor,paymentAsOf:c.asOf,paymentCohort:c.cohortFingerprint},{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},deps);
 const merged=mergeReceiptPaymentPage(first.result,second.result);assert.equal(merged.coverage.payments.complete,true);assert.equal(merged.parcels.filter(p=>p.paidDate?.startsWith('2026-11')).length,7);assert.equal(merged.parcels.filter(p=>p.paidDate?.startsWith('2026-11')).reduce((v,p)=>v+(p.paidNetCents??0),0),8409);assert.equal(merged.parcels.filter(p=>p.status==='to_receive').length,2);
 const snap=createHash('sha256').update(`${WORKSPACE_ID}:123:2026-10`).digest('hex');assert.equal((await db.collection('stoneReceiptMonthSnapshots').doc(snap).get()).exists,false);
 await assert.rejects(queryStoneReceiptReconciliation(request,{isDefaultAdmin:false,workspace_id:WORKSPACE_ID},deps),e=>e.code==='STONE_RECEIPT_FORBIDDEN');
 await assert.rejects(queryStoneReceiptReconciliation({...request,paymentCursor:'2026-11-17',paymentAsOf:c.asOf,paymentCohort:'f'.repeat(64)},{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},deps),e=>e.code==='STONE_RECEIPT_PAYMENT_CONTEXT');
});
test('cache gap never calls producer; scope/hash invalid fail closed; sparse query is bounded',async()=>{
 assert.equal(await readPersistedReceiptDay({workspaceId:WORKSPACE_ID,stoneCode:'123'},'2020-01-01'),null);
 const page=await readPersistedPaymentPage({workspaceId:WORKSPACE_ID,stoneCode:'123'},'2026-11-01','2026-11-17');assert.equal(page.length,16);
 await assert.rejects(readPersistedPaymentPage({workspaceId:'other',stoneCode:'123'},'2026-11-01','2026-11-17'));
 const bad=await store('2026-11-18');await bad.update({workspaceId:'other'});await assert.rejects(readPersistedReceiptDay({workspaceId:WORKSPACE_ID,stoneCode:'123'},'2026-11-18'),e=>e.code==='STONE_RECEIPT_CACHE_INVALID');await bad.delete();
 const missing=db.collection('stonePortfolioFiles').doc(`${key}_2026-11-03`);await missing.delete();
 const first=await queryStoneReceiptReconciliation(request,{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},deps);assert.equal(first.result.coverage.payments.complete,false);assert.ok(first.result.coverage.payments.missingDates.includes('2026-11-03'));assert.equal(first.result.parcels.find(p=>p.id==='sale1:1').status,'review');
});
test('detalhe via lista preserva data/valor real tardio; acesso direto sem prova permaneceConferir',async()=>{
 const row={id:'delayed-detail',soldOn:'2026-01-01',net:1000,due:'2026-02-01'};await store('2026-01-01',[row]);await store('2026-02-01');await store('2026-10-15',[],[row]);
 const local={...deps,readPdvSnapshot:async()=>null};const query={view:'sale',kioskId:scope.kioskId,stoneCode:'123',saleDate:'2026-01-01',saleId:row.id,source:'card'};
 const direct=await queryStoneReceiptReconciliation(query,{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},local);assert.equal(direct.audit.installments[0].status,'review');
 const fromList=await queryStoneReceiptReconciliation({...query,paymentDateHint:'2026-10-15'},{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},local);assert.equal(fromList.audit.installments[0].paidDate,'2026-10-15');assert.equal(fromList.audit.installments[0].netCents,1000);assert.equal(fromList.audit.installments[0].status,'paid_late');
 await assert.rejects(queryStoneReceiptReconciliation({...query,paymentDateHint:'2027-01-01'},{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},local),e=>e.code==='STONE_RECEIPT_PAYMENT_HINT');
});
test('sem pagamento só fica conclusivo ao cobrir todaspáginas; cursor/competência/asOf não misturam',async()=>{
 const noPay={id:'genuine-no-payment',soldOn:'2026-10-03',net:900,due:'2026-11-03'};await store('2026-10-03',[...octoberReceiptCases.filter(r=>r.soldOn==='2026-10-03'),noPay]);await store('2026-11-03',[],octoberReceiptCases.filter(r=>r.due==='2026-11-03'));
 const a=await queryStoneReceiptReconciliation(request,{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},deps);assert.equal(a.result.parcels.find(p=>p.id===`${noPay.id}:1`).status,'review');const c=a.result.coverage.payments;
 const b=await queryStoneReceiptReconciliation({...request,paymentCursor:c.nextCursor,paymentAsOf:c.asOf,paymentCohort:c.cohortFingerprint},{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},deps);
 assert.equal(mergeReceiptPaymentPage(a.result,b.result).parcels.find(p=>p.id===`${noPay.id}:1`).status,'unpaid');
 assert.throws(()=>mergeReceiptPaymentPage(a.result,{...b.result,scope:{...b.result.scope,mappingId:'different-contract'}}));
 assert.throws(()=>mergeReceiptPaymentPage(a.result,{...b.result,coverage:{...b.result.coverage,payments:{...b.result.coverage.payments,scannedFrom:receiptNextDay(c.nextCursor)}}}));
 await assert.rejects(queryStoneReceiptReconciliation({...request,paymentCursor:c.nextCursor,paymentAsOf:'2027-01-01',paymentCohort:c.cohortFingerprint},{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},deps));
});
test('view month é cache-only; snapshot antigo atualiza corte e asOf anterior reconstrói sem futuro',async()=>{
 const ctx={isDefaultAdmin:true,workspace_id:WORKSPACE_ID};const guarded={...deps,readFile:async()=>{throw Error('producer/readDay prohibited')}};
 const month=await queryStoneReceiptReconciliation({view:'month',kioskId:scope.kioskId,stoneCode:'123',from:'2026-10-01',through:'2026-10-31'},ctx,guarded);
 assert.ok(month.parcels.some(p=>p.paidDate==='2026-11-09'));
 const{saveStoneReceiptSnapshot}=await import('../../src/features/financial/receipts-reconciliation/stone-account-snapshot.server.ts');
 const identity={workspaceId:WORKSPACE_ID,mappingId:scope.mappingId,kioskId:scope.kioskId,stoneCode:'123',month:'2026-10'};
 await saveStoneReceiptSnapshot(identity,{...month,latestPublished:'2026-11-07'});
 const saved=await queryStoneReceiptReconciliation(request,ctx,guarded);assert.equal(saved.result.latestPublished,'2026-11-17');assert.ok(saved.result.parcels.some(p=>p.paidDate==='2026-11-09'));
 const earlier=await queryStoneReceiptReconciliation({...request,paymentAsOf:'2026-11-01'},ctx,guarded);assert.equal(earlier.result.latestPublished,'2026-11-01');assert.equal(earlier.result.parcels.some(p=>p.paidDate>'2026-11-01'),false);
});
test('conflito entre páginas permanece no detalhe e após página sem prova; captura anterior também recebe overlay',async()=>{
 const ctx={isDefaultAdmin:true,workspace_id:WORKSPACE_ID};
 const row={id:'conflicting-sale',soldOn:'2026-08-20',net:1000,due:'2026-09-03'};await store(row.soldOn,[row]);await store('2026-09-03');
 await store('2026-11-04',[],[row]);await store('2026-11-09',[],[row]);
 const local={...deps,readPdvSnapshot:async()=>null};
 const detail=await queryStoneReceiptReconciliation({view:'sale',kioskId:scope.kioskId,stoneCode:'123',saleDate:row.soldOn,saleId:row.id,source:'card',paymentDateHint:'2026-11-04',paymentConflictHint:true,paymentEvidenceDateHints:['2026-11-04','2026-11-09']},ctx,local);assert.equal(detail.audit.installments[0].status,'review');assert.equal(detail.audit.installments[0].paymentEventCount,2);
 const{appendPersistedPayments}=await import('../../src/features/financial/receipts-reconciliation/payment-followup.server.ts');
 const{buildStoneAccountParcels}=await import('../../src/features/financial/receipts-reconciliation/stone-account.ts');
 const parcels=buildStoneAccountParcels({from:'2026-08-01',through:'2026-08-31',latestPublished:'2026-11-17',files:[receiptFile(row.soldOn,[row]).file],missingDates:[],portfolio:null,pix:[]}).parcels;
 const base={scope:{workspaceId:WORKSPACE_ID,mappingId:scope.mappingId,kioskId:scope.kioskId,stoneCode:'123'},period:{from:'2026-10-01',through:'2026-10-31'},parcels,coverage:{stone:'complete'},limitations:[],latestPublished:'2026-11-07'};
 const a=await appendPersistedPayments(base,{},'2026-11-17');assert.equal(a.parcels[0].paymentConflict,true);assert.equal(a.latestPublished,'2026-11-17');
 const c=a.coverage.payments;const b=await appendPersistedPayments(base,{paymentCursor:c.nextCursor,paymentAsOf:c.asOf,paymentCohort:c.cohortFingerprint},'2026-11-17');
 const merged=mergeReceiptPaymentPage(a,b);assert.equal(merged.parcels[0].status,'review');assert.equal(merged.parcels[0].paymentConflict,true);
});
async function storeEvent(day,row,{cancel=false,pay=true,gross}={}){
 const data=receiptFile(day,[],[{...row,...(gross!==undefined?{gross}:{})}]);const xml=data.xml.replace('<Cancellations>0</Cancellations>',`<Cancellations>${cancel?1:0}</Cancellations>`).replace('<Payments>1</Payments>',`<Payments>${pay?1:0}</Payments>`);const ref=own(db.collection('stonePortfolioFiles').doc(`${key}_${day}`));await ref.set({workspaceId:WORKSPACE_ID,stoneCode:'123',referenceDate:day,xml,sourceHash:createHash('sha256').update(xml).digest('hex')});
}
test('pagamento página1 + cancelamento página2 preserva marcador/datas e detalhe lê ambas',async()=>{
 const row={id:'cancel-page2',soldOn:'2026-10-01',net:1000,due:'2026-11-04'};await store(row.soldOn,[row]);await store('2026-11-04',[],[row]);await storeEvent('2026-11-17',row,{cancel:true,pay:false});
 const{appendPersistedPayments}=await import('../../src/features/financial/receipts-reconciliation/payment-followup.server.ts');const{buildStoneAccountParcels}=await import('../../src/features/financial/receipts-reconciliation/stone-account.ts');
 const parcels=buildStoneAccountParcels({from:'2026-10-01',through:'2026-10-31',latestPublished:'2026-11-17',files:[receiptFile(row.soldOn,[row]).file],missingDates:[],portfolio:null,pix:[]}).parcels;
 const base={scope:{workspaceId:WORKSPACE_ID,mappingId:scope.mappingId,kioskId:scope.kioskId,stoneCode:'123'},period:{from:'2026-10-01',through:'2026-10-31'},parcels,coverage:{stone:'complete'},limitations:[],latestPublished:'2026-11-17'};
 const a=await appendPersistedPayments(base,{},'2026-11-17');assert.equal(a.parcels[0].paidDate,'2026-11-04');const c=a.coverage.payments;const b=await appendPersistedPayments(base,{paymentCursor:c.nextCursor,paymentAsOf:c.asOf,paymentCohort:c.cohortFingerprint},'2026-11-17');
 const merged=mergeReceiptPaymentPage(a,b).parcels[0];assert.equal(merged.status,'review');assert.equal(merged.paymentConflict,true);assert.deepEqual(merged.paymentEvidenceDates,['2026-11-04','2026-11-17']);
 const detail=await queryStoneReceiptReconciliation({view:'sale',kioskId:scope.kioskId,stoneCode:'123',saleDate:row.soldOn,saleId:row.id,source:'card',paymentDateHint:merged.paidDate,paymentEvidenceDateHints:merged.paymentEvidenceDates,paymentConflictHint:merged.paymentConflict},{isDefaultAdmin:true,workspace_id:WORKSPACE_ID},{...deps,readPdvSnapshot:async()=>null});assert.equal(detail.audit.installments[0].status,'review');
});
test('detalhe direto recusa pago+cancelamento e bruto diferente da captura, sem hint',async()=>{
 const row={id:'direct-invalid',soldOn:'2026-09-01',net:1000,due:'2026-11-04'};await store(row.soldOn,[row]);const input={view:'sale',kioskId:scope.kioskId,stoneCode:'123',saleDate:row.soldOn,saleId:row.id,source:'card'};const ctx={isDefaultAdmin:true,workspace_id:WORKSPACE_ID};const local={...deps,readPdvSnapshot:async()=>null};
 await storeEvent(row.due,row,{cancel:true});const cancelled=await queryStoneReceiptReconciliation(input,ctx,local);assert.equal(cancelled.audit.installments[0].status,'review');
 await storeEvent(row.due,row,{gross:2000});const mismatch=await queryStoneReceiptReconciliation(input,ctx,local);assert.equal(mismatch.audit.installments[0].status,'review');
});
