import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { stonePixFileId } from "@/lib/integrations/stone/pix-conciliation";
import { reviewPixSnapshot, type PixSourceResult } from "./pix-source";
import type { DailySalesScope } from "./daily-review";

export async function readPixSalesSource(scope: DailySalesScope): Promise<PixSourceResult> {
  const document = process.env.STONE_CONCILIATION_DOCUMENT?.replace(/\D/g, "") ?? "";
  if (!/^(?:\d{11}|\d{14})$/.test(document)) return { status: "not_configured", facts: [], excludedCount: 0, fileId: null };
  const fileId = stonePixFileId(document, scope.referenceDate);
  const ref = financialDbAdmin.collection("stonePixConciliationFiles").doc(fileId);
  // Read-only transaction provides a common snapshot across metadata and rows.
  return financialDbAdmin.runTransaction(async transaction => {
    const head = await transaction.get(ref);
    if (!head.exists) return { status: "unavailable", facts: [], excludedCount: 0, fileId };
    const data = head.data();
    if (data?.workspaceId !== scope.workspaceId || data.status !== "processed"
      || !Number.isInteger(data.summary?.transactionCount) || data.summary.transactionCount > 500) {
      return { status: "pending", facts: [], excludedCount: 0, fileId };
    }
    const rows = await transaction.get(ref.collection("transactions").limit(501));
    return reviewPixSnapshot({ head: data, rows: rows.docs.map(row => row.data()), document, fileId, scope });
  }, { readOnly: true });
}
