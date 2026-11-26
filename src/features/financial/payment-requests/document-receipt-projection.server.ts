import "server-only";
import type { Firestore } from "firebase-admin/firestore";
/** Bank reconciliation records the payment without recreating or reviving its document source. */
export async function projectDocumentReceiptPaid(db: Firestore, input: { documentId: string; requestId: string; paidAt: string | null | undefined; pdfHash?: string | null }) {
  const ref = db.collection("generatedDocuments").doc(input.documentId);
  return db.runTransaction(async (tx) => {
    const source = await tx.get(ref);
    if (!source.exists || source.get("deletedAt") || source.get("status") === "discarded" || source.get("archiveStatus") === "disposed" || input.pdfHash && source.get("pdfContentHash") !== input.pdfHash) return false;
    tx.update(ref, { receiptPaymentStatus: "paid", receiptPaymentRequestId: input.requestId, receiptPaidAt: input.paidAt ?? null });
    return true;
  });
}
