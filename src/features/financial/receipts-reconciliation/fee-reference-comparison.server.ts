import "server-only";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { financialAgentMappingSchema } from "../agent/contracts";
import { readReceivablePeriodMapping } from "../receivables/mapping.server";
import { readConfirmedRateReferences } from "./confirmed-rate-reference.server";
import { referenceOnDate } from "./confirmed-rate-reference";
/** Explicit user-requested page: <=101 mapping docs and2 scoped readers; no snapshots/provider/polling. */
export async function compareConfirmedRates(workspaceId: string, date: string, offset = 0) {
  const mappings=await db.collection("stoneMerchantMappings").where("workspaceId","==",workspaceId).limit(101).get();
  if(mappings.size>100) throw new AppError({code:"STONE_FEE_COMPARISON_LIMIT",kind:"CONFLICT"});
  type ScopeRow={mappingId:string;kioskId:string|null;stoneCode:string|null;unit:string;account:string;validFrom:string|null;validTo:string|null;invalid:boolean};
  const scopes:ScopeRow[]=mappings.docs.flatMap((d):ScopeRow[]=>{
    const parsed=financialAgentMappingSchema.safeParse({...d.data(),id:d.id});
    if(!parsed.success) return [{mappingId:d.id,kioskId:null,stoneCode:null,unit:"Vínculo cadastrado incompleto",account:"Indisponível",validFrom:null,validTo:null,invalid:true}];
    const m=parsed.data;return m.stoneCodes.map(stoneCode=>({mappingId:m.id,kioskId:m.kioskId,stoneCode,unit:String(d.get("kioskName")||m.kioskId),account:String(d.get("accountName")||m.accountId),validFrom:m.validFrom,validTo:m.validTo??null,invalid:false}));
  }).sort((a,b)=>a.mappingId.localeCompare(b.mappingId)||String(a.stoneCode).localeCompare(String(b.stoneCode)));
  const rows=await Promise.all(scopes.slice(offset,offset+2).map(async scope=>{
    if(scope.invalid || !scope.kioskId || !scope.stoneCode) return {...scope,status:"unavailable" as const,references:[],history:[],unresolved:0};
    try {const mapping=await readReceivablePeriodMapping({kioskId:scope.kioskId,stoneCode:scope.stoneCode,from:date,through:date},workspaceId);if(mapping.id!==scope.mappingId) return {...scope,status:"outside_period" as const,references:[],history:[],unresolved:0};
      const source=await readConfirmedRateReferences({workspaceId,mappingId:scope.mappingId,kioskId:scope.kioskId,stoneCode:scope.stoneCode});
      const references=[...new Set(source.references.map(r=>r.groupKey))].flatMap(key=>{const r=referenceOnDate(source.references,key,date);return r?[r]:[];});
      return {...scope,status:"available" as const,references,history:source.references,unresolved:source.unresolved};
    } catch { return {...scope,status:"unavailable" as const,references:[],history:[],unresolved:0}; }
  }));
  return {date,rows,nextOffset:offset+2<scopes.length?offset+2:null,totalScopes:scopes.length,invalidMappingCount:scopes.filter(s=>s.invalid).length};
}
export type FeeReferenceComparison=Awaited<ReturnType<typeof compareConfirmedRates>>;
