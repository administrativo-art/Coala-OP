import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import {
  evaluatePixRefundCheck, pixRefundDates, pixRefundKey, pixRefundMonthId, updatePixRefundMonth,
  type PixRefundDay, type PixRefundMonth,
} from "@/lib/integrations/stone/pix-refunds";
import type { DailySalesScope } from "./daily-review";

function monthRef(workspaceId: string, merchantDocument: string, month: string) {
  return financialDbAdmin.collection("stonePixRefundMonths").doc(pixRefundMonthId(workspaceId, merchantDocument, month));
}

export async function writePixRefundProjection(
  tx: FirebaseFirestore.Transaction,
  scope: { workspaceId: string; document: string; referenceDate: string },
  day?: PixRefundDay,
) {
  const ref = monthRef(scope.workspaceId, scope.document, scope.referenceDate.slice(0, 7));
  const current = await tx.get(ref);
  if (!current.exists && !day) return;
  const next = updatePixRefundMonth(current.data() as PixRefundMonth | undefined, scope.referenceDate, day);
  tx.set(ref, next);
}

export async function readPixRefundChecks(input: {
  scope: DailySalesScope;
  through: string;
  e2eIds: readonly string[];
  saleSourceHash: string | null;
}) {
  const doc = process.env.STONE_CONCILIATION_DOCUMENT?.replace(/\D/g, "") ?? "";
  const dates = pixRefundDates(input.scope.referenceDate, input.through);
  const months = new Map<string, PixRefundMonth>();
  if (dates && /^(?:\d{11}|\d{14})$/.test(doc) && input.e2eIds.length > 0) {
    const keys = [...new Set(dates.map(date => date.slice(0, 7)))];
    const refs = keys.map(month => monthRef(input.scope.workspaceId, doc, month));
    const snapshots = await financialDbAdmin.runTransaction(tx => tx.getAll(...refs, {
      fieldMask: ["days", ...input.e2eIds.map(id => "events." + pixRefundKey(id))],
    }), { readOnly: true });
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists) months.set(keys[index], snapshot.data() as PixRefundMonth);
    });
  }
  return new Map(input.e2eIds.map(e2eId => [e2eId, evaluatePixRefundCheck({
    dates, months, e2eId, stoneCode: input.scope.stoneCode, through: input.through,
    saleSourceHash: input.saleSourceHash,
  })]));
}
