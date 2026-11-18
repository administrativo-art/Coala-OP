import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/observability/app-error";
import { salesReviewRequestSchema, type SalesReviewBinding } from "./query";
import { readDailySalesReviewSnapshot, saveDailySalesReview, unlinkedJustificationSchema } from "./review-state.server";
import { applyUnlinkedResolutions, type UnlinkedResolutionActor } from "./unlinked-resolution";

export const unlinkedResolutionRequestSchema = salesReviewRequestSchema.extend({
  caseKey: z.string().min(1).max(1000),
  expectedRevision: z.number().int().positive(),
  justification: unlinkedJustificationSchema,
});

export type UnlinkedResolutionRequest = z.infer<typeof unlinkedResolutionRequestSchema>;

export async function resolveUnlinkedPix(input: UnlinkedResolutionRequest, binding: SalesReviewBinding,
  actor: UnlinkedResolutionActor, now = new Date()) {
  const { mapping, pdvFilialId } = binding;
  const identity = { workspaceId: mapping.workspaceId, mappingId: input.mappingId, kioskId: input.kioskId,
    stoneCode: input.stoneCode, referenceDate: input.referenceDate };
  if (identity.mappingId !== mapping.id || identity.kioskId !== mapping.kioskId
    || !mapping.stoneCodes.includes(identity.stoneCode) || mapping.terminalIds.length > 0 || mapping.status !== "active"
    || identity.referenceDate < mapping.validFrom || (mapping.validTo && identity.referenceDate > mapping.validTo)) {
    throw new AppError({ code: "SALES_REVIEW_UNLINKED_SCOPE", kind: "AUTHORIZATION" });
  }
  const result = await readDailySalesReviewSnapshot(identity);
  if (!result || result.accountId !== mapping.accountId || result.pdvFilialId !== pdvFilialId) {
    throw new AppError({ code: "SALES_REVIEW_UNLINKED_STALE", kind: "CONFLICT",
      safeMessage: "O vínculo ou a revisão mudou. Reconsulte a data antes de resolver." });
  }
  const review = await saveDailySalesReview(result, actor.id, now, {
    expectedRevision: input.expectedRevision,
    expectedCollectedAt: result.collectedAt,
    retainWatch: true,
    unlinkedDecision: { caseKey: input.caseKey, justification: input.justification, actor },
  });
  return { ...result, cases: applyUnlinkedResolutions(result.cases, review.activeUnlinkedResolutions ?? []), review };
}
