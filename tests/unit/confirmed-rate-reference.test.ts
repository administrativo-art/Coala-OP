import test from "node:test";
import assert from "node:assert/strict";
import { confirmedRateReferences,referenceOnDate,type RateDecisionRecord } from "../../src/features/financial/receipts-reconciliation/confirmed-rate-reference";
import { feeDecisionInputSchema } from "../../src/features/financial/receipts-reconciliation/fee-review";
import { collectSaleRecognition } from "../../src/features/financial/acquirer-fees/recognition-source";
import { parseStoneAgendaXml } from "../../src/lib/integrations/stone/agenda-parser";
import { dailySalesSourceFingerprint } from "../../src/features/financial/sales-reconciliation/review-state";
const scope={workspaceId:"w",mappingId:"mapping",kioskId:"unit",stoneCode:"123"};
const row=(patch:Record<string,unknown>={}):RateDecisionRecord=>({...scope,id:"ref",revision:1,kind:"group_rate",decision:"confirmed",groupKey:"Visa|credit",rate:0.03,since:"2026-10-01",actorId:"admin",actorNamespace:"main.users",decidedAt:"2026-10-02T00:00:00Z",...patch});
test("vigência da venda respeita histórico, zero conhecido e não usa outra unidade/contrato/StoneCode",()=>{
 const refs=confirmedRateReferences([row(),row({id:"new",rate:0.025,since:"2026-10-15"}),row({id:"wrong",mappingId:"other",rate:.99}),row({id:"pix",groupKey:"pix",rate:0})],scope).references;
 assert.equal(referenceOnDate(refs,"Visa|credit","2026-10-14")?.rate,.03);assert.equal(referenceOnDate(refs,"Visa|credit","2026-10-15")?.rate,.025);assert.equal(referenceOnDate(refs,"Visa|credit","2026-09-30"),null);assert.equal(referenceOnDate(refs,"pix","2026-10-01")?.rate,0);assert.equal(referenceOnDate(refs,"Visa|debit","2026-10-01"),null);
 for(const patch of [{kioskId:"other"},{stoneCode:"456"},{workspaceId:"other"},{decision:"accepted"}]) assert.equal(confirmedRateReferences([row(patch)],scope).references.length,0);
});
test("legado sem escopo exige prova histórica inequívoca, sugestão e data inválida não viram referência",()=>{
 assert.equal(confirmedRateReferences([row({mappingId:undefined,kioskId:undefined})],scope).unresolved,1);
 assert.equal(confirmedRateReferences([row({mappingId:undefined,kioskId:undefined})],scope,()=>true).references.length,1);
 assert.equal(confirmedRateReferences([row({decision:"suggested"})],scope).references.length,0);
 assert.equal(confirmedRateReferences([row({since:"2026-02-30"})],scope).references.length,0);
});
test("confirmar referência exige início civil explícito, sem converter janela60dias em vigência",()=>{
 const input={kioskId:"unit",stoneCode:"123",month:"2026-10",kind:"group_rate",itemKey:"Visa|credit",decision:"confirmed",fingerprint:"group:0.03"};
 assert.equal(feeDecisionInputSchema.safeParse({...input,kind:"sale_fee",decision:"new_rate",effectiveFrom:"2026-11-01"}).success,false);assert.equal(feeDecisionInputSchema.safeParse(input).success,false);assert.equal(feeDecisionInputSchema.safeParse({...input,effectiveFrom:"2026-02-30"}).success,false);assert.equal(feeDecisionInputSchema.safeParse({...input,effectiveFrom:"2026-10-01"}).success,true);
});
// Full production collector: a confirmed match is necessary, not just equal totals.
function source(mdr:string|null,net="97.00") {
 const request={...scope,referenceDate:"2026-10-01",source:"cards" as const};
 const xml=`<Conciliation><Header><StoneCode>123</StoneCode><ReferenceDate>20261001</ReferenceDate><LayoutVersion>2.2</LayoutVersion><FileId>f</FileId><GenerationDateTime>20261002060000</GenerationDateTime></Header><FinancialTransactions><Transaction><AcquirerTransactionKey>sale</AcquirerTransactionKey><CaptureLocalDateTime>20261001120000</CaptureLocalDateTime><AccountType>2</AccountType><BrandId>1</BrandId><FeeType>1</FeeType><AuthorizationCurrencyCode>986</AuthorizationCurrencyCode><Events><Captures>1</Captures><Payments>0</Payments><Cancellations>0</Cancellations><CancellationCharges>0</CancellationCharges><Chargebacks>0</Chargebacks><ChargebackRefunds>0</ChargebackRefunds></Events><Installments><Installment><InstallmentNumber>1</InstallmentNumber><GrossAmount>100.00</GrossAmount><NetAmount>${net}</NetAmount>${mdr===null?"":`<MdrAmount>${mdr}</MdrAmount>`}<PrevisionPaymentDate>20261031</PrevisionPaymentDate></Installment></Installments></Transaction></FinancialTransactions><FinancialTransactionsAccounts /></Conciliation>`;
 const review={scope:{workspaceId:"w",kioskId:"unit",stoneCode:"123",referenceDate:"2026-10-01"},mappingId:"mapping",pdvFacts:[],uncomparedPdvFacts:[],issues:[],stoneEvents:[],review:{id:"review",revision:1,status:"closed"},stoneSales:[{id:"stone",channel:"credit_card",grossAmountCents:10000,identifiers:{providerTransactionId:"sale"}}],cases:[{kind:"matched",reviewStatus:"auto_checked",differenceAmountCents:0,channel:"credit_card",kioskId:"unit",businessDate:"2026-10-01",stoneSaleIds:["stone"],matchBasis:"provider_transaction_id"}]};
 // Fields used by fingerprint are deliberately provided by the real integration fixtures below; collector only hashes source facts.
 void dailySalesSourceFingerprint;
 return {request,workspaceId:"w",file:parseStoneAgendaXml(xml,request),pix:null,review:review as unknown as Parameters<typeof collectSaleRecognition>[0]["review"],policy:null,references:confirmedRateReferences([row()],scope).references};
}
test("MDRStone prevalece; semMDR referência confirmada produz estimativa antesD+30 semcadastro paralelo",()=>{
 const estimated=collectSaleRecognition(source(null));assert.equal(estimated.batches.length,1);assert.equal(estimated.batches[0].amountCents,300);assert.equal(estimated.batches[0].measurement,"estimated");assert.equal(estimated.batches[0].members[0].basis,"confirmed_reference");
 const exact=collectSaleRecognition(source("2.50","97.50"));assert.equal(exact.batches[0].amountCents,250);assert.equal(exact.batches[0].measurement,"assessed");assert.equal(exact.batches[0].members[0].rateReference,undefined);
 const missing=source(null);missing.references=[];assert.equal(collectSaleRecognition(missing).batches.length,0);
});
