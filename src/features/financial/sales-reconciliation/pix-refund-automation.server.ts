import "server-only";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { pixRefundDates } from "@/lib/integrations/stone/pix-refunds";
import { readPixRefundChecks } from "./pix-refunds.server";
import { checkSalesPixRefunds } from "./pix-refund-review";
import type { DailySalesReviewIdentity } from "./review-state";
import { readDailySalesReviewSnapshot, salesRefundWatchDates, saveDailySalesReview } from "./review-state.server";

const MAX_REFUND_REVIEWS_PER_SCOPE_RUN = 2;
const RETRY_DELAY_MS = 2 * 60 * 60 * 1000;
const ACTOR_ID = "system:stone-pix-refund-check";

export async function refreshDuePixRefundReviews(
  scope: Omit<DailySalesReviewIdentity, "referenceDate">,
  through: string,
  now: Date,
  signal?: AbortSignal,
) {
  const watches = await salesRefundWatchDates(scope).where("nextCheckAt", "<=", now.toISOString())
    .orderBy("nextCheckAt").limit(MAX_REFUND_REVIEWS_PER_SCOPE_RUN).get();
  let checked = 0;
  let retry = 0;
  for (const watch of watches.docs) {
    signal?.throwIfAborted();
    try {
      const previous = await readDailySalesReviewSnapshot({ ...scope, referenceDate: watch.id });
      if (!previous) throw new Error("Missing sales review snapshot");
      const result = {
        ...previous,
        cases: await checkSalesPixRefunds(previous, readPixRefundChecks, {
          through, saleSourceHash: previous.pix.sourceHash ?? null,
        }),
      };
      signal?.throwIfAborted();
      await saveDailySalesReview(result, ACTOR_ID, now, {
        expectedRevision: previous.review.revision,
        expectedCollectedAt: previous.collectedAt,
        retainWatch: pixRefundDates(watch.id, through) !== null,
      });
      checked += 1;
    } catch {
      signal?.throwIfAborted();
      retry += 1;
      // A retry never overwrites a newer schedule, a deleted watch or a review.
      await financialDbAdmin.runTransaction(async tx => {
        const current = await tx.get(watch.ref);
        if (!current.updateTime?.isEqual(watch.updateTime)) return;
        tx.update(watch.ref, { nextCheckAt: new Date(now.getTime() + RETRY_DELAY_MS).toISOString() });
      });
    }
  }
  return { checked, retry };
}
