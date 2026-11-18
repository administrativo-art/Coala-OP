import type { ReceiptParcel } from "./stone-account";
import { summarizeReceiptGroups } from "./stone-account";
import type { StoneAccountMonthResult } from "./reconciliation.server";
export const PAYMENT_PAGE_DAYS=45;
export type PaymentCoverage={from:string;asOf:string;scannedFrom:string;scannedThrough:string;nextCursor:string|null;missingDates:string[];cohortFingerprint:string;complete:boolean;baseComplete:boolean;fileCount:number};
export const receiptNextDay=(date:string,days=1)=>new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
export function receiptPaymentWindow(from:string,asOf:string){return{from,through:[receiptNextDay(from,PAYMENT_PAGE_DAYS-1),asOf].sort()[0]};}
/** An unresolved due parcel is conclusive only after a contiguous complete read, never just because the limit ended. */
export function classifyPaymentCoverage(parcels:ReceiptParcel[],coverage:PaymentCoverage,cohortFrom:string,cohortThrough:string){
 return parcels.map(p=>{
  if(p.source==="card"&&!p.saleDate&&!p.paidDate)return {...p,status:"review" as const,paymentCoveragePending:false};
  if(p.source!=="card"||!p.saleDate||p.saleDate>cohortThrough||p.paidDate||p.paymentConflict||["chargeback","missing_file"].includes(p.status))return p;
  if(p.expectedDate&&p.expectedDate>coverage.asOf)return{...p,status:"to_receive" as const};
  if(["unpaid","to_receive"].includes(p.status)||p.paymentCoveragePending)return{...p,status:coverage.complete?"unpaid" as const:"review" as const,paymentCoveragePending:!coverage.complete};
  return p;
 });
}
/** Only join the exact next page of the same immutable cohort/context. Throws instead of mixing periods or skipped ranges. */
export function mergeReceiptPaymentPage(previous:StoneAccountMonthResult,next:StoneAccountMonthResult):StoneAccountMonthResult{
 const a=previous.coverage.payments,b=next.coverage.payments;
 if(!a||!b||JSON.stringify(previous.scope)!==JSON.stringify(next.scope)||previous.period.from!==next.period.from||previous.period.through!==next.period.through||a.asOf!==b.asOf||a.cohortFingerprint!==b.cohortFingerprint||a.nextCursor!==b.scannedFrom)throw new Error("A competência, vínculo ou fonte mudou. Reinicie a conferência.");
 const byId=new Map(previous.parcels.map(p=>[p.id,p]));
 for(const p of next.parcels){const old=byId.get(p.id);if(old?.paymentConflict){byId.set(p.id,{...old,paymentEvidenceDates:[...new Set([...(old.paymentEvidenceDates??[]),...(p.paymentEvidenceDates??[])])].slice(0,13),status:"review",paymentConflict:true,paymentCoveragePending:false});continue;}if(old?.paidDate&&!p.paidDate){if(p.status==="review"&&!p.paymentCoveragePending)byId.set(p.id,{...old,paymentConflict:p.paymentConflict??old.paymentConflict,paymentEvidenceDates:[...new Set([...(old.paymentEvidenceDates??[]),...(p.paymentEvidenceDates??[])])].slice(0,13),status:"review",paymentCoveragePending:false});continue;}if(old?.paidDate&&p.paidDate&&(old.paidDate!==p.paidDate||old.paidNetCents!==p.paidNetCents)){byId.set(p.id,{...old,paymentEvidenceDates:[...new Set([...(old.paymentEvidenceDates??[]),...(p.paymentEvidenceDates??[])])].slice(0,13),status:"review",paymentConflict:true});continue;}byId.set(p.id,p);}
 const missingDates=[...new Set([...a.missingDates,...b.missingDates])].sort();
 const coverage={...b,from:a.from,scannedFrom:a.scannedFrom,missingDates,fileCount:a.fileCount+b.fileCount,complete:b.nextCursor===null&&missingDates.length===0&&a.baseComplete&&b.baseComplete};
 const parcels=classifyPaymentCoverage([...byId.values()],coverage,previous.period.from,previous.period.through);
 // The server marks partial unresolved rows review. Upgrade only the exact unpaid candidates whose sole reason was follow-up coverage.
 const settled=parcels.map(p=>p.source==="card"&&!p.paidDate&&p.status==="review"&&p.expectedDate&&p.expectedDate<=coverage.asOf&&coverage.complete&&p.paymentCoveragePending?{...p,status:"unpaid" as const,paymentCoveragePending:false}:p);
 return{...next,parcels:settled,coverage:{...next.coverage,payments:coverage},groups:summarizeReceiptGroups(settled,next.period.from,next.period.through,b.asOf)};
}
