import "server-only";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import type { FinancialAgentRequest } from "./contracts";
import { MAX_AGENT_MAPPINGS, resolveFinancialAgentMapping, validateFinancialAgentReferences } from "./mapping";

export async function readFinancialAgentMapping(request: FinancialAgentRequest, workspaceId: string) {
  // Bounded lookup, once per explicit request. Historical mappings are necessary for date resolution.
  const snapshot = await financialDbAdmin.collection("stoneMerchantMappings")
    .where("workspaceId", "==", workspaceId)
    .where("stoneCodes", "array-contains", request.stoneCode)
    .limit(MAX_AGENT_MAPPINGS + 1).get();
  const mapping = resolveFinancialAgentMapping(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })), request, workspaceId);
  const [kiosk, account] = await Promise.all([
    dbAdmin.collection("kiosks").doc(mapping.kioskId).get(),
    financialDbAdmin.collection("bankAccounts").doc(mapping.accountId).get(),
  ]);
  validateFinancialAgentReferences(kiosk.data(), account.data(), workspaceId);
  return mapping;
}
