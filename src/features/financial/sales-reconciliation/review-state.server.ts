import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { latestPublishedDate } from "../receivables/period-review";
import { readPixRefundChecks } from "./pix-refunds.server";
import { readPixSalesSource } from "./pix-source.server";
import { unlinkedCaseCandidate } from "./unlinked-evidence.server";
import { applyUnlinkedResolutions, type UnlinkedResolution, type UnlinkedResolutionActor } from "./unlinked-resolution";
import type { DailySalesResult } from "./query";
import {
  buildDailySalesReviewTransition,
  dailySalesReviewId,
  dailySalesRefundScopeId,
  dailySalesReviewIdentityId,
  dailySalesSourceFingerprint,
  type DailySalesApiResult,
  type DailySalesReviewIdentity,
  type DailySalesReviewRecord,
} from "./review-state";
import type { DailySalesCalendarRecord } from "./review-calendar";

export const SALES_REVIEW_COLLECTION = "dailySalesReviews";
export const SALES_REVIEW_SNAPSHOT_COLLECTION = "dailySalesReviewSnapshots";
const REFUND_WATCH_DELAY_MS = 24 * 60 * 60 * 1000;

export function salesRefundWatchDates(identity: Omit<DailySalesReviewIdentity, "referenceDate">) {
  return financialDbAdmin.collection("dailySalesRefundWatches")
    .doc(dailySalesRefundScopeId(identity)).collection("pixRefundReviewDates");
}

const SNAPSHOT_VERSION = 1 as const;
const MAX_SNAPSHOT_BYTES = 850_000;
const MAX_RAW_SNAPSHOT_BYTES = 8_000_000;

const MAX_UNLINKED_RESOLUTIONS = 20;
export const unlinkedJustificationSchema = z.string().trim().min(12).max(500);
const unlinkedActorSchema = z.discriminatedUnion("namespace", [
  z.object({ namespace: z.literal("main.users"), id: z.string().min(1).max(128) }).strict(),
  z.object({ namespace: z.literal("system"), id: z.string().min(1).max(128),
    authorizationReference: z.string().min(1).max(180) }).strict(),
]);
const unlinkedResolutionSchema = z.object({
  caseKey: z.string().min(1).max(1000),
  evidenceKey: z.string().regex(/^[a-f0-9]{64}$/),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  justification: unlinkedJustificationSchema,
  actor: unlinkedActorSchema,
  decidedAt: z.string().datetime(),
  checkedThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  decidedRevision: z.number().int().positive(),
}).strict();

const summarySchema = z.object({
  pdvAmountCents: z.number().int(), stoneAmountCents: z.number().int(),
  autoCheckedCount: z.number().int().nonnegative(), attentionCount: z.number().int().nonnegative(),
  resolvedWithoutLinkCount: z.number().int().nonnegative().optional(),
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
  activeUnlinkedResolutions: z.array(unlinkedResolutionSchema).max(MAX_UNLINKED_RESOLUTIONS).optional(),
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

function rejectUnlinked(message: string): never {
  throw new AppError({ code: "SALES_REVIEW_UNLINKED_NOT_ELIGIBLE", kind: "CONFLICT", safeMessage: message });
}

type UnlinkedDecision = { caseKey: string; justification: string; actor: UnlinkedResolutionActor };

function sameUnlinkedActor(a: UnlinkedResolutionActor, b: UnlinkedResolutionActor) {
  return a.namespace === b.namespace && a.id === b.id
    && (a.namespace !== "system" || (b.namespace === "system" && a.authorizationReference === b.authorizationReference));
}

async function maintainUnlinkedResolutions(transaction: FirebaseFirestore.Transaction, result: DailySalesResult,
  previous: DailySalesReviewRecord | undefined, now: Date, decision?: UnlinkedDecision) {
  const saved = previous?.activeUnlinkedResolutions ?? [];
  const candidates = saved.flatMap(proof => {
    const row = unlinkedCaseCandidate(result, proof.caseKey);
    return row?.evidenceKey === proof.evidenceKey ? [{proof, ...row}] : [];
  });
  const checkThrough = latestPublishedDate(now);
  const active: UnlinkedResolution[] = [];
  for (const sourceHash of new Set(candidates.map(row => row.proof.sourceHash))) {
    const group = candidates.filter(row => row.proof.sourceHash === sourceHash);
    const checks = await readPixRefundChecks({ scope: result.scope, through: checkThrough,
      saleSourceHash: sourceHash, e2eIds: group.map(row => row.e2eId) }, transaction);
    active.push(...group.filter(row => checks.get(row.e2eId)?.state === "clear").map(row => row.proof));
  }
  if (!decision) return active;
  const savedDecision = saved.find(proof => proof.caseKey === decision.caseKey);
  if (savedDecision) {
    if (active.includes(savedDecision) && savedDecision.justification === decision.justification
      && sameUnlinkedActor(savedDecision.actor, decision.actor)) return active;
    rejectUnlinked("A resolução deste Pix mudou. Recarregue a conferência.");
  }
  if (!previous || active.length >= MAX_UNLINKED_RESOLUTIONS) rejectUnlinked("A revisão não permite registrar outra resolução.");
  const candidate = unlinkedCaseCandidate(result, decision.caseKey);
  if (!candidate) rejectUnlinked("O caso precisa ser um Pix aprovado na Stone, sem venda vinculada no PDV.");
  const pix = await readPixSalesSource(result.scope, transaction);
  const fresh = unlinkedCaseCandidate({ ...result, pix, stoneSales: pix.facts }, decision.caseKey);
  if (!pix.sourceHash || fresh?.evidenceKey !== candidate.evidenceKey) {
    rejectUnlinked("O arquivo Pix mudou. Reconsulte a data antes de registrar a resolução.");
  }
  const checks = await readPixRefundChecks({ scope: result.scope, through: checkThrough,
    saleSourceHash: pix.sourceHash, e2eIds: [candidate.e2eId] }, transaction);
  const check = checks.get(candidate.e2eId);
  if (!check?.complete || check.state !== "clear" || check.events.length !== 0) {
    rejectUnlinked("A resolução exige uma verificação completa, sem devolução Pix registrada na Stone.");
  }
  active.push({
    caseKey: decision.caseKey,
    evidenceKey: candidate.evidenceKey,
    sourceHash: pix.sourceHash,
    justification: unlinkedJustificationSchema.parse(decision.justification),
    actor: unlinkedActorSchema.parse(decision.actor),
    decidedAt: now.toISOString(),
    checkedThrough: check.checkedThrough,
    decidedRevision: previous.revision + 1,
  });
  return active;
}

export async function saveDailySalesReview(result: DailySalesResult, actorId: string, now = new Date(),
  refundRecheck?: { expectedRevision: number; expectedCollectedAt: string; retainWatch: boolean; unlinkedDecision?: UnlinkedDecision }) {
  const id = dailySalesReviewId(result);
  const ref = financialDbAdmin.collection(SALES_REVIEW_COLLECTION).doc(id);
  const snapshotRef = financialDbAdmin.collection(SALES_REVIEW_SNAPSHOT_COLLECTION).doc(id);
  return financialDbAdmin.runTransaction(async transaction => {
    const watchRef = salesRefundWatchDates({ ...result.scope, mappingId: result.mappingId }).doc(result.scope.referenceDate);
    const [snapshot, watch] = await Promise.all([transaction.get(ref), transaction.get(watchRef)]);
    let previous: DailySalesReviewRecord | undefined;
    if (snapshot.exists) {
      const parsed = recordSchema.safeParse(snapshot.data());
      if (!parsed.success) invalidStoredReview();
      previous = parsed.data;
      if (previous.workspaceId !== result.scope.workspaceId || previous.kioskId !== result.scope.kioskId
        || previous.mappingId !== result.mappingId || previous.stoneCode !== result.scope.stoneCode
        || previous.referenceDate !== result.scope.referenceDate) invalidStoredReview();
      if (!refundRecheck && previous.sourceFingerprint !== dailySalesSourceFingerprint(result)
        && Date.parse(previous.collectedAt) >= Date.parse(result.collectedAt)) {
        throw new AppError({ code: "SALES_REVIEW_STALE_OBSERVATION", kind: "CONFLICT",
          safeMessage: "Uma conferência igual ou mais recente já foi registrada. As fontes serão consultadas novamente." });
      }
    }
    const decision = refundRecheck?.unlinkedDecision;
    const replay = decision && previous?.activeUnlinkedResolutions?.find(proof => proof.caseKey === decision.caseKey
      && proof.decidedRevision === previous?.revision
      && proof.decidedRevision === refundRecheck!.expectedRevision + 1
      && proof.justification === decision.justification
      && sameUnlinkedActor(proof.actor, decision.actor));
    if (refundRecheck && ((!replay && previous?.revision !== refundRecheck.expectedRevision)
      || previous?.collectedAt !== refundRecheck.expectedCollectedAt || previous.collectedAt !== result.collectedAt
      || (decision && previous.sourceFingerprint !== dailySalesSourceFingerprint(result)))) {
      throw new AppError({ code: "SALES_REVIEW_STALE_OBSERVATION", kind: "CONFLICT",
        safeMessage: "Uma nova revisão foi registrada durante a verificação de devoluções." });
    }
    const activeUnlinkedResolutions = await maintainUnlinkedResolutions(transaction, result, previous, now, decision);
    const resolvedResult = { ...result, cases: applyUnlinkedResolutions(result.cases, activeUnlinkedResolutions) };
    const transition = buildDailySalesReviewTransition({
      result: resolvedResult, actorId, now: now.toISOString(), previous, activeUnlinkedResolutions,
    });
    const needsWatch = (activeUnlinkedResolutions.length > 0 || result.cases.some(row => row.pixRefundCheck)) && (refundRecheck?.retainWatch ?? true);
    if (needsWatch && (!watch.exists || refundRecheck)) {
      transaction.set(watchRef, { nextCheckAt: new Date(now.getTime() + REFUND_WATCH_DELAY_MS).toISOString() });
    } else if (!needsWatch && watch.exists) transaction.delete(watchRef);
    if (!transition.write && previous?.snapshotVersion === SNAPSHOT_VERSION) return transition.view;
    const encoded = encodeSnapshot(resolvedResult, transition.view, now.toISOString());
    if (!encoded && needsWatch) {
      throw new AppError({ code: "SALES_REVIEW_REFUND_SNAPSHOT_REQUIRED", kind: "DATA_INTEGRITY",
        safeMessage: "A conferência de devoluções exige um snapshot que possa ser revisto pela rotina automática." });
    }
    const next = transition.write ? (encoded ? withSnapshot(transition.next) : transition.next)
      : encoded && previous ? withSnapshot(previous) : previous;
    if (!next) invalidStoredReview();
    if (transition.write) {
      transaction.set(ref, next);
      const recordedDecision = decision && activeUnlinkedResolutions.find(proof => proof.caseKey === decision.caseKey
        && proof.decidedRevision === next.revision);
      if (recordedDecision) {
        transaction.create(financialDbAdmin.collection("dailySalesUnlinkedResolutionAudits").doc(`${id}-${next.revision}`), {
          workspaceId: next.workspaceId, kioskId: next.kioskId, mappingId: next.mappingId,
          stoneCode: next.stoneCode, referenceDate: next.referenceDate, reviewId: id, revision: next.revision,
          caseKey: recordedDecision.caseKey, decidedAt: recordedDecision.decidedAt, actor: recordedDecision.actor,
          ...(recordedDecision.actor.namespace === "main.users" ? { actorUserId: recordedDecision.actor.id } : {}),
        });
      }
      const pixRefundProof = result.cases.flatMap(row => row.pixRefundCheck ? [row.pixRefundCheck] : []);
      const invalidatedUnlinkedCases = (previous?.activeUnlinkedResolutions ?? [])
        .filter(proof => !activeUnlinkedResolutions.some(active => active.caseKey === proof.caseKey))
        .map(proof => ({ caseKey: proof.caseKey, decidedRevision: proof.decidedRevision }));
      transaction.create(ref.collection("revisions").doc(String(next.revision)), {
        ...next,
        ...(invalidatedUnlinkedCases.length ? { invalidatedUnlinkedCases } : {}),
        previousRevision: previous?.revision ?? 0,
        sourceChanged: transition.view.sourceChanged,
        ...(pixRefundProof.length ? {
          pixRefundProof: pixRefundProof.map(proof => ({
            state: proof.state, checkedThrough: proof.checkedThrough, complete: proof.complete, eventCount: proof.events.length,
          })),
        } : {}),
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
