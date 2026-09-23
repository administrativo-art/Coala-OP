import "server-only";
import { dbAdmin } from "@/lib/firebase-admin";
import { readFinancialAgentMapping } from "../agent/mapping.server";
import { requireStoredPdvFilial, type SalesReviewRequest } from "./query";

export async function readSalesReviewBinding(request: SalesReviewRequest, workspaceId: string) {
  const mapping = await readFinancialAgentMapping({ ...request, intent: "review_anticipations", prioritizeWithAi: false }, workspaceId);
  // Exact document read, not a unit collection scan. Never use the legacy filial fallback.
  const kiosk = await dbAdmin.collection("kiosks").doc(mapping.kioskId).get();
  return { mapping, pdvFilialId: requireStoredPdvFilial(kiosk.data(), workspaceId) };
}
