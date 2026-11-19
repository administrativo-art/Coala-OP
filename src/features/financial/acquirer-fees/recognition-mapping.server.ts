import "server-only";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { MAX_AGENT_MAPPINGS, resolveFinancialAgentMapping, validateFinancialAgentReferences } from "../agent/mapping";
import type { FeeRequest } from "./contracts";
import { assertFeeAdmin, type FeeContext } from "./source.server";
/** Same bounded resolution/references as the shared reader; financial reads join the write transaction. */
export async function recognitionMapping(request: FeeRequest, context: FeeContext, tx?: FirebaseFirestore.Transaction) {
  assertFeeAdmin(context);
  const query = db.collection("stoneMerchantMappings").where("workspaceId", "==", context.workspace_id).where("stoneCodes", "array-contains", request.stoneCode).limit(MAX_AGENT_MAPPINGS + 1);
  const matches = tx ? await tx.get(query) : await query.get();
  const mapping = resolveFinancialAgentMapping(matches.docs.map(d => ({ ...d.data(), id: d.id })), { ...request, intent: "review_anticipations", prioritizeWithAi: false }, context.workspace_id);
  if (mapping.id !== request.mappingId) throw new AppError({ code: "ACQUIRER_FEE_MAPPING_CHANGED", kind: "CONFLICT" });
  const accountRef = db.collection("bankAccounts").doc(mapping.accountId);
  // Main and financial are separate databases. Recheck Main on every transaction attempt; no cross-database atomicity is claimed.
  const [kiosk, account] = await Promise.all([dbAdmin.collection("kiosks").doc(mapping.kioskId).get(), tx ? tx.get(accountRef) : accountRef.get()]);
  validateFinancialAgentReferences(kiosk.data(), account.data(), context.workspace_id);
  return { mapping, document: matches.docs.find(d => d.id === mapping.id)! };
}

/** Month-level controls can open a month in which the mapping started after day 1. */
export async function recognitionMappingForMonth(request: FeeRequest, context: FeeContext, tx?: FirebaseFirestore.Transaction) {
  assertFeeAdmin(context);
  const ref = db.collection("stoneMerchantMappings").doc(request.mappingId);
  const document = tx ? await tx.get(ref) : await ref.get();
  const validFrom = document.get("validFrom");
  if (document.get("workspaceId") !== context.workspace_id || typeof validFrom !== "string") {
    throw new AppError({ code: "ACQUIRER_FEE_MAPPING_CHANGED", kind: "CONFLICT" });
  }
  const referenceDate = request.referenceDate < validFrom ? validFrom : request.referenceDate;
  if (referenceDate.slice(0, 7) !== request.referenceDate.slice(0, 7)) {
    throw new AppError({ code: "ACQUIRER_FEE_MAPPING_CHANGED", kind: "CONFLICT" });
  }
  return recognitionMapping({ ...request, referenceDate }, context, tx);
}
