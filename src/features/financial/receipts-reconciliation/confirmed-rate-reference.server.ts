import { feeHash } from "../acquirer-fees/evidence";
import "server-only";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { MAX_AGENT_MAPPINGS, resolveFinancialAgentMapping } from "../agent/mapping";
import { confirmedRateReferences, type RateScope, type RateDecisionRecord } from "./confirmed-rate-reference";
/** Max 1,502 decision/event documents +101 mappings, only one authorized merchant/workspace. No provider query. */
export async function readConfirmedRateReferences(scope: RateScope, tx?: FirebaseFirestore.Transaction) {
  const read = (q: FirebaseFirestore.Query) => tx ? tx.get(q) : q.get();
  const [decisions, events, mappings] = await Promise.all([
    read(db.collection("stoneReceiptDecisions").where("workspaceId","==",scope.workspaceId).where("stoneCode","==",scope.stoneCode).limit(501)),
    read(db.collection("stoneReceiptDecisionEvents").where("workspaceId","==",scope.workspaceId).where("stoneCode","==",scope.stoneCode).limit(1001)),
    read(db.collection("stoneMerchantMappings").where("workspaceId","==",scope.workspaceId).where("stoneCodes","array-contains",scope.stoneCode).limit(MAX_AGENT_MAPPINGS+1)),
  ]);
  if (decisions.size>500 || events.size>1000 || mappings.size>MAX_AGENT_MAPPINGS) throw new AppError({code:"STONE_RATE_REFERENCE_LIMIT",kind:"CONFLICT",safeMessage:"Histórico acima do limite seguro. As taxas não foram presumidas nem aplicadas."});
  const documents = mappings.docs.map(d=>({...d.data(),id:d.id}));
  const records: RateDecisionRecord[] = [...events.docs,...decisions.docs].map(d=>({...d.data(),id:d.id}));
  const source = confirmedRateReferences(records, scope, record=>{
    if (typeof record.since!=="string") return false;
    try { return resolveFinancialAgentMapping(documents,{intent:"review_anticipations",kioskId:scope.kioskId,stoneCode:scope.stoneCode,referenceDate:record.since,prioritizeWithAi:false},scope.workspaceId).id===scope.mappingId; } catch { return false; }
  });
  const scopeFingerprint=feeHash(documents);
  return {...source,scopeFingerprint,references:source.references.map(r=>({...r,fingerprint:feeHash([r.fingerprint,scopeFingerprint])}))};
}

/** Re-resolve effective-date ownership inside the same financial transaction as confirmation. */
export async function assertRateScopeAt(scope: RateScope,date: string,tx: FirebaseFirestore.Transaction) {
  const mappings=await tx.get(db.collection("stoneMerchantMappings").where("workspaceId","==",scope.workspaceId).where("stoneCodes","array-contains",scope.stoneCode).limit(MAX_AGENT_MAPPINGS+1));
  const mapping=resolveFinancialAgentMapping(mappings.docs.map(d=>({...d.data(),id:d.id})),{intent:"review_anticipations",kioskId:scope.kioskId,stoneCode:scope.stoneCode,referenceDate:date,prioritizeWithAi:false},scope.workspaceId);
  if(mapping.id!==scope.mappingId) throw new AppError({code:"STONE_FEE_EFFECTIVE_SCOPE",kind:"CONFLICT",safeMessage:"A data inicial não pertence mais a este vínculo."});
  const account=await tx.get(db.collection("bankAccounts").doc(mapping.accountId));
  if(account.get("workspaceId")!==scope.workspaceId) throw new AppError({code:"STONE_FEE_EFFECTIVE_SCOPE",kind:"CONFLICT",safeMessage:"Conta do vínculo fora do escopo autorizado."});
}
