import test from "node:test";
import assert from "node:assert/strict";
import { buildCardCashForecast, type CardSourceRow } from "../../src/features/financial/cash-flow-study/card-forecast";
import { buildCashFlowStudy, projectRecurringOutflows } from "../../src/features/financial/cash-flow-study/model";
const statement = (id = "oct", extra = {}): CardSourceRow => ({ id, data: { accountId: "account", paymentMethodId: "card", dueDate: "2026-11-12", officialTotal: 3541.46, status: "paid", ...extra } });
const part = (number: number, value: number, dueDate: string, status = "pending", extra = {}) => ({ number, value, dueDate, status, ...extra });
const purchase = (id = "fridge", extra = {}): CardSourceRow => ({ id, data: { plannedPaymentMethodType: "credit_card", plannedBankAccountId: "account", plannedPaymentMethodId: "card", status: "partially_paid", cardStatementId: "oct", installments: [], ...extra } });
const run = (extra: Partial<Parameters<typeof buildCardCashForecast>[0]> = {}) => buildCardCashForecast({ today: "2026-11-18", horizonEnd: "2027-05-31", purchases: [], statements: [], obligations: [], complete: true, ...extra });

test("regressão1536,46: fatura atual paga não antecipa saldos globais;1060,89 futuros mantêm datas,475,57 legado não vira saída", () => {
 const fridge = purchase("fridge", { totalValue: 1682.77, installments: [part(1,140.23,"2026-06-12"),part(2,140.23,"2026-07-12"),part(3,140.23,"2026-08-12"),part(6,140.23,"2026-11-12","paid"), ...[12,1,2,3,4,5].map((month,i)=>part(i+7,i===5?140.24:140.23,`${month===12?2026:2027}-${String(month).padStart(2,"0")}-12`))] });
 const chair=purchase("chair", {totalValue:438.99,installments:[part(1,54.88,"2026-08-12"),part(4,54.87,"2026-11-12","paid"),...[12,1,2,3].map((month,i)=>part(i+5,i%2===0?54.88:54.87,`${month===12?2026:2027}-${String(month).padStart(2,"0")}-12`))]});
 for(const inherited of [false,true]){
  const purchases=[fridge,chair].map(p=>({id:p.id,data:{...p.data,installments:(p.data.installments as object[]).map(x=>({...x,...(inherited?{cardStatementId:"oct"}:{})}))}}));
  const out=run({purchases,statements:[statement()]});assert.equal(out.expenses.reduce((s,x)=>s+x.amountCents,0),106089);assert.ok(out.expenses.every(x=>x.date!>"2026-11-18"&&x.provisioned));
  assert.deepEqual(out.expenses.map(x=>[x.date,x.amountCents]),[["2026-12-12",19511],["2027-01-12",19510],["2027-02-12",19511],["2027-03-12",19510],["2027-04-12",14023],["2027-05-12",14024]]);
  assert.ok(out.gaps.length);if(inherited)assert.match(out.gaps.join(" "),/referência de fatura antiga/);
  const unrelatedGap=run({purchases,statements:[statement()],complete:false,futureCoverageComplete:true,blockedInstruments:[JSON.stringify(["unrelated","card"])]});assert.deepEqual(unrelatedGap.expenses,out.expenses);assert.equal(unrelatedGap.expenses.reduce((s,x)=>s+x.amountCents,0),106089);
 }
});

test("fatura oficial substitui parcelas previstas e saldo parcial é única saída, não total+compra",()=>{
 const out=run({purchases:[purchase("one",{installments:[part(1,100,"2026-12-12")]})],statements:[statement("dec",{status:"closed",dueDate:"2026-12-12",officialTotal:150,obligationId:"ob"})],obligations:[{id:"ob",data:{sourceId:"dec",obligationType:"CARD_STATEMENT",status:"PARTIALLY_PAID",summary:{balanceAmountCents:5000}}}]});
 assert.deepEqual(out.expenses.map(x=>[x.date,x.amountCents,x.provisioned]),[["2026-12-12",5000,false]]);
 const model=buildCashFlowStudy({today:"2026-11-18",accounts:[],closures:[],batches:[],stone:[],realized:[],expenses:out.expenses});assert.equal(model.entries.filter(x=>x.direction==="out").reduce((s,x)=>s+x.amountCents,0),5000);
});

test("fatura paga/cancelada/zero conhecido não ressurgem; ausência de valor ou obrigação é inconclusiva",()=>{
 for(const data of [{status:"paid"},{status:"cancelled"},{status:"closed",officialTotal:0},{status:"closed",officialTotal:null},{status:"closed",obligationId:"missing"}]){
  const out=run({statements:[statement("s",data)]});assert.equal(out.expenses.length,0);if(data.officialTotal===null||data.obligationId)assert.ok(out.gaps.length);
 }
});

test("duas faturas no mesmo ciclo, instrumento diferente, pointer futuro inválido e cobertura truncada não inventam saldo",()=>{
 const future=purchase("one",{installments:[part(1,10,"2026-12-12")]});
 const dupe=run({purchases:[future],statements:[statement("a",{dueDate:"2026-12-12",status:"open"}),statement("b",{dueDate:"2026-12-12",status:"closed"})]});assert.equal(dupe.expenses.length,0);assert.ok(dupe.gaps.length);
 const other=run({purchases:[purchase("x",{installments:[part(1,10,"2026-12-12","pending",{cardStatementId:"oct"})]})],statements:[statement("oct",{paymentMethodId:"other"})]});assert.equal(other.expenses.length,0);assert.ok(other.gaps.length);
 const truncated=run({purchases:[future],complete:false});assert.equal(truncated.expenses.length,0);assert.match(truncated.gaps.join(" "),/Cobertura/);
});

test("pago realizado do cartão continua na saúde mas não reaparece como média recorrente",()=>{
 const realized=["2026-08-12","2026-09-12","2026-10-12"].map(date=>({date,direction:"out" as const,amountCents:10000,category:{id:"card",name:"Cartão"},transfer:false,cardPayment:true}));
 assert.equal(projectRecurringOutflows({today:"2026-11-18",realized,expenses:[]},"2027-05-31").length,0);
});

test("pagamento de fatura não abate recorrência genérica sem categoria, nem fatura prevista a encobre",()=>{
 const history=["2026-08-10","2026-09-10","2026-10-10"].map(date=>({date,direction:"out" as const,amountCents:10000,category:null,transfer:false}));
 const base={today:"2026-11-18",realized:history,expenses:[]};
 const expected=projectRecurringOutflows(base,"2026-12-31");
 const actual=projectRecurringOutflows({...base,realized:[...history,{date:"2026-11-12",direction:"out",amountCents:10000,category:null,transfer:false,cardPayment:true}],expenses:[{id:"card",description:"Fatura",supplier:null,date:"2026-12-12",amountCents:10000,provisioned:true,category:null,excludeFromRecurringCoverage:true}]},"2026-12-31");
 assert.deepEqual(actual,expected);
});

test("obrigação de outra fatura e data civil inválida são inconclusivas, sem valor inventado",()=>{
 const wrong=run({statements:[statement("one",{status:"closed",obligationId:"ob"})],obligations:[{id:"ob",data:{status:"PAID",obligationType:"CARD_STATEMENT",sourceId:"other",summary:{balanceAmountCents:0}}}]});assert.equal(wrong.expenses.length,0);assert.ok(wrong.gaps.length);
 const invalid=run({purchases:[purchase("x",{installments:[part(1,10,"2027-02-30")]})]});assert.equal(invalid.expenses.length,0);assert.ok(invalid.gaps.length);
});

test("lacuna de instrumento alheio não suprime previsão confiável de outro cartão",()=>{
 const out=run({complete:false,futureCoverageComplete:true,blockedInstruments:[JSON.stringify(["other","card"])],purchases:[purchase("good",{installments:[part(1,100,"2026-12-12")]}),purchase("missing",{plannedBankAccountId:"other",installments:[part(1,50,"2026-12-12")]})]});
 assert.equal(out.expenses.reduce((s,x)=>s+x.amountCents,0),10000);assert.match(out.gaps.join(" "),/Cobertura/);
});
