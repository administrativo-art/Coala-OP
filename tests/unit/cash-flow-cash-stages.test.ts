import test from "node:test";
import assert from "node:assert/strict";
import { buildCashFlowStudy, type StudyBatch, type StudyClosure } from "../../src/features/financial/cash-flow-study/model";
import { buildCashOperations, isConfirmedCashBoleto, isForecastCashBoleto, type StudyCashBill, type StudyCashEvidence, type StudyCashSession } from "../../src/features/financial/cash-flow-study/cash-stages";
import { buildPeriodRows } from "../../src/features/financial/cash-flow-study/periods";

const closure = (unit: string, day: number, status = "approved", extra: Partial<StudyClosure> = {}): StudyClosure => ({ kioskId: unit, kioskName: unit, date: `2026-10-${String(day).padStart(2, "0")}`, status,
  operatorCount: 2, countedCashCents: status === "approved" ? 10000 : 0, cashDepositPolicy: "dre_only", depositEligibleCents: 0, depositStatus: "not_eligible",
  byChannelCents: { cash: 11000, pix: 0, debit_card: 0, credit_card: 0 }, ...extra });
const batch = (id: string, sessionId: string, unit: string, totalCents = 10000): StudyBatch => ({ id, workspaceId: "coala", kioskId: unit, kioskName: unit, countingSessionId: sessionId, interCobrancaId: `${id}_bill`, status: "issued", totalCents,
  periodStartDate: "2026-10-01", periodEndDate: "2026-11-06", issuedAt: "2026-11-13T12:00:00Z", paidAt: null });
const bill = (batch: StudyBatch): StudyCashBill => ({ id: batch.interCobrancaId!, workspaceId: "coala", batchId: batch.id, status: "paid", situacao: "RECEBIDO", origemRecebimento: "BOLETO", recebidoManual: false, valorNominalCents: batch.totalCents, valorTotalRecebidoCents: batch.totalCents });
const session = (id: string, unit: string, closures: StudyClosure[], batches: StudyBatch[]): StudyCashSession => ({ id, workspaceId: "coala", status: "completed", kioskIds: [unit], scopes: [{ kioskId: unit, year: 2026, month: 10 }], batchIds: batches.map(b => b.id), scopeAggregationVersion: 1,
  finalizedOperatorCountsByDate: Object.fromEntries(closures.map(c => [c.date, c.operatorCount!])), noteTotalCents: batches.reduce((sum,b) => sum+b.totalCents,0), countedCashCents: batches.reduce((sum,b) => sum+b.totalCents,0)+50,
  coinReturnedToTillCents: 50, coinPendingExchangeCents: 0, dreOnlyCashCents: 0 });
const evidence = (sessions: StudyCashSession[], batches: StudyBatch[]): StudyCashEvidence => ({ workspaceId: "coala", sessions, bills: batches.map(bill), gaps: [] });

test("outubro sintético:82/82diasaprovados (81espécie+1zero) em5sessões/8boletos não voltam ao saldo", () => {
  const open: Record<string,number[]> = { auto: [12,19,30], joao: [1,2,9,10,19], tiri: [1,2,19] };
  const closures = Object.entries(open).flatMap(([unit,days]) => Array.from({length:31},(_,i) => closure(unit,i+1,days.includes(i+1)?"draft":"approved",unit==="auto"&&i+1===18?{countedCashCents:0,byChannelCents:{cash:0,pix:0,debit_card:0,credit_card:0}}:{})));
  for (const c of closures) if ((c.kioskId === "auto" && [12,19].includes(Number(c.date.slice(8)))) || (["joao","tiri"].includes(c.kioskId) && c.date.endsWith("-19"))) { c.byChannelCents.cash=0; c.operatorCount=0; }
  const approved=closures.filter(c=>c.status==="approved");assert.equal(approved.length,82);
  const sessions:StudyCashSession[]=[],batches:StudyBatch[]=[];
  for(const unit of ["auto","joao","tiri"]){const group=approved.filter(c=>c.kioskId===unit);const groups=unit==="auto"?[group.slice(0,7),group.slice(7,18),group.slice(18)]:[group];
    groups.forEach((g,index)=>{const id=`${unit}_${index}`;const count=unit==="tiri"?3:unit==="joao"?2:1;const bs=Array.from({length:count},(_,i)=>batch(`${id}_${i}`,id,unit));batches.push(...bs);sessions.push(session(id,unit,g,bs));});}
  assert.equal(sessions.length,5);assert.equal(batches.length,8);
  const result=buildCashFlowStudy({today:"2026-11-18",accounts:[{id:"bank",name:"bank",kind:"operating",cents:100000,at:null}],closures,batches,cashEvidence:evidence(sessions,batches),expenses:[],stone:[],realized:[]});
  assert.equal(result.cashOperations.filter(c=>c.stage==="received").length,81);
  assert.equal(closures.filter(c=>c.status!=="approved").length,11);
  assert.equal(result.cashOperations.filter(c=>c.stage!=="received").length,7);
  assert.equal(result.entries.some(e=>["cash_open","deposit_counted","deposit_boleto"].includes(e.source)),false);
  for(const projection of [false,true]){const rows=buildPeriodRows(result,{range:{from:"2026-11-18",to:"2026-11-18"},granularity:"day",projection,includeReserve:false});assert.equal(rows[0].closingCents,100000);}
});

test("parcial usa contagens oficiais sem inferir remanescente; dre_only sozinho não comprova recebido",()=>{
  const c=closure("joao",10,"pending_review",{operatorCount:3});const b=batch("partial","s","joao");const s=session("s","joao",[{...c,operatorCount:2}],[b]);
  const row=buildCashOperations([c],[b],evidence([s],[b]))[0];assert.equal(row.stage,"partial");assert.equal(row.finalizedOperators,2);assert.equal(row.receivedOperators,2);assert.equal(row.remainingCents,null);
  assert.equal(buildCashOperations([closure("joao",1)],[],evidence([],[]))[0].stage,"excluded");
});

test("recebido exige valor/identidade/Inter, sem manual; moedas e limites não geram nova entrada",()=>{
  const c=closure("tiri",3),b=batch("b","s","tiri"),s=session("s","tiri",[c],[b]),e=evidence([s],[b]);assert.equal(isConfirmedCashBoleto(b,e),true);
  for(const patch of [{situacao:"MARCADO_RECEBIDO"},{recebidoManual:true},{valorTotalRecebidoCents:9999},{workspaceId:"outro"},{batchId:"outro"}])assert.equal(isConfirmedCashBoleto(b,{...e,bills:[{...e.bills[0],...patch}]}),false);
  assert.notEqual(buildCashOperations([c],[b],{...e,sessions:[{...s,noteTotalCents:9999}]})[0].stage,"received");
  assert.notEqual(buildCashOperations([c],[b],{...e,sessions:[{...s,kioskIds:["tiri","outra"]}]})[0].stage,"received");
  assert.notEqual(buildCashOperations([c],[b],{...e,sessions:[s,{...s,id:"duplicate"}]})[0].stage,"received");
});

test("outros meses e origem antiga não são deslocados para hoje",()=>{
 const c={...closure("k",1,"draft"),date:"2025-12-01"};const row=buildCashOperations([c],[],evidence([],[]))[0];assert.equal(row.originDate,"2025-12-01");assert.equal(row.remainingCents,null);
});

test("malote ausente/outra unidade/outra sessão/cancelado não vira vínculo confirmado",()=>{
 const c=closure("k",1,"approved",{cashDepositPolicy:"standard"}),b=batch("b","s","k"),s=session("s","k",[c],[b]),e=evidence([s],[b]);
 for(const bs of [[],[{...b,kioskId:"other"}],[{...b,kioskIds:["k","other"]}],[{...b,countingSessionId:"other"}],[{...b,status:"cancelled"}],[{...b,workspaceId:"other"}]])assert.equal(buildCashOperations([c],bs,e)[0].stage,"unavailable");
});

test("parcial distingue contado sem malote de contagem alocada sem receber, sem inferir dinheiro",()=>{
 const c=closure("k",1,"pending_review",{operatorCount:3,cashDepositPolicy:"standard"}),b=batch("b","s","k");
 const s=session("s","k",[{...c,operatorCount:2}],[b]);const pending={...bill(b),status:"issued",situacao:"A_RECEBER",valorTotalRecebidoCents:0};
 const without=buildCashOperations([c],[],{...evidence([{...s,status:"counted",batchIds:[]}],[]),bills:[]})[0];
 const withBatch=buildCashOperations([c],[b],{...evidence([s],[b]),bills:[pending]})[0];
 assert.equal(without.stage,"partial");assert.equal(withBatch.stage,"partial");assert.equal(without.allocatedOperators,0);assert.equal(withBatch.allocatedOperators,2);assert.equal(without.receivedOperators,0);assert.equal(withBatch.receivedOperators,0);assert.equal(without.remainingCents,null);assert.equal(withBatch.remainingCents,null);
});

test("sessão ambígua e agregado não versionado exibem conferir; dre_only não oculta contagem",()=>{
 const c=closure("k",1,"draft"),b=batch("b","s","k"),s=session("s","k",[c],[b]);
 for(const bad of [{...s,kioskIds:["k","other"]},{...s,scopeAggregationVersion:null}])assert.equal(buildCashOperations([c],[b],evidence([bad],[b]))[0].stage,"unavailable");
 const draft=buildCashOperations([c],[],evidence([],[]))[0];assert.equal(draft.stage,"awaiting_count");assert.equal(draft.outsideDepositPolicy,true);
});

test("somente cobrança ativa ainda a receber confirma previsão; cancelada/manual/ausente/valor parcial não somam saldo",()=>{
 const b=batch("b","s","k"),s=session("s","k",[],[b]),base=evidence([s],[b]),pending={...bill(b),status:"issued",situacao:"A_RECEBER",origemRecebimento:null,valorTotalRecebidoCents:0};
 assert.equal(isForecastCashBoleto(b,{...base,bills:[pending]}),true);
 for(const bills of [[],[{...pending,status:"cancelled",situacao:"CANCELADO"}],[{...pending,recebidoManual:true}],[{...pending,valorTotalRecebidoCents:100}],[{...pending,workspaceId:"other"}]]){
  const e={...base,bills};assert.equal(isForecastCashBoleto(b,e),false);const result=buildCashFlowStudy({today:"2026-11-18",accounts:[{id:"bank",name:"bank",kind:"operating",cents:100,at:null}],closures:[],batches:[b],cashEvidence:e,expenses:[],stone:[],realized:[]});
  assert.equal(result.entries.some(entry=>entry.source==="deposit_boleto"),false);
  for(const projection of [false,true])assert.equal(buildPeriodRows(result,{range:{from:"2026-11-18",to:"2026-11-18"},granularity:"day",projection,includeReserve:false})[0].closingCents,100);
 }
});

test("corte de pendências por origem:30/09 fora e01/10 dentro nas trêsunidades e em todos os estágios pendentes",async()=>{
 const {pendingCashOperations,CASH_PENDING_FROM}=await import('../../src/features/financial/cash-flow-study/cash-stages');
 assert.equal(CASH_PENDING_FROM,'2026-10-01');
 const stages=['awaiting_count','partial','counted','in_batch','excluded','unavailable'] as const;
 const operations=['tirirical','joao-paulo','automovel'].flatMap(unit=>stages.flatMap(stage=>['2026-09-30','2026-10-01'].map(originDate=>({id:`${unit}:${stage}:${originDate}`,unitId:unit,unitName:unit,originDate,stage,referenceCents:10000,finalizedOperators:stage==='partial'?1:0,allocatedOperators:0,receivedOperators:0,totalOperators:2,remainingCents:null,outsideDepositPolicy:false}))));
 const visible=pendingCashOperations(operations);assert.equal(visible.length,18);assert.ok(visible.every(row=>row.originDate==='2026-10-01'));assert.equal(visible.filter(row=>row.stage==='partial').length,3);assert.equal(operations.length,36,'dados de origem preservados');
});

test("corte operacional não esconde boleto/Stone antigos legítimos nem altera saldo e fontes",async()=>{
 const {pendingCashOperations}=await import('../../src/features/financial/cash-flow-study/cash-stages');
 const c=closure('k',1,'draft',{cashDepositPolicy:'standard'}),old={...c,date:'2026-09-30'},b={...batch('legacy','s','k'),periodStartDate:'2026-09-01',periodEndDate:'2026-09-30',issuedAt:'2026-09-30T12:00:00Z'};
 const e=evidence([],[b]);e.bills[0]={...e.bills[0],status:'issued',situacao:'ATRASADO',valorTotalRecebidoCents:0};
 const input={today:'2026-11-18',accounts:[{id:'bank',name:'bank',kind:'operating' as const,cents:12345,at:null}],closures:[old,c],batches:[b],cashEvidence:e,expenses:[],stone:[{dueDate:'2026-09-30',grossCents:1000,netCents:950,feeCents:50}],realized:[]};
 const result=buildCashFlowStudy(input);assert.equal(pendingCashOperations(result.cashOperations).length,1);assert.equal(result.startBalanceCents,12345);assert.equal(input.closures.length,2);
 assert.ok(result.entries.some(row=>row.source==='deposit_boleto'));assert.ok(result.entries.some(row=>row.source==='stone'));assert.equal(result.entries.some(row=>row.source==='cash_open'||row.source==='deposit_counted'),false);
});
