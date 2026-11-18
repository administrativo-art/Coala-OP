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
 for(const sourceId of ['financial-cash-counting-session-openers','financial-inter-charge-creators']){
  for(const admin of [true,false]){const result=await collectPersonSource({actor:{...actor,isDefaultAdmin:admin},sourceId,ref:{namespace:'main.users',id:uid},limit:50,sourceDb});assert.equal(result.status,'unavailable');assert.deepEqual(result.items,[]);assert.match(result.reason,/Consulta pessoal indisponível/);}
 }
 assert.equal(queries,0);
});

test('cobrança ativa cancelada prevalece sobre cabeçalho issued e não projeta entrada',async()=>{
 const {buildCashFlowStudy}=await import('../../src/features/financial/cash-flow-study/model.ts');
 await db.collection('interCobrancas').doc(batch.interCobrancaId).update({status:'cancelled',situacao:'CANCELADO',valorTotalRecebidoCents:0});
 const evidence=await loadStudyCashEvidence([batch],'2026-06-01');const result=buildCashFlowStudy({today:'2026-11-18',accounts:[],stone:[],closures:[closure],batches:[batch],cashEvidence:evidence,expenses:[],realized:[]});assert.equal(result.entries.some(entry=>entry.source==='deposit_boleto'),false);
});
