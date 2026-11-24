import "server-only";
import { createHash } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { WORKSPACE_ID } from "@/lib/workspace";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
export const PAYMENT_PAGE_FILES=16;
export type PersistedPaymentScope={workspaceId:string;stoneCode:string};
const prefix=(scope:PersistedPaymentScope)=>createHash("sha256").update(`${scope.workspaceId}:${scope.stoneCode}`).digest("hex");
function parseStored(doc:FirebaseFirestore.DocumentSnapshot,scope:PersistedPaymentScope,date:string){
 const xml=doc.get("xml");
 if(scope.workspaceId!==WORKSPACE_ID||doc.get("workspaceId")!==scope.workspaceId||doc.get("stoneCode")!==scope.stoneCode||doc.get("referenceDate")!==date||typeof xml!=="string"||Buffer.byteLength(xml)>800000||doc.get("sourceHash")!==createHash("sha256").update(xml).digest("hex"))throw new AppError({code:"STONE_RECEIPT_CACHE_INVALID",kind:"DATA_INTEGRITY",safeMessage:"Arquivo persistido fora do escopo ou inválido; pagamentos não foram presumidos."});
 const file=parseStoneAgendaXml(xml,{stoneCode:scope.stoneCode,referenceDate:date});
 if(file.referenceDate!==date||file.stoneCode.replace(/^0+(?=\d)/,"")!==scope.stoneCode.replace(/^0+(?=\d)/,""))throw new AppError({code:"STONE_RECEIPT_CACHE_SCOPE",kind:"DATA_INTEGRITY"});
 return {...file,referenceDate:date,stoneCode:scope.stoneCode};
}
/** GET only; never fall back to the provider or create cached records. */
export async function readPersistedReceiptDay(scope:PersistedPaymentScope,date:string){
 if(scope.workspaceId!==WORKSPACE_ID)throw new AppError({code:"STONE_RECEIPT_CACHE_SCOPE",kind:"AUTHORIZATION"});
 const doc=await db.collection("stonePortfolioFiles").doc(`${prefix(scope)}_${date}`).get();
 return doc.exists?parseStored(doc,scope,date):null;
}
/** Bounded ID range avoids collection scans and per-calendar-day missing-document reads. */
export async function readPersistedPaymentPage(scope:PersistedPaymentScope,from:string,through:string){
 if(scope.workspaceId!==WORKSPACE_ID||from>through)throw new AppError({code:"STONE_RECEIPT_CACHE_SCOPE",kind:"VALIDATION"});
 const key=prefix(scope);
 const snapshot=await db.collection("stonePortfolioFiles").orderBy(FieldPath.documentId()).startAt(`${key}_${from}`).endAt(`${key}_${through}`).limit(PAYMENT_PAGE_FILES).get();
 return snapshot.docs.map(doc=>{const date=doc.get("referenceDate");if(typeof date!=="string"||date<from||date>through||doc.id!==`${key}_${date}`)throw new AppError({code:"STONE_RECEIPT_CACHE_SCOPE",kind:"DATA_INTEGRITY"});return parseStored(doc,scope,date);});
}
