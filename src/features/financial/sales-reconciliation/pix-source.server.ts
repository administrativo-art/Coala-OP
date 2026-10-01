import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { stonePixFileId } from "@/lib/integrations/stone/pix-conciliation";
import { reviewPixSnapshot, type PixSourceResult } from "./pix-source";
import type { DailySalesScope } from "./daily-review";
import { STONE_PIX_FILE_COLLECTION, STONE_PIX_REQUEST_COLLECTION } from "@/lib/integrations/stone/pix-storage-contract";

const unavailable = (status: PixSourceResult["status"], fileId: string | null): PixSourceResult => ({
  status, coverage: null, facts: [], excludedCount: 0, fileId,
});

export async function readPixSalesSource(scope: DailySalesScope): Promise<PixSourceResult> {
  const document = process.env.STONE_CONCILIATION_DOCUMENT?.replace(/\D/g, "") ?? "";
  if (!/^(?:\d{11}|\d{14})$/.test(document)) return unavailable("not_configured", null);
  const fileId = stonePixFileId(document, scope.referenceDate);
  const ref = financialDbAdmin.collection(STONE_PIX_FILE_COLLECTION).doc(fileId);
  const requestRef = financialDbAdmin.collection(STONE_PIX_REQUEST_COLLECTION).doc(fileId);
  // Read-only transaction provides a common snapshot across metadata and rows.
  return financialDbAdmin.runTransaction(async transaction => {
    const [head, request] = await Promise.all([transaction.get(ref), transaction.get(requestRef)]);
    if (!head.exists) {
      const requestStatus = request.get("status");
      return unavailable(["requesting", "requested"].includes(requestStatus) ? "requested"
        : requestStatus === "failed" ? "failed" : "unavailable", fileId);
    }
    const data = head.data();
    if (data?.workspaceId !== scope.workspaceId) return unavailable("pending", fileId);
    if (data.status === "failed") return unavailable("failed", fileId);
    if (data.status !== "processed"
      || !Number.isInteger(data.summary?.transactionCount) || data.summary.transactionCount > 500) {
      return unavailable("pending", fileId);
    }
    const rows = await transaction.get(ref.collection("transactions").limit(501));
    return reviewPixSnapshot({ head: data, rows: rows.docs.map(row => row.data()), document, fileId, scope });
  }, { readOnly: true });
}
