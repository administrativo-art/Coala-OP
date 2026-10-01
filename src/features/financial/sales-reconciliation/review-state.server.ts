import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import type { DailySalesResult } from "./query";
import {
  buildDailySalesReviewTransition,
  dailySalesReviewId,
  dailySalesReviewIdentityId,
  dailySalesSourceFingerprint,
  type DailySalesApiResult,
  type DailySalesReviewIdentity,
  type DailySalesReviewRecord,
} from "./review-state";
import type { DailySalesCalendarRecord } from "./review-calendar";

export const SALES_REVIEW_COLLECTION = "dailySalesReviews";
export const SALES_REVIEW_SNAPSHOT_COLLECTION = "dailySalesReviewSnapshots";
const SNAPSHOT_VERSION = 1 as const;
const MAX_SNAPSHOT_BYTES = 850_000;
const MAX_RAW_SNAPSHOT_BYTES = 8_000_000;

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
  snapshotVersion: z.literal(SNAPSHOT_VERSION).optional(),
}).strict();

const snapshotSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_VERSION),
  workspaceId: z.string().min(1).max(180), kioskId: z.string().min(1).max(180),
  mappingId: z.string().min(1).max(180), stoneCode: z.string().regex(/^\d{1,20}$/),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reviewRevision: z.number().int().positive(), encoding: z.literal("gzip-json"),
  rawBytes: z.number().int().positive().max(MAX_RAW_SNAPSHOT_BYTES),
  compressedBytes: z.number().int().positive().max(MAX_SNAPSHOT_BYTES), payload: z.unknown(),
  collectedAt: z.string().datetime(), storedAt: z.string().datetime(),
}).strict();

const snapshotResultSchema = z.object({
  scope: z.object({ workspaceId: z.string(), kioskId: z.string(), stoneCode: z.string(), referenceDate: z.string() }),
  mappingId: z.string(), accountId: z.string(), pdvFilialId: z.string(), collectedAt: z.string(),
  pdvFacts: z.array(z.unknown()), stoneSales: z.array(z.unknown()), uncomparedPdvFacts: z.array(z.unknown()),
  issues: z.array(z.unknown()), stoneEvents: z.array(z.unknown()), cases: z.array(z.unknown()), limitations: z.array(z.string()),
  review: z.object({ id: z.string(), status: z.enum(["closed", "attention_required", "awaiting_source"]), revision: z.number() }).passthrough(),
}).passthrough();

function invalidStoredReview(): never {
  throw new AppError({ code: "SALES_REVIEW_STATE_INVALID", kind: "DATA_INTEGRITY",
    safeMessage: "O fechamento diário salvo está inválido. A conferência não foi alterada." });
}

function encodeSnapshot(result: DailySalesResult, review: DailySalesApiResult["review"], now: string) {
  const raw = Buffer.from(JSON.stringify({ ...result, review: { ...review, snapshotAvailable: true } }), "utf8");
  if (!raw.length || raw.length > MAX_RAW_SNAPSHOT_BYTES) return null;
  const payload = gzipSync(raw, { level: 9 });
  if (!payload.length || payload.length > MAX_SNAPSHOT_BYTES) return null;
  return {
    schemaVersion: SNAPSHOT_VERSION,
    workspaceId: result.scope.workspaceId,
    kioskId: result.scope.kioskId,
    mappingId: result.mappingId,
    stoneCode: result.scope.stoneCode,
    referenceDate: result.scope.referenceDate,
    sourceFingerprint: dailySalesSourceFingerprint(result),
    reviewRevision: review.revision,
    encoding: "gzip-json" as const,
    rawBytes: raw.length,
    compressedBytes: payload.length,
    payload,
    collectedAt: result.collectedAt,
    storedAt: now,
  };
}

const withSnapshot = (record: DailySalesReviewRecord): DailySalesReviewRecord => ({ ...record, snapshotVersion: SNAPSHOT_VERSION });

function calendarRecord(record: DailySalesReviewRecord, id: string): DailySalesCalendarRecord {
  return {
    id,
    referenceDate: record.referenceDate,
    status: record.status,
    revision: record.revision,
    summary: record.summary,
    reviewedAt: record.reviewedAt,
    closedAt: record.closedAt,
    reopenedAt: record.reopenedAt,
    reopenedReason: record.reopenedReason,
    snapshotAvailable: record.snapshotVersion === SNAPSHOT_VERSION,
  };
}

export async function saveDailySalesReview(result: DailySalesResult, actorId: string, now = new Date()) {
  const id = dailySalesReviewId(result);
  const ref = financialDbAdmin.collection(SALES_REVIEW_COLLECTION).doc(id);
  const snapshotRef = financialDbAdmin.collection(SALES_REVIEW_SNAPSHOT_COLLECTION).doc(id);
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
    if (!transition.write && previous?.snapshotVersion === SNAPSHOT_VERSION) return transition.view;
    const encoded = encodeSnapshot(result, transition.view, now.toISOString());
    const next = transition.write ? (encoded ? withSnapshot(transition.next) : transition.next)
      : encoded && previous ? withSnapshot(previous) : previous;
    if (!next) invalidStoredReview();
    if (transition.write) {
      transaction.set(ref, next);
      transaction.create(ref.collection("revisions").doc(String(next.revision)), {
        ...next,
        previousRevision: previous?.revision ?? 0,
        sourceChanged: transition.view.sourceChanged,
      });
    } else if (encoded) transaction.update(ref, { snapshotVersion: SNAPSHOT_VERSION });
    if (encoded) transaction.set(snapshotRef, encoded);
    else if (transition.write && previous?.snapshotVersion === SNAPSHOT_VERSION) transaction.delete(snapshotRef);
    return { ...transition.view, snapshotAvailable: next.snapshotVersion === SNAPSHOT_VERSION };
  });
}

export async function listDailySalesReviewCalendar(input: DailySalesReviewIdentity & { from: string; through: string }) {
  const snapshot = await financialDbAdmin.collection(SALES_REVIEW_COLLECTION)
    .where("workspaceId", "==", input.workspaceId)
    .where("mappingId", "==", input.mappingId)
    .where("stoneCode", "==", input.stoneCode)
    .where("referenceDate", ">=", input.from)
    .where("referenceDate", "<=", input.through)
    .orderBy("referenceDate", "asc")
    .limit(367)
    .get();
  return snapshot.docs.map(document => {
    const parsed = recordSchema.safeParse(document.data());
    if (!parsed.success || parsed.data.kioskId !== input.kioskId) invalidStoredReview();
    return calendarRecord(parsed.data, document.id);
  });
}

export async function readDailySalesReviewSnapshot(identity: DailySalesReviewIdentity): Promise<DailySalesApiResult | null> {
  const id = dailySalesReviewIdentityId(identity);
  const document = await financialDbAdmin.collection(SALES_REVIEW_SNAPSHOT_COLLECTION).doc(id).get();
  if (!document.exists) return null;
  const parsed = snapshotSchema.safeParse(document.data());
  if (!parsed.success || parsed.data.workspaceId !== identity.workspaceId || parsed.data.kioskId !== identity.kioskId
    || parsed.data.mappingId !== identity.mappingId || parsed.data.stoneCode !== identity.stoneCode
    || parsed.data.referenceDate !== identity.referenceDate) invalidStoredReview();
  let decoded: unknown;
  try {
    decoded = JSON.parse(gunzipSync(Buffer.from(parsed.data.payload as Uint8Array)).toString("utf8"));
  } catch { invalidStoredReview(); }
  const result = snapshotResultSchema.safeParse(decoded);
  if (!result.success || result.data.review.id !== id
    || result.data.scope.workspaceId !== identity.workspaceId || result.data.scope.kioskId !== identity.kioskId
    || result.data.mappingId !== identity.mappingId || result.data.scope.stoneCode !== identity.stoneCode
    || result.data.scope.referenceDate !== identity.referenceDate) invalidStoredReview();
  return decoded as DailySalesApiResult;
}
