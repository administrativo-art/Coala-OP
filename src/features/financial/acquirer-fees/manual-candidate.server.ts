import "server-only";
import { FieldPath } from "firebase-admin/firestore";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
export const FEE_MANUAL_SCAN_PAGE_SIZE = 25;
export const FEE_MANUAL_SCAN_MAX_DOCUMENTS = 250;
/** Equality narrows the search, not identity. Missing legacy source/workspace fields remain eligible. */
export async function assertNoManualFeeCandidate(tx: FirebaseFirestore.Transaction, input: {
  workspaceId: string; month: string; resultCenterId: string; amountCents: number;
}) {
  const query = db.collection("expenses").where("competenceMonth", "==", input.month)
    .where("resultCenterId", "==", input.resultCenterId).where("totalValue", "==", input.amountCents / 100)
    .orderBy(FieldPath.documentId()).select("workspaceId", "status", "sourceSettlement");
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (let scanned = 0; scanned < FEE_MANUAL_SCAN_MAX_DOCUMENTS; scanned += FEE_MANUAL_SCAN_PAGE_SIZE) {
    const pageQuery = cursor ? query.startAfter(cursor) : query;
    const page = await tx.get(pageQuery.limit(FEE_MANUAL_SCAN_PAGE_SIZE));
    if (page.docs.some(d => (d.get("workspaceId") ?? WORKSPACE_ID) === input.workspaceId
      && d.get("status") !== "cancelled" && !d.get("sourceSettlement"))) {
      throw new AppError({ code: "FEE_RECOGNITION_MANUAL_CANDIDATE", kind: "CONFLICT",
        safeMessage: "Há despesa manual do mesmo valor, competência e centro. Revise e vincule a origem antes de criar outra." });
    }
    if (page.size < FEE_MANUAL_SCAN_PAGE_SIZE) return;
    cursor = page.docs.at(-1)!;
  }
  // One bounded look-ahead distinguishes exactly250 examined from an unexamined page. Never declare the unseen row manual or safe.
  if (!(await tx.get(query.startAfter(cursor!).limit(1))).empty) {
    throw new AppError({ code: "FEE_RECOGNITION_MANUAL_SCAN_LIMIT", kind: "CONFLICT",
      safeMessage: "A verificação de despesas equivalentes atingiu250 registros e não confirmou a cobertura. Revise o recorte antes de reconhecer; nenhuma candidata manual foi presumida." });
  }
}
