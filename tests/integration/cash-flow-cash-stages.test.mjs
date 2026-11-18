import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';
assertFirestoreEmulatorSafety({ projectId:'demo-coala-repository', databaseId:'coala-financeiro' });
enableServerOnlyTestImports('demo-coala-repository');
const { financialDbAdmin:db } = await import('../../src/lib/firebase-financial-admin.ts');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { loadStudyCashEvidence } = await import('../../src/features/financial/cash-flow-study/cash-evidence.server.ts');
const { buildCashOperations } = await import('../../src/features/financial/cash-flow-study/cash-stages.ts');
const { collectPersonSource } = await import('../../src/features/privacy/person-inventory.server.ts');
const refs=[];test.after(async()=>{await Promise.all(refs.map(ref=>ref.delete()));});
async function put(collection,id,data){const ref=db.collection(collection).doc(id);refs.push(ref);await ref.set(data);return ref;}
const batch={workspaceId:'coala',id:'cash-stage-batch',kioskId:'unit',kioskName:'Unit',countingSessionId:'cash-stage-session',interCobrancaId:'cash-stage-bill',status:'issued',totalCents:10000,periodStartDate:'2026-10-01',periodEndDate:'2026-11-06',issuedAt:'2026-11-13',paidAt:null};
const closure={kioskId:'unit',kioskName:'Unit',date:'2026-10-10',status:'approved',operatorCount:2,countedCashCents:10050,cashDepositPolicy:'dre_only',depositStatus:'not_eligible',depositEligibleCents:0,byChannelCents:{cash:11000,pix:0,debit_card:0,credit_card:0}};
const sessionData={workspaceId:'coala',status:'completed',kioskIds:['unit'],scopes:[{kioskId:'unit',year:2026,month:10}],scopeAggregationVersion:1,batchIds:[batch.id],finalizedOperatorCountsByDate:{'2026-10-10':2},countedCashCents:10050,noteTotalCents:10000,coinReturnedToTillCents:50,coinPendingExchangeCents:0,dreOnlyCashCents:0,openedBy:'cash-stage-actor',openedByName:'must-not-export'};
const billData={workspaceId:'coala',batchId:batch.id,status:'paid',situacao:'RECEBIDO',origemRecebimento:'BOLETO',recebidoManual:false,valorNominalCents:10000,valorTotalRecebidoCents:10000,createdBy:'cash-stage-actor',createdByName:'must-not-export'};

test('loader real lê apenas referências/mascara e liga sessão+Inter sem produtor/escrita',async()=>{
 await put('cashCountingSessions',batch.countingSessionId,sessionData);await put('interCobrancas',batch.interCobrancaId,billData);
 const evidence=await loadStudyCashEvidence([batch],'2026-06-01');assert.equal(evidence.gaps.length,0);assert.equal(buildCashOperations([closure],[batch],evidence)[0].stage,'received');
 assert.equal(/openedBy|createdBy|must-not-export/.test(JSON.stringify(evidence)),false);
 assert.equal((await db.collection('cashCountingSessions').doc(batch.countingSessionId).get()).get('status'),'completed');
});

test('documento estrangeiro/missing não confirma recebido e não vaza escopo',async()=>{
 await put('cashCountingSessions','cash-stage-foreign-session',{...sessionData,workspaceId:'other'});await put('interCobrancas','cash-stage-foreign-bill',{...billData,workspaceId:'other'});
 const foreign={...batch,countingSessionId:'cash-stage-foreign-session',interCobrancaId:'cash-stage-foreign-bill'};const evidence=await loadStudyCashEvidence([foreign],'2026-06-01');
 assert.equal(evidence.sessions.length,0);assert.equal(evidence.bills.length,0);assert.ok(evidence.gaps.length);assert.notEqual(buildCashOperations([closure],[foreign],evidence)[0].stage,'received');
 const absent=await loadStudyCashEvidence([{...batch,countingSessionId:'cash-stage-missing',interCobrancaId:'cash-stage-missing'}],'2026-06-01');assert.ok(absent.gaps.length);
});

test('teto de50sessões e200lotes explícito, sem alegar cobertura total',async()=>{
 for(let i=0;i<51;i++)await put('cashCountingSessions',`cash-stage-active-${String(i).padStart(2,'0')}`,{...sessionData,openedBy:'limit-other-actor',status:'open',updatedAt:`2026-11-01T00:00:${String(i).padStart(2,'0')}.000Z`,batchIds:[]});
 const evidence=await loadStudyCashEvidence(Array.from({length:201},(_,i)=>({...batch,id:`limit-${i}`,countingSessionId:null,interCobrancaId:null})),'2026-06-01');
 assert.equal(evidence.sessions.length,50);assert.ok(evidence.gaps.some(g=>/50/.test(g)));assert.ok(evidence.gaps.some(g=>/malotes/.test(g)));
});

test('inventário permanece indisponível até ACL nativa por unidade, sem consultar registros',async()=>{
 const uid='cash-stage-actor';const user=dbAdmin.collection('users').doc(uid);refs.push(user);await user.set({workspaceId:'coala',unitIds:['A']});
 let queries=0;const sourceDb={collection(){queries++;throw Error('personal query forbidden until native policy');}};
 const actor={decoded:{uid:'cash-stage-reader'},userDoc:{unitAccessScope:'selected',unitAccessUnitIds:['A']},permissions:{dp:{collaborators:{view:true}},financial:{view:true,personnelCosts:{view:true}}},isDefaultAdmin:true,workspace_id:'coala'};
 for(const sourceId of ['financial-cash-counting-session-openers','financial-inter-charge-creators','financial-card-statement-creators','financial-card-obligation-creators']){
  for(const admin of [true,false]){const result=await collectPersonSource({actor:{...actor,isDefaultAdmin:admin},sourceId,ref:{namespace:'main.users',id:uid},limit:50,sourceDb});assert.equal(result.status,'unavailable');assert.deepEqual(result.items,[]);assert.match(result.reason,/Consulta pessoal indisponível/);}
 }
 assert.equal(queries,0);
});

test('cobrança ativa cancelada prevalece sobre cabeçalho issued e não projeta entrada',async()=>{
 const {buildCashFlowStudy}=await import('../../src/features/financial/cash-flow-study/model.ts');
 await db.collection('interCobrancas').doc(batch.interCobrancaId).update({status:'cancelled',situacao:'CANCELADO',valorTotalRecebidoCents:0});
 const evidence=await loadStudyCashEvidence([batch],'2026-06-01');const result=buildCashFlowStudy({today:'2026-11-18',accounts:[],stone:[],closures:[closure],batches:[batch],cashEvidence:evidence,expenses:[],realized:[]});assert.equal(result.entries.some(entry=>entry.source==='deposit_boleto'),false);
});

test('cartão: carregador real preserva fatura paga e projeta só ciclos futuros registrados, sem escrita',async()=>{
 const {loadStudyCardForecast}=await import('../../src/features/financial/cash-flow-study/card-forecast.server.ts');
 const {toStudyExpense,toStudyRealized}=await import('../../src/features/financial/cash-flow-study/cash-flow-study.server.ts');
 const id='cash-stage-card-paid';const paid=await put('cardStatements',id,{accountId:'a',paymentMethodId:'m',dueDate:'2026-11-12',status:'paid',officialTotal:100,obligationId:'cash-stage-ob-paid',createdBy:'PERSON-MUST-NOT-LEAK'});
 await put('financialObligations','cash-stage-ob-paid',{sourceId:id,obligationType:'CARD_STATEMENT',status:'PAID',summary:{balanceAmountCents:0},createdBy:{uid:'PERSON-MUST-NOT-LEAK'}});
 const purchase={id:'card-purchase',data:{status:'partially_paid',plannedPaymentMethodType:'credit_card',plannedBankAccountId:'a',plannedPaymentMethodId:'m',totalValue:300,cardStatementId:id,dueDate:'2026-11-12',installments:[{number:1,dueDate:'2026-11-12',status:'paid',value:100},{number:2,dueDate:'2026-12-12',status:'pending',value:100,cardStatementId:id}]}};
 const before=(await paid.get()).updateTime.toMillis();
 const result=await loadStudyCardForecast([purchase],'2026-11-18');assert.equal(result.complete,true);assert.deepEqual(result.expenses.map(x=>[x.date,x.amountCents,x.provisioned]),[['2026-12-12',10000,true]]);assert.match(result.gaps.join(' '),/referência de fatura antiga/);assert.doesNotMatch(JSON.stringify(result),/PERSON-MUST-NOT-LEAK/);assert.equal((await paid.get()).updateTime.toMillis(),before);
 assert.equal(toStudyExpense('card',purchase.data),null);assert.equal(toStudyExpense('pix',{status:'pending',totalValue:100,plannedPaymentMethodType:'pix',dueDate:'2026-11-20'}).amountCents,10000);
 assert.equal(toStudyRealized({date:'2026-11-12',direction:'out',amount:100,cardStatementId:id}).cardPayment,true);
});

test('cartão: fatura oficial aberta substitui parcelas do mesmo vencimento e saldo parcial vem da obrigação',async()=>{
 const {loadStudyCardForecast}=await import('../../src/features/financial/cash-flow-study/card-forecast.server.ts');
 await put('cardStatements','cash-stage-card-next',{accountId:'a',paymentMethodId:'m',dueDate:'2026-12-12',status:'closed',officialTotal:150,obligationId:'cash-stage-ob-next'});
 await put('financialObligations','cash-stage-ob-next',{sourceId:'cash-stage-card-next',obligationType:'CARD_STATEMENT',status:'PARTIALLY_PAID',summary:{balanceAmountCents:5000}});
 const result=await loadStudyCardForecast([{id:'future',data:{status:'pending',plannedPaymentMethodType:'credit_card',plannedBankAccountId:'a',plannedPaymentMethodId:'m',installments:[{number:1,dueDate:'2026-12-12',status:'pending',value:100}]}}],'2026-11-18');assert.deepEqual(result.expenses.map(x=>[x.date,x.amountCents]),[['2026-12-12',5000]]);
});

test('cartão: limite operacional sinaliza cobertura e não transforma parcelas sem cobertura em certeza',async()=>{
 const {loadStudyCardForecast,CARD_FORECAST_LIMITS}=await import('../../src/features/financial/cash-flow-study/card-forecast.server.ts');
 const calls=[];const docs=Array.from({length:121},(_,i)=>({id:`bounded-${i}`,data:()=>({accountId:`a${i}`,paymentMethodId:'m',dueDate:'2026-12-12',status:'open',officialTotal:1})}));
 const fake={collection(name){calls.push(name);assert.equal(name,'cardStatements');return{where(field,op,value){assert.equal(field,'status');assert.equal(op,'in');assert.deepEqual(value,['open','closed']);return{limit(n){assert.equal(n,CARD_FORECAST_LIMITS.activeStatements+1);return{select(...fields){assert.ok(!fields.includes('createdBy'));assert.ok(!fields.includes('allocations'));return{get:async()=>({size:docs.length,docs})};}};}};}};}};
 const result=await loadStudyCardForecast([{id:'future',data:{status:'pending',plannedPaymentMethodType:'credit_card',plannedBankAccountId:'other',plannedPaymentMethodId:'m',installments:[{number:1,status:'pending',dueDate:'2026-12-12',value:100}]}}],'2026-11-18',true,fake);
 assert.equal(result.complete,false);assert.equal(result.expenses.filter(x=>x.id.startsWith('card-cycle:')).length,0);assert.match(result.gaps.join(' '),/Cobertura/);assert.equal(calls.length,1);
});

test('cartão: fatura ausente de outro instrumento não suprime ciclos futuros confiáveis',async()=>{
 const {loadStudyCardForecast}=await import('../../src/features/financial/cash-flow-study/card-forecast.server.ts');
 const purchases=[{id:'good-other-account',data:{status:'pending',plannedPaymentMethodType:'credit_card',plannedBankAccountId:'reliable',plannedPaymentMethodId:'card',installments:[{number:1,status:'pending',value:195.11,dueDate:'2026-12-12'}]}},{id:'broken-other-account',data:{status:'pending',plannedPaymentMethodType:'credit_card',plannedBankAccountId:'unrelated',plannedPaymentMethodId:'card',cardStatementId:'missing-reference-for-other-card',installments:[{number:1,status:'pending',value:20,dueDate:'2026-12-12'}]}}];
 const result=await loadStudyCardForecast(purchases,'2026-11-18');assert.equal(result.complete,false);assert.equal(result.expenses.find(x=>x.id.startsWith('card-cycle:'))?.amountCents,19511);assert.equal(result.expenses.filter(x=>x.id.startsWith('card-cycle:')).length,1);assert.match(result.gaps.join(' '),/Cobertura/);
});
