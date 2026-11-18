import test from "node:test";import assert from "node:assert/strict";
import{buildStoneAccountParcels,applyReceiptPaymentFiles}from"../../src/features/financial/receipts-reconciliation/stone-account";
import{classifyPaymentCoverage,receiptPaymentWindow,receiptNextDay}from"../../src/features/financial/receipts-reconciliation/payment-followup";
import{receiptFile,octoberReceiptCases}from"../helpers/receipt-payment-fixtures";
test("11parcelas:7pagamentosNov8409centavos,2pagosOct,2futuros; idempotente e não inclui outra venda",()=>{
 const files=[...new Set(octoberReceiptCases.map(r=>r.soldOn))].map(d=>receiptFile(d,octoberReceiptCases.filter(r=>r.soldOn===d),octoberReceiptCases.filter(r=>r.id.startsWith("paid")&&r.due===d)).file);
 files.push(receiptFile("2026-10-07",[],[octoberReceiptCases[7]]).file);
 const base=buildStoneAccountParcels({from:"2026-10-01",through:"2026-10-31",latestPublished:"2026-11-17",files,missingDates:[],portfolio:null,pix:[]});
 const later=["2026-11-03","2026-11-04","2026-11-09"].map(d=>receiptFile(d,[],[...octoberReceiptCases.slice(0,7).filter(r=>r.due===d),{id:"another-sale",net:100,due:d}]).file);
 const paid=applyReceiptPaymentFiles(base.parcels,later,"2026-10-01","2026-10-31","2026-11-17");
 assert.equal(paid.parcels.length,11);assert.equal(paid.parcels.filter(p=>p.paidDate?.startsWith("2026-11")).length,7);assert.equal(paid.parcels.filter(p=>p.paidDate?.startsWith("2026-11")).reduce((s,p)=>s+(p.paidNetCents??0),0),8409);assert.equal(paid.parcels.filter(p=>p.status==="to_receive").length,2);assert.deepEqual(applyReceiptPaymentFiles(paid.parcels,later,"2026-10-01","2026-10-31","2026-11-17").parcels,paid.parcels);
});
test("múltiplas competências e viradaano cruzam identidade/parcela, antecipação e datas respeitam asOf",()=>{
 for(const[sold,due,paidOn]of[["2025-12-10","2026-01-09","2026-01-09"],["2026-01-01","2026-08-01","2026-07-15"],["2026-03-20","2026-04-20","2026-06-03"]]){
  const row={id:"same",soldOn:sold,net:1000,due,n:2,count:6};const base=buildStoneAccountParcels({from:sold.slice(0,7)+"-01",through:sold.slice(0,7)+"-31",latestPublished:paidOn,files:[receiptFile(sold,[row]).file],missingDates:[],portfolio:null,pix:[]}).parcels;
  const updated=applyReceiptPaymentFiles(base,[receiptFile(paidOn,[],[row]).file],sold.slice(0,7)+"-01",sold.slice(0,7)+"-31",paidOn);assert.equal(updated.parcels[0].paidDate,paidOn);assert.equal(updated.parcels[0].installment,2);
  assert.equal(applyReceiptPaymentFiles(base,[receiptFile(paidOn,[],[row]).file],sold.slice(0,7)+"-01",sold.slice(0,7)+"-31",receiptNextDay(paidOn,-1)).parcels[0].paidDate,null);
 }
});
test("limite/lacuna não declaraNãoPago; janela esparsa permanece limitada45dias",()=>{
 const p=buildStoneAccountParcels({from:"2026-10-01",through:"2026-10-31",latestPublished:"2026-11-17",files:[receiptFile("2026-10-01",[octoberReceiptCases[0]]).file],missingDates:[],portfolio:null,pix:[]}).parcels;
 const cov={from:"2026-11-01",asOf:"2026-11-17",scannedFrom:"2026-11-01",scannedThrough:"2026-11-16",nextCursor:"2026-11-17",missingDates:[],cohortFingerprint:"a".repeat(64),complete:false,baseComplete:true,fileCount:16};assert.equal(classifyPaymentCoverage(p,cov,"2026-10-01","2026-10-31")[0].status,"review");assert.equal(receiptPaymentWindow("2020-01-01","2026-11-17").through,"2020-02-14");
});
test("antecipação tem valor/dia efetivo, sem mudar competência; duplicidade conflitante ficaConferir",()=>{
 const sale={id:"advance",soldOn:"2026-10-20",net:1000,due:"2026-12-20"};
 const base=buildStoneAccountParcels({from:"2026-10-01",through:"2026-10-31",latestPublished:"2026-11-17",files:[receiptFile(sale.soldOn,[sale]).file],missingDates:[],portfolio:null,pix:[]}).parcels;
 const paid=applyReceiptPaymentFiles(base,[receiptFile("2026-11-01",[],[{...sale,net:900,gross:1050,advance:100}]).file],"2026-10-01","2026-10-31","2026-11-17").parcels[0];
 assert.equal(paid.status,"paid_early");assert.equal(paid.paidNetCents,900);assert.equal(paid.expectedNetCents,1000);assert.equal(paid.saleDate,"2026-10-20");assert.equal(paid.anticipationCents,100);
 const conflict=applyReceiptPaymentFiles([paid],[receiptFile("2026-11-02",[],[{...sale,net:900,gross:1050,advance:100}]).file],"2026-10-01","2026-10-31","2026-11-17").parcels[0];assert.equal(conflict.status,"review");
});
test("conflitos ficam pegajosos e parcelas anteriores participam da cobertura",()=>{
 const old={id:'prior',soldOn:'2026-09-20',net:1000,due:'2026-10-20'};
 const base=buildStoneAccountParcels({from:'2026-09-01',through:'2026-09-30',latestPublished:'2026-11-17',files:[receiptFile(old.soldOn,[old]).file],missingDates:[],portfolio:null,pix:[]}).parcels;
 const paid=applyReceiptPaymentFiles(base,[receiptFile('2026-11-04',[],[old]).file],'2026-10-01','2026-10-31','2026-11-17').parcels;
 assert.equal(paid[0].paidDate,'2026-11-04');
 const conflict=applyReceiptPaymentFiles(paid,[receiptFile('2026-11-09',[],[old]).file,receiptFile('2026-11-04',[],[old]).file],'2026-10-01','2026-10-31','2026-11-17').parcels;
 assert.equal(conflict[0].status,'review');assert.equal(conflict[0].paymentConflict,true);assert.deepEqual(conflict[0].paymentEvidenceDates,['2026-11-04','2026-11-09']);
 const adverse=receiptFile('2026-11-02',[],[old]).file;adverse.transactions[0].events.Cancellations=1;const adverseThenPaid=applyReceiptPaymentFiles(base,[adverse,receiptFile('2026-11-04',[],[old]).file],'2026-10-01','2026-10-31','2026-11-17').parcels[0];assert.equal(adverseThenPaid.status,'review');assert.equal(adverseThenPaid.paymentConflict,true);
 const coverage={from:'2026-11-01',asOf:'2026-11-17',scannedFrom:'2026-11-01',scannedThrough:'2026-11-16',nextCursor:'2026-11-17',missingDates:[],cohortFingerprint:'a'.repeat(64),complete:false,baseComplete:true,fileCount:16};
 assert.equal(classifyPaymentCoverage(base,coverage,'2026-10-01','2026-10-31')[0].status,'review');
});
