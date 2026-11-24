import assert from 'node:assert/strict';
import test from 'node:test';
import { closingPhase } from '../../src/features/dp/time-adjustments/closing-progress';
import { strictMoneyCents, comparePayrollMoney, payrollFinancePreviewSchema } from '../../src/features/dp/time-adjustments/payroll-finance';
const base={packageStatus:'not_sent',overdue:false,document:true,contact:true,review:'missing' as const};
test('progress separates document, review, difference, stale source and readiness',()=>{
 assert.equal(closingPhase({...base,document:false}),'awaiting_payslip');
 assert.equal(closingPhase(base),'awaiting_review');
 assert.equal(closingPhase({...base,review:'divergent'}),'divergent');
 assert.equal(closingPhase({...base,review:'stale'}),'stale');
 assert.equal(closingPhase({...base,review:'match'}),'ready');
 assert.equal(closingPhase({...base,review:'match',contact:false}),'missing_contact');
 assert.equal(closingPhase({...base,identity:false}),'identity_pending');
});
test('signature facts retain priority over later review metadata and distinguish overdue/refusal/failure',()=>{
 for(const [status,phase] of [['signed','signed'],['sent','awaiting_signature'],['sending','sending'],['refused','refused']] as const)assert.equal(closingPhase({...base,packageStatus:status,review:'stale'}),phase);
 assert.equal(closingPhase({...base,packageStatus:'sent',overdue:true}),'overdue');
 assert.equal(closingPhase({...base,packageStatus:'failed',review:'match'}),'send_failed');
 assert.equal(closingPhase({...base,review:'restricted'}),'restricted');
});
test('money source values cannot coerce missing data or fractions of a cent to zero',()=>{
 assert.equal(strictMoneyCents(1234.56),123456);assert.equal(strictMoneyCents(0),0);
 for(const input of [null,undefined,'100',false,NaN,Infinity,-1,1.001])assert.throws(()=>strictMoneyCents(input));
});
test('salary compares document net with payable and preserves the nominal value separately',()=>{
 const result=comparePayrollMoney({mode:'salary',documentCents:95000,payableCents:95000,nominalCents:100000});
 assert.equal(result.status,'match');assert.equal(result.titleCents,95000);assert.equal(result.nominalCents,100000);
 assert.equal(comparePayrollMoney({mode:'salary',documentCents:100000,payableCents:95000,nominalCents:100000}).status,'divergent');
});
test('guide must match the independent PDF total, nominal title, individuals and accounts',()=>{
 assert.equal(comparePayrollMoney({mode:'guide',documentCents:10000,payableCents:9000,nominalCents:10000,allocationCents:10000,allocationsValid:true}).status,'match');
 for(const patch of [{documentCents:11000},{allocationCents:9000},{allocationsValid:false}])assert.equal(comparePayrollMoney({mode:'guide',documentCents:10000,payableCents:10000,nominalCents:10000,allocationCents:10000,allocationsValid:true,...patch}).status,'divergent');
 assert.throws(()=>comparePayrollMoney({mode:'salary',documentCents:0.5,payableCents:1,nominalCents:1}));
});
test('financial transcription requires explicit amount, acknowledgment and correct document scope',()=>{
 const input={mode:'salary',competence:'2026-02',employeeUid:'person',expenseId:'salary',amountCents:0,acknowledgment:true};
 assert.equal(payrollFinancePreviewSchema.safeParse(input).success,true);
 for(const patch of [{amountCents:null},{amountCents:undefined},{acknowledgment:false},{mode:'guide'},{unexpected:true}])assert.equal(payrollFinancePreviewSchema.safeParse({...input,...patch}).success,false);
});


test('guide identity transcription is bound to the selected attachment rather than a message-level amount',()=>{
 const input={mode:'guide',competence:'2026-02',employeeUid:'person',expenseId:'guide',amountCents:10000,acknowledgment:true,document:{messageId:'message',attachmentId:'pdf',sha256:'a'.repeat(64),documentKind:'fgts',documentNumber:'FGTS-123',taxpayerCnpj:'11222333000181',competence:'2026-02'}};
 assert.equal(payrollFinancePreviewSchema.safeParse(input).success,true);
 for(const patch of [{documentKind:'receipt'},{documentNumber:''},{taxpayerCnpj:null},{competence:undefined}])assert.equal(payrollFinancePreviewSchema.safeParse({...input,document:{...input.document,...patch}}).success,false);
});
