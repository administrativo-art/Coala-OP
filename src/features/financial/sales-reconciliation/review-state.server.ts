import "server-only";
import { z } from "zod";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import type { DailySalesResult } from "./query";
import {
  buildDailySalesReviewTransition,
  dailySalesReviewId,
  dailySalesSourceFingerprint,
  type DailySalesReviewRecord,
} from "./review-state";

export const SALES_REVIEW_COLLECTION = "dailySalesReviews";

const summarySchema = z.object({
  pdvAmountCents: z.number().int(), stoneAmountCents: z.number().int(),
  autoCheckedCount: z.number().int().nonnegative(), attentionCount: z.number().int().nonnegative(),
  sourceIssueCount: z.number().int().nonnegative(), uncomparedPdvCount: z.number().int().nonnegative(),
}).strict();
const recordSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: z.string().min(1).max(180), kioskId: z.string().min(1).max(180),
  mappingId: z.string().min(1).max(180), accountId: z.string().min(1).max(180),
  stoneCode: z.string().regex(/^\d{1,20}$/), referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pdvFilialId: z.string().regex(/^\d{1,20}$/), status: z.enum(["closed", "attention_required", "awaiting_source"]),
  revision: z.number().int().positive(), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  summary: summarySchema, collectedAt: z.string().datetime(),
  reviewedAt: z.string().datetime(), reviewedBy: z.string().min(1).max(180),
  closedAt: z.string().datetime().nullable(), closedBy: z.string().min(1).max(180).nullable(),
  reopenedAt: z.string().datetime().nullable(), reopenedReason: z.literal("source_changed").nullable(),
}).strict();

function invalidStoredReview(): never {
  throw new AppError({ code: "SALES_REVIEW_STATE_INVALID", kind: "DATA_INTEGRITY",
    safeMessage: "O fechamento diário salvo está inválido. A conferência não foi alterada." });
}

export async function saveDailySalesReview(result: DailySalesResult, actorId: string, now = new Date()) {
  const id = dailySalesReviewId(result);
  const ref = financialDbAdmin.collection(SALES_REVIEW_COLLECTION).doc(id);
  return financialDbAdmin.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    let previous: DailySalesReviewRecord | undefined;
    if (snapshot.exists) {
      const parsed = recordSchema.safeParse(snapshot.data());
      if (!parsed.success) invalidStoredReview();
      previous = parsed.data;
      if (previous.workspaceId !== result.scope.workspaceId || previous.kioskId !== result.scope.kioskId
        || previous.mappingId !== result.mappingId || previous.stoneCode !== result.scope.stoneCode
        || previous.referenceDate !== result.scope.referenceDate) invalidStoredReview();
      if (previous.sourceFingerprint !== dailySalesSourceFingerprint(result)
        && Date.parse(previous.collectedAt) >= Date.parse(result.collectedAt)) {
        throw new AppError({ code: "SALES_REVIEW_STALE_OBSERVATION", kind: "CONFLICT",
          safeMessage: "Uma conferência igual ou mais recente já foi registrada. As fontes serão consultadas novamente." });
      }
    }
    const transition = buildDailySalesReviewTransition({
      result, actorId, now: now.toISOString(), previous,
    });
    if (!transition.write) return transition.view;
    transaction.set(ref, transition.next);
    transaction.create(ref.collection("revisions").doc(String(transition.next.revision)), {
      ...transition.next,
      previousRevision: previous?.revision ?? 0,
      sourceChanged: transition.view.sourceChanged,
    });
    return transition.view;
  });
}
