import "server-only";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { MAX_AGENT_MAPPINGS, resolveFinancialAgentMapping, validateFinancialAgentReferences } from "../agent/mapping";
import { periodDates, type ReceivablePeriod } from "./period-review";

/** One bounded lookup; every civil date must resolve to the same official mapping. */
export async function readReceivablePeriodMapping(period: ReceivablePeriod, workspaceId: string) {
  const snapshot = await financialDbAdmin.collection("stoneMerchantMappings")
    .where("workspaceId", "==", workspaceId).where("stoneCodes", "array-contains", period.stoneCode)
    .limit(MAX_AGENT_MAPPINGS + 1).get();
  const documents = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
  const mappings = periodDates(period).map(referenceDate => resolveFinancialAgentMapping(documents, {
    intent: "review_anticipations", kioskId: period.kioskId, stoneCode: period.stoneCode,
    referenceDate, prioritizeWithAi: false,
  }, workspaceId));
  const mapping = mappings[0];
  // Resolve the first mapping at the last day too; a reassignment cannot cross this range.
  resolveFinancialAgentMapping([mapping], { intent: "review_anticipations", kioskId: period.kioskId,
    stoneCode: period.stoneCode, referenceDate: period.through, prioritizeWithAi: false }, workspaceId);
  const [unit, account] = await Promise.all([
    dbAdmin.collection("kiosks").doc(mapping.kioskId).get(),
    financialDbAdmin.collection("bankAccounts").doc(mapping.accountId).get(),
  ]);
  validateFinancialAgentReferences(unit.data(), account.data(), workspaceId);
  return mapping;
}
