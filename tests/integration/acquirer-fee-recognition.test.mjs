import assert from "node:assert/strict";
import test from "node:test";
import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";
import { enableServerOnlyTestImports } from "../helpers/server-only-runtime.mjs";
enableServerOnlyTestImports("demo-coala-repository");
assertFirestoreEmulatorSafety({ projectId: "demo-coala-repository", databaseId: "coala-financeiro" });
const { financialDbAdmin: db } = await import("../../src/lib/firebase-financial-admin.ts");
const { dbAdmin, authAdmin } = await import("../../src/lib/firebase-admin.ts");
const { NextRequest } = await import("next/server");
const feeRoute = await import("../../src/app/api/financial/acquirer-fees/route.ts");
const { WORKSPACE_ID } = await import("../../src/lib/workspace.ts");
const { queryDailySales } = await import("../../src/features/financial/sales-reconciliation/query.ts");
const { saveDailySalesReview, readDailySalesReviewSnapshot } = await import("../../src/features/financial/sales-reconciliation/review-state.server.ts");
const { dailySalesReviewId } = await import("../../src/features/financial/sales-reconciliation/review-state.ts");
const { previewSaleFees, executeSaleFeeAction } = await import("../../src/features/financial/acquirer-fees/recognition.server.ts");
const { saveRecognitionPolicy } = await import("../../src/features/financial/acquirer-fees/policy.server.ts");
const { executeFeeAction } = await import("../../src/features/financial/acquirer-fees/repository.server.ts");
const { launchFeeMonthExpense } = await import("../../src/features/financial/receipts-reconciliation/fee-month-expense.server.ts");
const { registerReportedPayment, queueMatchedBankPayment } = await import("../../src/features/financial/obligations/service.server.ts");
const { expenseCashForecastAmount } = await import("../../src/features/financial/lib/expense-display-state.ts");
const { createPaymentRequest, authorizePaymentRequest, submitPaymentRequest } = await import("../../src/features/financial/payment-requests/service.server.ts");
const { assertExpenseBoletoTarget } = await import("../../src/features/financial/payment-requests/expense-boleto.ts");
const { sourceExpenseGuard } = await import("../../src/features/financial/cash-closures/withdrawal-classification.ts");
const { Timestamp } = await import("firebase-admin/firestore");
const refs = new Map(); const own = ref => { refs.set(ref.path, ref); return ref; };
const actor = { isDefaultAdmin: true, workspace_id: WORKSPACE_ID, decoded: { uid: "fee-recognition-test" } };
const code = expected => e => e.code === expected;
test.after(async () => { for (const ref of refs.values()) await db.recursiveDelete(ref); });
// Build each file explicitly so the original gross and provider IDs are shared; no bank deposit is fabricated.
function file(code, date, { paid = false, fee = "3", net = "97.00", advance = null, accountType = "2", cancelled = false } = {}) {
 const row = `<Transaction><AcquirerTransactionKey>sale100</AcquirerTransactionKey><CaptureLocalDateTime>20261001120000</CaptureLocalDateTime><AccountType>${accountType}</AccountType><FeeType>1</FeeType><CapturedAmount>100.00</CapturedAmount><AuthorizationCurrencyCode>986</AuthorizationCurrencyCode><Events><Captures>${paid ? 0 : 1}</Captures><Payments>${paid ? 1 : 0}</Payments><Cancellations>${cancelled ? 1 : 0}</Cancellations><CancellationCharges>0</CancellationCharges><Chargebacks>0</Chargebacks><ChargebackRefunds>0</ChargebackRefunds></Events><Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>100.00</GrossAmount><NetAmount>${net}</NetAmount>${fee === null ? "" : `<MdrAmount>${fee}</MdrAmount>`}${paid ? `<PaymentId>receipt100</PaymentId><PaymentDate>${date.replaceAll("-", "")}</PaymentDate>${advance === null ? "" : `<AdvanceRateAmount>${advance}</AdvanceRateAmount><AdvancedReceivableOriginalPaymentDate>20261031</AdvancedReceivableOriginalPaymentDate>`}` : "<PrevisionPaymentDate>20261031</PrevisionPaymentDate>"}</Installment></Installments></Transaction>`;
 return `<Conciliation><Header><StoneCode>${code}</StoneCode><ReferenceDate>${date.replaceAll("-", "")}</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>${date}</FileId><GenerationDateTime>20261102060000</GenerationDateTime></Header><FinancialTransactions>${paid ? "" : row}</FinancialTransactions><FinancialTransactionsAccounts>${paid ? row : ""}</FinancialTransactionsAccounts></Conciliation>`;
}
async function fixture(name, options = {}) {
 const id = `recognition-${name}`, unit = `${id}-unit`, merchant = String(7000 + refs.size);
 const request = { mappingId: id, kioskId: unit, stoneCode: merchant, referenceDate: "2026-10-01", source: "cards" };
 const mapping = { id, workspaceId: WORKSPACE_ID, kioskId: unit, accountId: `${id}-bank`, stoneCodes: [merchant], terminalIds: [], status: "active", validFrom: "2026-01-01", validTo: null };
 const policy = { version: 1, enabled: true, variableAccountId: `${id}-var`, financialAccountId: `${id}-fin`, closedThroughMonth: null, closedPeriods: [], contracts: [] };
 const mappingRef = own(db.collection("stoneMerchantMappings").doc(id)); await mappingRef.set({ ...mapping, feeRecognitionPolicy: policy });
 await own(db.collection("bankAccounts").doc(mapping.accountId)).set({ workspaceId: WORKSPACE_ID });
 await own(dbAdmin.collection("kiosks").doc(unit)).set({workspaceId:WORKSPACE_ID,name:unit});
 for (const [aid, position] of [[policy.variableAccountId, "custos_variaveis"], [policy.financialAccountId, "despesas_financeiras"]]) await own(db.collection("accounts").doc(aid)).set({ workspaceId: WORKSPACE_ID, active: true, name: aid, dre_position: position, is_dre_account: true, isGroup: false });
 const center = `${id}-center`; await own(db.collection("resultCenters").doc(center)).set({ workspaceId: WORKSPACE_ID, name: center, unitIds: [unit], active: true });
 let capture = file(merchant, request.referenceDate, options), payment = file(merchant, "2026-10-31", { paid: true });
 const salesRequest={mappingId:request.mappingId,kioskId:request.kioskId,stoneCode:request.stoneCode,referenceDate:request.referenceDate};
 const result = await queryDailySales(salesRequest, actor, { resolveBinding: async () => ({ mapping, pdvFilialId: "456" }), readPdv: async () => [{ codcupom: "100", dtrecebimento: "2026-10-01 12:00:00", valortotal: "100.00", formaPgtos: [{ nome: "CARTAO CREDITO STONE", valortotal: "100.00" }] }], readStone: async () => capture, now: () => new Date("2026-11-17T12:00:00Z") });
 const reviewId = dailySalesReviewId(result); own(db.collection("dailySalesReviews").doc(reviewId)); own(db.collection("dailySalesReviewSnapshots").doc(reviewId));
 await saveDailySalesReview(result, actor.decoded.uid, new Date("2026-11-17T12:00:00Z"));
 const deps = { now: () => new Date("2026-11-17T12:00:00Z"), readMapping: async () => mapping, readStone: async q => q.referenceDate === request.referenceDate ? capture : payment, readReview: readDailySalesReviewSnapshot, readPix: async () => ({ status: "not_configured", coverage: null, facts: [], excludedCount: 0, fileId: null }) };
 const call = async input => { const output = await executeSaleFeeAction({ request, ...input }, actor, deps); for (const record of [output.record, ...(output.updated ?? [])].filter(Boolean)) { own(db.collection("financialAcquirerFeeBatches").doc(record.id)); if (record.expenseId) own(db.collection("expenses").doc(record.expenseId)); for (const m of record.batch.members) own(db.collection("financialSourceSettlements").doc(m.id)); } return output; };
 const preview = await previewSaleFees(request, actor, deps); const batch = preview.batches[0];
 const recognize = batch ? { action: "recognize_sale", batchId: batch.id, fingerprint: batch.fingerprint, resultCenterId: center, expectedRevision: 0, confirmedNoManualExpense: true } : null;
 return { request, deps, policy, mappingRef, center, reviewId, preview, batch, call, recognize, setPayment: value => payment = value, setCapture: value => capture = value, merchant };
}
test("venda100/taxa3/97 antes D+30: transação concorrente única, não paga nem pagável; liquidação idempotente sem nova despesa", async () => {
 const f = await fixture("journey"); assert.ok(f.batch, JSON.stringify(f.preview));
 const [a,b] = await Promise.all([f.call(f.recognize), f.call(f.recognize)]); assert.equal(a.record.id,b.record.id); assert.equal([a,b].filter(x => x.idempotent).length,1);
 const expenseRef = db.collection("expenses").doc(a.record.expenseId); const expense = (await expenseRef.get()).data();
 assert.equal(expense.status,"provisioned"); assert.equal(expense.totalValue,3); assert.equal(expense.paidAt,null); assert.equal(expense.competenceMonth,"2026-10"); assert.equal(expense.sourceSettlement.phase,"receivable"); assert.equal(expenseCashForecastAmount(expense),0);
 await assert.rejects(registerReportedPayment(expenseRef.id,{ idempotencyKey:"no-bank-payment" },{ uid:actor.decoded.uid }),code("EXPENSE_SETTLED_AT_SOURCE"));
 await assert.rejects(queueMatchedBankPayment({ batch:db.batch(), expenseId:expenseRef.id, expense, bankTransactionId:"none", principalAmount:3,cashAmount:3,paidAt:Timestamp.now(),actor:{ uid:actor.decoded.uid } }),code("EXPENSE_SETTLED_AT_SOURCE"));
 await assert.rejects(createPaymentRequest({sourceType:"purchase_order",sourceId:"no-bank",expenseId:expenseRef.id,beneficiaryReference:{sourceType:"supplier",sourceId:"none"},amount:3,description:"forged payable"},{uid:actor.decoded.uid}),code("EXPENSE_SETTLED_AT_SOURCE"));
 assert.throws(()=>assertExpenseBoletoTarget({...expense,workspaceId:WORKSPACE_ID},{},WORKSPACE_ID),code("EXPENSE_SETTLED_AT_SOURCE"));
 const requestRef=own(db.collection("bankPaymentRequests").doc("recognition-forged-request"));
 await requestRef.set({sourceType:"purchase_order",sourceId:"none",expenseId:expenseRef.id,status:"awaiting_financial_authorization",paymentRail:"pix"});
 await assert.rejects(authorizePaymentRequest(requestRef.id,{uid:actor.decoded.uid}),code("EXPENSE_SETTLED_AT_SOURCE"));
 await requestRef.update({status:"ready_to_submit"});
 await assert.rejects(submitPaymentRequest(requestRef.id,{uid:actor.decoded.uid}),code("EXPENSE_SETTLED_AT_SOURCE"));
 await requestRef.delete();
 const settled = await f.call({ action:"settle_sales",paymentDate:"2026-10-31" }); assert.equal(settled.updated[0].state,"received");
 const again = await f.call({ action:"settle_sales",paymentDate:"2026-10-31" }); assert.equal(again.updated[0].revision,settled.updated[0].revision);
 const paid = (await expenseRef.get()).data(); assert.equal(paid.totalValue,3); assert.equal(paid.status,"paid"); assert.equal(paid.settlementSummary.confirmedCashAmountCents,0);
 for (const name of ["payments","paymentSplits","transactions","financialObligations","bankPaymentRequests"]) assert.equal((await db.collection(name).where("expenseId","==",expenseRef.id).limit(1).get()).empty,true);
});
test("taxa zero comprovada conserva origem sem despesa; taxa desconhecida e total sem conciliação não elegíveis", async () => {
 const zero = await fixture("zero",{ fee:"0",net:"100.00" }); assert.equal(zero.batch.amountCents,0); const made = await zero.call(zero.recognize); assert.equal(made.record.expenseId,null);
 const unknown = await fixture("unknown",{ fee:null,net:"97.00" }); assert.equal(unknown.preview.batches.length,0); assert.ok(unknown.preview.pending.some(p=>p.includes("desconhecida")));
 const ambiguous = await fixture("ambiguous"); await db.collection("dailySalesReviews").doc(ambiguous.reviewId).update({status:"attention_required"}); const p = await previewSaleFees(ambiguous.request,actor,ambiguous.deps); assert.equal(p.batches.length,0);
});
test("vínculo/conta/política/período/revisão fecham acesso efetivo e legado não cria bypass",async()=>{
 const f = await fixture("scope");
 await assert.rejects(executeSaleFeeAction({request:f.request,...f.recognize},{...actor,isDefaultAdmin:false},f.deps),code("ACQUIRER_FEE_FORBIDDEN"));
 await assert.rejects(executeSaleFeeAction({request:{...f.request,kioskId:"other-unit"},action:"preview_sales"},actor,f.deps));
 await assert.rejects(saveRecognitionPolicy({request:f.request,policy:{...f.policy,version:2,variableAccountId:f.policy.financialAccountId},expectedVersion:1,reason:"test"},actor),code("FEE_POLICY_ACCOUNT"));
 await f.mappingRef.update({"feeRecognitionPolicy.closedPeriods":["2026-10"]}); await assert.rejects(f.call(f.recognize),code("FEE_RECOGNITION_CLOSED_PERIOD"));
 await f.mappingRef.update({"feeRecognitionPolicy.closedPeriods":[]}); await db.collection("dailySalesReviews").doc(f.reviewId).update({revision:2}); await assert.rejects(f.call(f.recognize),code("FEE_RECOGNITION_STALE_PREVIEW"));
 await assert.rejects(launchFeeMonthExpense({workspaceId:WORKSPACE_ID,mappingId:f.request.mappingId,kioskId:f.request.kioskId,stoneCode:f.request.stoneCode},{month:"2026-10",fingerprint:"a".repeat(64),resultCenterId:f.center},{uid:"test"}),code("STONE_FEE_EXPENSE_RECOGNITION_REQUIRED"));
 await assert.rejects(executeFeeAction({action:"create",request:f.request,batchId:f.batch.id,fingerprint:f.batch.fingerprint,accountPlanId:f.policy.variableAccountId,resultCenterId:f.center,confirmedNoManualExpense:true},actor,f.deps),code("ACQUIRER_FEE_RECOGNITION_REQUIRED"));
});
test("antecipação explícita é financeira, não MDR residual; ajuste e estorno preservam revisão",async()=>{
 const f = await fixture("advance"); const made = await f.call(f.recognize);
 f.setPayment(file(f.merchant,"2026-10-20",{paid:true,fee:"3",net:"95.00",advance:"2"}));
 const settled = await f.call({action:"settle_sales",paymentDate:"2026-10-20"}); assert.equal(settled.updated.length,2);
 const financial = settled.updated.find(r=>r.batch.kind==="anticipation"); assert.equal(financial.batch.amountCents,200); assert.equal(financial.accountPlanId,f.policy.financialAccountId);
 const retry = await f.call({action:"settle_sales",paymentDate:"2026-10-20"}); assert.equal(retry.updated.find(r=>r.batch.kind==="anticipation").revision,financial.revision);
 await assert.rejects(f.call({action:"reverse_sale",batchId:made.record.id,expectedRevision:made.record.revision,reason:"estorno"}),code("FEE_RECOGNITION_REVISION"));
 const reversed = await f.call({action:"reverse_sale",batchId:financial.id,expectedRevision:financial.revision,reason:"estorno comprovado"}); assert.equal(reversed.record.active,false);
});

test("vínculo manual conserva despesa/origem e reversão restaura estado anterior sem apagar lançamento",async()=>{
 const f=await fixture("manual"); const manualRef=own(db.collection("expenses").doc("recognition-manual-existing"));
 const original={workspaceId:WORKSPACE_ID,accountId:f.policy.variableAccountId,accountPlan:f.policy.variableAccountId,resultCenterId:f.center,competenceMonth:"2026-10",totalValue:3,status:"pending",paymentMethod:"single",description:"Taxa cadastrada manualmente",notes:"preservar"};
 await manualRef.set(original);
 await assert.rejects(f.call(f.recognize),code("FEE_RECOGNITION_MANUAL_CANDIDATE"));
 const candidates=await f.call({action:"candidates_sale",batchId:f.batch.id,fingerprint:f.batch.fingerprint,resultCenterId:f.center}); assert.equal(candidates.candidates[0].id,manualRef.id);
 const linked=await f.call({...f.recognize,action:"link_sale",expenseId:manualRef.id,expenseFingerprint:sourceExpenseGuard(original)}); assert.equal(linked.record.expenseId,manualRef.id); assert.equal((await manualRef.get()).get("notes"),"preservar");
 await f.call({action:"reverse_sale",batchId:linked.record.id,expectedRevision:linked.record.revision,reason:"revisão comprovada"});
 const restored=(await manualRef.get()).data(); assert.equal(restored.status,"pending"); assert.equal(restored.sourceSettlement,undefined); assert.equal(restored.notes,"preservar"); assert.equal(restored.description,original.description);
});

test("estimativa contratual vigente vira apuração por delta na mesma despesa após fonte de pagamento",async()=>{
 const f=await fixture("estimate",{fee:null,net:"97.00"});
 const contract={id:"approved-card",version:1,approvedAt:"2026-01-01T00:00:00Z",validFrom:"2026-01-01",validThrough:null,source:"cards",brandCode:null,accountTypeCode:"2",minInstallments:1,maxInstallments:1,rateBasisPoints:300,fixedCents:0,rounding:"round"};
 await f.mappingRef.update({"feeRecognitionPolicy.contracts":[contract]});
 const p=await previewSaleFees(f.request,actor,f.deps); assert.equal(p.batches[0].measurement,"estimated");
 const made=await f.call({action:"recognize_sale",batchId:p.batches[0].id,fingerprint:p.batches[0].fingerprint,resultCenterId:f.center,expectedRevision:0,confirmedNoManualExpense:true});
 f.setPayment(file(f.merchant,"2026-10-31",{paid:true,fee:"2.50",net:"97.50"}));
 await assert.rejects(f.call({action:"settle_sales",paymentDate:"2026-10-31"}),code("FEE_RECOGNITION_DELTA_REASON"));
 const adjusted=await f.call({action:"settle_sales",paymentDate:"2026-10-31",reason:"taxa comprovada na liquidação"}); assert.equal(adjusted.updated[0].expenseId,made.record.expenseId); assert.equal(adjusted.updated[0].batch.amountCents,250); assert.equal(adjusted.updated[0].batch.measurement,"assessed"); assert.equal((await db.collection("expenses").doc(made.record.expenseId).get()).get("sourceSettlement.estimated"),false);
});

test("zero comprovado depois corrigido por fonte cria apenas uma despesa positiva com motivo",async()=>{
 const f=await fixture("zero-revised",{fee:"0",net:"100.00"}); const made=await f.call(f.recognize); assert.equal(made.record.expenseId,null);
 f.setPayment(file(f.merchant,"2026-10-31",{paid:true,fee:"3",net:"97.00"}));
 const result=await f.call({action:"settle_sales",paymentDate:"2026-10-31",reason:"nova fonte comprovou tarifa"}); assert.equal(result.updated[0].batch.amountCents,300); assert.ok(result.updated[0].expenseId);
 const retry=await f.call({action:"settle_sales",paymentDate:"2026-10-31"}); assert.equal(retry.updated[0].expenseId,result.updated[0].expenseId); assert.equal(retry.updated[0].revision,result.updated[0].revision);
});

test("R1: vendas distintas com taxa3 no mesmo centro/competência não se bloqueiam",async()=>{
 const f=await fixture("same-value");
 const original=file(f.merchant,f.request.referenceDate); const row=original.match(/<Transaction>.*<\/Transaction>/)[0];
 const extra=row.replaceAll("sale100","sale200").replaceAll("20261001120000","20261001130000").replaceAll("20261031","20261101");
 const capture=original.replace("</FinancialTransactions>",`${extra}</FinancialTransactions>`); f.setCapture(capture);
 const mapping=(await f.mappingRef.get()).data();
 const {source:ignored,...request}=f.request;void ignored;
 const result=await queryDailySales(request,actor,{resolveBinding:async()=>({mapping,pdvFilialId:"456"}),readPdv:async()=>[12,13].map((h,i)=>({codcupom:String(i+1),dtrecebimento:`2026-10-01 ${h}:00:00`,valortotal:"100.00",formaPgtos:[{nome:"CARTAO CREDITO STONE",valortotal:"100.00"}]})),readStone:async()=>capture,now:()=>new Date("2026-11-17T13:00:00Z")});
 await saveDailySalesReview(result,actor.decoded.uid,new Date("2026-11-17T13:00:00Z"));
 const p=await previewSaleFees(f.request,actor,f.deps);assert.equal(p.batches.length,2);
 const made=[];for(const batch of p.batches)made.push(await f.call({action:"recognize_sale",batchId:batch.id,fingerprint:batch.fingerprint,resultCenterId:f.center,expectedRevision:0,confirmedNoManualExpense:true}));
 assert.notEqual(made[0].record.expenseId,made[1].record.expenseId);assert.deepEqual(made.map(r=>r.record.batch.amountCents),[300,300]);
});
test("R2: antecipação2→zero corrige despesa financeira/claims sem novo custo e retry não altera revisão",async()=>{
 const f=await fixture("advance-zero");await f.call(f.recognize);
 f.setPayment(file(f.merchant,"2026-10-20",{paid:true,fee:"3",net:"95.00",advance:"2"}));const first=await f.call({action:"settle_sales",paymentDate:"2026-10-20"}); const financial=first.updated.find(r=>r.batch.kind==="anticipation");
 f.setPayment(file(f.merchant,"2026-10-20",{paid:true,fee:"3",net:"97.00",advance:"0"}));
 const correction=await f.call({action:"settle_sales",paymentDate:"2026-10-20",reason:"fonte corrigida sem antecipação"});const zero=correction.updated.find(r=>r.id===financial.id);
 assert.equal(zero.batch.amountCents,0);assert.equal(zero.active,false);assert.equal((await db.collection("expenses").doc(financial.expenseId).get()).get("status"),"cancelled");
 for(const m of zero.batch.members)assert.equal((await db.collection("financialSourceSettlements").doc(m.id).get()).get("active"),false);
 const retry=await f.call({action:"settle_sales",paymentDate:"2026-10-20"});assert.equal(retry.updated.find(r=>r.id===zero.id).revision,zero.revision);
});
test("R3: venda outubro não permite estornar antecipação de novembro fechado",async()=>{
 const f=await fixture("real-period");f.setCapture(file(f.merchant,f.request.referenceDate).replaceAll("20261031","20261130"));const p=await previewSaleFees(f.request,actor,f.deps);await f.call({...f.recognize,batchId:p.batches[0].id,fingerprint:p.batches[0].fingerprint});
 f.setPayment(file(f.merchant,"2026-11-02",{paid:true,fee:"3",net:"95.00",advance:"2"}).replaceAll("<AdvancedReceivableOriginalPaymentDate>20261031","<AdvancedReceivableOriginalPaymentDate>20261130"));const paid=await f.call({action:"settle_sales",paymentDate:"2026-11-02"});const financial=paid.updated.find(r=>r.batch.kind==="anticipation");assert.ok(financial);
 await f.mappingRef.update({"feeRecognitionPolicy.closedPeriods":["2026-11"]});await assert.rejects(f.call({action:"reverse_sale",batchId:financial.id,expectedRevision:financial.revision,reason:"não permitir fechado"}),code("FEE_RECOGNITION_CLOSED_PERIOD"));
});
test("R4: estorno/retomada segura funciona para despesa criada e manual restaurada, sem ignorar edição externa",async()=>{
 for(const manual of [false,true]){
 const f=await fixture(`resume-${manual}`);let request=f.recognize;
 if(manual){const ref=own(db.collection("expenses").doc("recognition-resume-manual"));const data={workspaceId:WORKSPACE_ID,totalValue:3,accountId:f.policy.variableAccountId,resultCenterId:f.center,competenceMonth:"2026-10",status:"pending",paymentMethod:"single",notes:"preservar"};await ref.set(data);request={...request,action:"link_sale",expenseId:ref.id,expenseFingerprint:sourceExpenseGuard(data)};}
 const made=await f.call(request);const reversed=await f.call({action:"reverse_sale",batchId:made.record.id,expectedRevision:made.record.revision,reason:"revisão de origem"});
 const resumed=await f.call({...f.recognize,action:"revise_sale",expectedRevision:reversed.record.revision,reason:"retomar origem conferida"});assert.equal(resumed.record.expenseId,made.record.expenseId);assert.equal(resumed.record.active,true);
 const again=await f.call({action:"reverse_sale",batchId:resumed.record.id,expectedRevision:resumed.record.revision,reason:"segunda revisão"});await db.collection("expenses").doc(made.record.expenseId).update({totalValue:4});await assert.rejects(f.call({...f.recognize,action:"revise_sale",expectedRevision:again.record.revision,reason:"não sobrescrever externo"}),code("FEE_RECOGNITION_EXPENSE_CHANGED"));
 }
});
test("R6: conta/unidade/workspace inválidos e mappings concorrentes negam leitura e configuração",async()=>{
 const f=await fixture("mapping-scope");const mapping=(await f.mappingRef.get()).data();const bank=db.collection("bankAccounts").doc(mapping.accountId);
 await bank.update({workspaceId:"another"});await assert.rejects(previewSaleFees(f.request,actor,f.deps),code("FINANCIAL_AGENT_REFERENCES_INVALID"));await assert.rejects(saveRecognitionPolicy({request:f.request,policy:{...f.policy,version:2},expectedVersion:1,reason:"test"},actor),code("FINANCIAL_AGENT_REFERENCES_INVALID"));
 await bank.update({workspaceId:WORKSPACE_ID});const conflict=own(db.collection("stoneMerchantMappings").doc("recognition-conflicting-mapping"));await conflict.set({...mapping,id:conflict.id});await assert.rejects(f.call(f.recognize),code("FINANCIAL_AGENT_MAPPING_AMBIGUOUS"));await conflict.delete();
 await dbAdmin.collection("kiosks").doc(f.request.kioskId).delete();await assert.rejects(previewSaleFees(f.request,actor,f.deps),code("FINANCIAL_AGENT_REFERENCES_INVALID"));
});
test("R5: rota secureRoute mantém consulta/cancel legado, recusa create e versão1 não lança TypeError",async()=>{
 const f=await fixture("legacy-route"),uid="recognition-route-admin",email=`${uid}@example.test`,password="synthetic-fixture-password";
 await authAdmin.createUser({uid,email,password});await authAdmin.setCustomUserClaims(uid,{profileId:uid,sessionVersion:0});await own(dbAdmin.collection("profiles").doc(uid)).set({isDefaultAdmin:true,permissions:{}});await own(dbAdmin.collection("users").doc(uid)).set({username:"Ator sintético",email,profileId:uid,isActive:true,sessionVersion:0,profileCompliance:{status:"complete",policyVersion:1}});
 try{
 const signed=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});const token=(await signed.json()).idToken;assert.ok(token);
 const exp=own(db.collection("expenses").doc("recognition-legacy-route-expense"));const expense={workspaceId:WORKSPACE_ID,totalValue:3,status:"paid",competenceMonth:"2026-10",sourceSettlement:{kind:"acquirer_fee",sourceId:f.batch.id}};await exp.set(expense);
 const batch={id:f.batch.id,fingerprint:f.batch.fingerprint,kind:"mdr",amountCents:300,competenceDate:"2026-10-01",settledOn:"2026-10-31",members:f.batch.members};const rec=own(db.collection("financialAcquirerFeeBatches").doc(batch.id));await rec.set({schemaVersion:1,id:batch.id,workspaceId:WORKSPACE_ID,unitId:f.request.kioskId,stoneCode:f.request.stoneCode,referenceDate:f.request.referenceDate,source:"cards",batch,active:true,revision:1,expenseId:exp.id,createdExpense:true,expenseGuard:sourceExpenseGuard(expense),previousFields:{},previousMissing:[]});for(const m of batch.members)await own(db.collection("financialSourceSettlements").doc(m.id)).set({active:true,batchId:batch.id,revision:1});
 const call=(body,auth=token)=>feeRoute.POST(new NextRequest("http://localhost/api/financial/acquirer-fees",{method:"POST",headers:{...(auth?{Authorization:`Bearer ${auth}`}:{ }),"Content-Type":"application/json"},body:JSON.stringify(body)}));
 const hist=await feeRoute.GET(new NextRequest(`http://localhost/api/financial/acquirer-fees?${new URLSearchParams(f.request)}`,{headers:{Authorization:`Bearer ${token}`}}));assert.equal(hist.status,200);assert.equal((await hist.json()).records[0].id,batch.id);
 assert.equal((await call({action:"create",request:f.request,batchId:batch.id,fingerprint:batch.fingerprint,accountPlanId:f.policy.variableAccountId,resultCenterId:f.center,confirmedNoManualExpense:true})).status,400);
 await assert.rejects(f.call(f.recognize),code("FEE_RECOGNITION_LEGACY_REVIEW"));
 assert.equal((await call({action:"cancel",request:f.request,batchId:batch.id,reason:"resolver legado comprovado"},null)).status,401);
 const cancelled=await call({action:"cancel",request:f.request,batchId:batch.id,reason:"resolver legado comprovado"});assert.equal(cancelled.status,200);assert.equal((await cancelled.json()).record.active,false);
 }finally{await authAdmin.deleteUser(uid);}
});

async function sourcedEquivalentExpenses(f, count, amountCents) {
 const batch=db.batch();for(let i=0;i<count;i++){const ref=own(db.collection("expenses").doc(`00-${f.request.mappingId}-${String(i).padStart(3,"0")}`));batch.set(ref,{workspaceId:WORKSPACE_ID,competenceMonth:"2026-10",resultCenterId:f.center,totalValue:amountCents/100,status:"paid",sourceSettlement:{kind:"acquirer_fee",sourceId:`prior-source-${i}`}});}await batch.commit();
}
for(const path of ["recognize","zero-positive","anticipation"]){
 for(const manualAfterPages of [false,true]){
 test(`R1 pagination ${path}:26origens vinculadas ${manualAfterPages?"e manual legado posterior bloqueia":"não são candidatas manuais"}`,async()=>{
  const f=await fixture(`pages-${path}-${manualAfterPages}`,path==="zero-positive"?{fee:"0",net:"100.00"}:{});
  const cents=path==="anticipation"?200:300;await sourcedEquivalentExpenses(f,26,cents);
  let manualRef;if(manualAfterPages){manualRef=own(db.collection("expenses").doc(`zz-${f.request.mappingId}-manual`));await manualRef.set({competenceMonth:"2026-10",resultCenterId:f.center,totalValue:cents/100,status:"pending"});}
  const action=async()=>{
   if(path==="recognize")return f.call(f.recognize);
   await f.call(f.recognize);
   if(path==="zero-positive")return f.call({action:"settle_sales",paymentDate:"2026-10-31",reason:"fonte confirmou taxa positiva"});
   f.setPayment(file(f.merchant,"2026-10-20",{paid:true,fee:"3",net:"95.00",advance:"2"}));return f.call({action:"settle_sales",paymentDate:"2026-10-20"});
  };
  if(manualAfterPages){await assert.rejects(action(),code("FEE_RECOGNITION_MANUAL_CANDIDATE"));assert.equal((await manualRef.get()).get("status"),"pending");}
  else{const result=await action();const record=path==="recognize"?result.record:result.updated.find(r=>r.batch.kind===(path==="anticipation"?"anticipation":"mdr"));assert.equal(record.batch.amountCents,cents);assert.ok(record.expenseId);}
 });
 }
}
test("R1 limite operacional não declara origem vinculada como manual nem ignora página não examinada",async()=>{
 const f=await fixture("scan-limit");await sourcedEquivalentExpenses(f,251,300);
 await assert.rejects(f.call(f.recognize),code("FEE_RECOGNITION_MANUAL_SCAN_LIMIT"));
 assert.equal((await db.collection("financialAcquirerFeeBatches").doc(f.batch.id).get()).exists,false);
});
