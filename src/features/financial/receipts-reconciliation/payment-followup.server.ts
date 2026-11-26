import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "@/lib/observability/app-error";
import { applyReceiptPaymentFiles, receiptPeriodDates, summarizeReceiptGroups, type ReceiptParcel } from "./stone-account";
import { receiptNextDay,receiptPaymentWindow,classifyPaymentCoverage,type PaymentCoverage } from "./payment-followup";
import { readPersistedPaymentPage,PAYMENT_PAGE_FILES } from "./payment-cache.server";
type Base={scope:{workspaceId:string;mappingId:string;kioskId:string;stoneCode:string};period:{from:string;through:string};parcels:ReceiptParcel[];groups:ReturnType<typeof summarizeReceiptGroups>;coverage:{stone:"complete"|"partial";payments?:PaymentCoverage};limitations:string[]};
export type PaymentRequest={paymentCursor?:string;paymentAsOf?:string;paymentCohort?:string};
export async function appendPersistedPayments<T extends Base>(base:T,request:PaymentRequest,latest:string,readPage=readPersistedPaymentPage){
 const asOf=request.paymentAsOf??latest,from=receiptNextDay(base.period.through);
 const cohort=base.parcels.filter(p=>p.source==="card"&&p.saleDate&&p.saleDate<=base.period.through);
 const fingerprint=createHash("sha256").update(JSON.stringify({scope:base.scope,period:base.period,cohort})).digest("hex");
 if(asOf>latest||asOf<base.period.through||request.paymentCursor&&(!request.paymentAsOf||!request.paymentCohort)||request.paymentCohort&&request.paymentCohort!==fingerprint)throw new AppError({code:"STONE_RECEIPT_PAYMENT_CONTEXT",kind:"CONFLICT",safeMessage:"A competência, vínculo ou fonte mudou. Reinicie a conferência."});
 const start=request.paymentCursor??from;
 if(request.paymentCursor&&(start<from||start>asOf))throw new AppError({code:"STONE_RECEIPT_PAYMENT_CURSOR",kind:"VALIDATION"});
 const window=receiptPaymentWindow(start,asOf);
 const files=start<=asOf&&cohort.length?await readPage({workspaceId:base.scope.workspaceId,stoneCode:base.scope.stoneCode},start,window.through):[];
 if(files.length>PAYMENT_PAGE_FILES||files.some(f=>f.stoneCode!==base.scope.stoneCode||f.referenceDate<start||f.referenceDate>window.through)||new Set(files.map(f=>f.referenceDate)).size!==files.length)throw new AppError({code:"STONE_RECEIPT_PAYMENT_PAGE",kind:"DATA_INTEGRITY"});
 const ordered=[...files].sort((a,b)=>a.referenceDate.localeCompare(b.referenceDate));
 const scannedThrough=start>asOf||!cohort.length?asOf:files.length===PAYMENT_PAGE_FILES?ordered.at(-1)!.referenceDate:window.through;
 const dates=start<=scannedThrough&&cohort.length?receiptPeriodDates(start,scannedThrough):[];
 const known=new Set(files.map(f=>f.referenceDate));const missingDates=dates.filter(d=>!known.has(d));
 const nextCursor=scannedThrough<asOf&&cohort.length?receiptNextDay(scannedThrough):null;
 const coverage:PaymentCoverage={from,asOf,scannedFrom:start,scannedThrough,nextCursor,missingDates,cohortFingerprint:fingerprint,baseComplete:base.coverage.stone==="complete",fileCount:files.length,complete:start===from&&nextCursor===null&&missingDates.length===0&&base.coverage.stone==="complete"};
 const built=applyReceiptPaymentFiles(base.parcels,ordered,base.period.from,base.period.through,asOf);
 const parcels=classifyPaymentCoverage(built.parcels,coverage,base.period.from,base.period.through);
 return{...base,latestPublished:asOf,parcels,groups:summarizeReceiptGroups(parcels,base.period.from,base.period.through,asOf),coverage:{...base.coverage,payments:coverage},limitations:[...base.limitations,"Pagamentos posteriores ao mês: somente arquivos já armazenados; pago pela Stone não comprova crédito bancário.",...(coverage.complete?[]:["A consulta de pagamentos posteriores ainda é parcial. Continue a leitura ou confira os arquivos faltantes; ausência de pagamento não é conclusiva."]),...(built.conflicts?["Há eventos de pagamento/cancelamento conflitantes; conferir a origem."]:[])]};
}
