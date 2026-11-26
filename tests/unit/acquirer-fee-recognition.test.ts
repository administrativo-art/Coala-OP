import test from "node:test";
import assert from "node:assert/strict";
import { buildRecognitionBatches, contractFeeCents, recognitionExpenseFields, recognitionTransition, assertFeePeriodOpen } from "../../src/features/financial/acquirer-fees/recognition";
import type { FeeRecognitionComponent, FeeRecognitionPolicy } from "../../src/features/financial/acquirer-fees/recognition-contracts";
const policy: FeeRecognitionPolicy = { version: 1, enabled: true, variableAccountId: "variable", financialAccountId: "financial", closedThroughMonth: null, closedPeriods: [], contracts: [] };
const component: FeeRecognitionComponent = { id: "a".repeat(64), kind: "mdr", transactionId: "sale", installment: 1, soldOn: "2026-10-01", dueOn: "2026-10-31", grossDecimal: "100", feeDecimal: "3", expectedNetDecimal: "97", measurement: "assessed", basis: "provider_fee", sourceFileId: "file", sourceHash: "b".repeat(64), reviewId: "review", reviewRevision: 1, reviewFingerprint: "c".repeat(64), contractId: null, contractVersion: null, settledOn: null, paidNetDecimal: null, anticipationDecimal: null };
test("venda100/taxa3/recebível97 D+30 reconhece sem fingir pagamento", () => {
  const batch = buildRecognitionBatches("w", "u", "1", [component])[0]; assert.equal(batch.amountCents, 300); assert.equal(batch.expectedNetCents, 9700);
  const fields = recognitionExpenseFields(batch, []); assert.equal(fields.status, "provisioned"); assert.equal(fields.paidOn, null); assert.equal(fields.state, "assessed");
  const paid = recognitionExpenseFields({ ...batch, members: [{ ...component, settledOn: "2026-10-31", paidNetDecimal: "97" }] }, [component.id]);
  assert.equal(paid.status, "paid"); assert.equal(paid.paidOn, "2026-10-31"); assert.equal(batch.amountCents, 300);
});
test("taxa zero comprovada conserva componente; contrato arredonda explicitamente e bloqueio de período funciona", () => {
  assert.equal(buildRecognitionBatches("w", "u", "1", [{ ...component, feeDecimal: "0", expectedNetDecimal: "100" }])[0].amountCents, 0);
  const contract = { id: "c", version: 1, approvedAt: "2026-01-01T00:00:00Z", validFrom: "2026-01-01", validThrough: null, source: "cards" as const, brandCode: null, accountTypeCode: null, minInstallments: 1, maxInstallments: 12, rateBasisPoints: 300, fixedCents: 0, rounding: "round" as const };
  assert.equal(contractFeeCents("100", contract), 300); assert.throws(() => assertFeePeriodOpen({ ...policy, closedPeriods: ["2026-10"] }, "2026-10"));
});
test("CAS impede revisão concorrente e duplicação de componentes", () => {
  const batch = buildRecognitionBatches("w", "u", "1", [component])[0];
  assert.throws(() => recognitionTransition({ previous: null, batch, expectedRevision: 1, action: "recognize_sale", policy }));
  assert.throws(() => buildRecognitionBatches("w", "u", "1", [component, component]));
});
import { selectRateContract } from "../../src/features/financial/acquirer-fees/recognition";
import { normalizeFinancialExpenseForDre } from "../../src/features/financial/lib/expense-accounting-contract";
import { calculateDreExpenses } from "../../src/features/financial/lib/dre-expense-calculation";
import { dreResultState } from "../../src/features/financial/lib/dre-statement";
import { feeRecognitionActionSchema } from "../../src/features/financial/acquirer-fees/recognition-contracts";
test("contrato vigente não aplica outra modalidade/parcela e ambiguidade não escolhe taxa", () => {
 const contract = { id:"approved",version:1,approvedAt:"2026-01-01T00:00:00Z",validFrom:"2026-10-01",validThrough:"2026-10-31",source:"cards" as const,brandCode:"1",accountTypeCode:"2",minInstallments:2,maxInstallments:3,rateBasisPoints:300,fixedCents:0,rounding:"round" as const };
 const configured={...policy,contracts:[contract]},sale={date:"2026-10-20",source:"cards" as const,brandCode:"1",accountTypeCode:"2",installmentCount:2};
 assert.equal(selectRateContract(configured,sale)?.id,"approved"); assert.equal(selectRateContract(configured,{...sale,installmentCount:1}),null); assert.equal(selectRateContract(configured,{...sale,date:"2026-11-01"}),null);
 assert.throws(()=>selectRateContract({...configured,contracts:[contract,{...contract,id:"other"}]},sale));
 assert.equal(contractFeeCents("0.17",contract),1); assert.equal(contractFeeCents("0.17",{...contract,rounding:"floor"}),0);
});
test("parcelas não viram recebidas por crédito parcial ou id sem evento financeiro",()=>{
 const rows=[component,{...component,id:"d".repeat(64),installment:2}]; const batch=buildRecognitionBatches("w","u","1",rows)[0];
 assert.equal(recognitionExpenseFields({...batch,members:[{...rows[0],settledOn:"2026-10-31",paidNetDecimal:"97"},rows[1]]},[rows[0].id]).state,"partially_received");
 assert.equal(recognitionExpenseFields(batch,[]).paidOn,null); assert.equal(recognitionExpenseFields(batch,rows.map(r=>r.id)).status,"provisioned");
});
test("provisão é custo variável de competência e seus avisos sobrevivem normalização/cálculo compartilhado DRE",()=>{
 const expense=normalizeFinancialExpenseForDre("fee",{status:"provisioned",competenceMonth:"2026-10",totalValue:3,accountId:"variable",resultCenterId:"unit",sourceSettlement:{kind:"acquirer_fee",estimated:true,sourceIncomplete:true}});
 const calculated=calculateDreExpenses({expenses:[expense],accounts:{variable:{name:"Taxa cartão",drePosition:"custos_variaveis",isDreAccount:true}},monthKey:"2026-10",resultCenter:"Unidade",resultCenterNames:{unit:"Unidade"}});
 assert.equal(calculated.totalsByPosition.custos_variaveis,3); assert.deepEqual(calculated.detailsByPosition.custos_variaveis[0].feeRecognition,{estimated:true,incomplete:true});
 const state=dreResultState({result:97,compositionOpen:false,feeReasons:["Taxa estimada"],cash:{cashDifferenceCoverage:"complete",cashDifferenceProvisional:false,cashDifferenceCoveredDays:31,cashDifferenceTotalDays:31,pendingOperatorCount:0,issues:[]}});
 assert.equal(state.status,"provisional"); assert.ok(state.reasons.includes("Taxa estimada"));
});
test("ações rejeitam tentativa de forjar taxa/paid e campos de outro contrato",()=>{
 const request={kioskId:"u",mappingId:"m",stoneCode:"123",referenceDate:"2026-10-01",source:"cards"};
 assert.equal(feeRecognitionActionSchema.safeParse({action:"preview_sales",request,paid:true}).success,false);
 assert.equal(feeRecognitionActionSchema.safeParse({action:"recognize_sale",request,batchId:"a".repeat(64),fingerprint:"b".repeat(64),resultCenterId:"r",expectedRevision:0,confirmedNoManualExpense:true,amountCents:1}).success,false);
});
