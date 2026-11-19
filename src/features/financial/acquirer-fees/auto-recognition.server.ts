import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
import { operationalCivilDate } from "@/lib/operational-unit-periods";
import { feeRequestSchema, type FeeRequest } from "./contracts";
import { autoModeSchema, autoWindow, decideAutoBatches, settableAutoModeSchema, AUTO_MAX_PENDING, type AutoMode, type AutoPending, type AutoRunSummary, type AutoPendingReview, pendingReview, AUTO_ACTOR_ID } from "./auto-recognition";
import { executeSaleFeeAction, previewSaleFees, recognitionDependencies, type RecognitionDependencies } from "./recognition.server";
import { recognitionMapping, recognitionMappingForMonth } from "./recognition-mapping.server";
import type { FeeContext } from "./source.server";

export const autoContext = (workspaceId = WORKSPACE_ID): FeeContext => ({ isDefaultAdmin: true, workspace_id: workspaceId, decoded: { uid: AUTO_ACTOR_ID } });
const MAX_MAPPINGS = 25;

export const autoModeActionSchema = z.object({ action: z.literal("save_auto_mode"), request: feeRequestSchema, mode: settableAutoModeSchema, reason: z.string().trim().min(3).max(500) }).strict();

export const recheckAutoPendingSchema = z.object({ action: z.literal("recheck_auto_pending"), request: feeRequestSchema }).strict();

function pendingMonth(document: FirebaseFirestore.DocumentReference, request: FeeRequest) {
  const id = createHash("sha256").update(JSON.stringify([request.kioskId, request.stoneCode, request.referenceDate.slice(0, 7)])).digest("hex");
  return document.collection("feeAutoPendingMonths").doc(id);
}

function reviewKey(request: FeeRequest) {
  return `${request.referenceDate}_${request.source}`;
}

async function savePendingReview(ref: FirebaseFirestore.DocumentReference, request: FeeRequest, review: AutoPendingReview) {
  await db.runTransaction(async tx => {
    const month = await tx.get(ref);
    const key = reviewKey(request);
    const previous = month.get(`reviews.${key}`) as AutoPendingReview | undefined;
    if (previous && previous.checkedAt >= review.checkedAt) return;
    tx.set(ref, { reviews: { [key]: review } }, { merge: true });
  });
}

export async function readAutoState(request: FeeRequest, context: FeeContext) {
  const { document } = await recognitionMappingForMonth(request, context);
  const mode = autoModeSchema.safeParse(document.get("feeAutoRecognition.mode"));
  const month = await pendingMonth(document.ref, request).get();
  const pending = (Object.values(month.get("reviews") ?? {}) as AutoPendingReview[])
    .filter(review => review.reasons.length)
    .sort((left, right) => left.date.localeCompare(right.date) || left.source.localeCompare(right.source))
    .map(({ date, source, checkedAt, reasons, truncated }) => ({ date, source, checkedAt, reasons, truncated }));
  return { pending, mode: (mode.success ? mode.data : "off") as AutoMode, lastRun: (document.get("feeAutoRecognition.lastRun") ?? null) as AutoRunSummary | null, updatedAt: (document.get("feeAutoRecognition.updatedAt") ?? null) as string | null };
}

export async function saveAutoMode(raw: unknown, context: FeeContext) {
  const parsed = autoModeActionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: "FEE_AUTO_MODE_INVALID", kind: "VALIDATION", safeMessage: "Modo de reconhecimento inválido." });
  const input = parsed.data;
  return db.runTransaction(async tx => {
    const { document } = await recognitionMappingForMonth(input.request, context, tx);
    const at = new Date().toISOString();
    const previous = autoModeSchema.safeParse(document.get("feeAutoRecognition.mode"));
    tx.update(document.ref, { "feeAutoRecognition.mode": input.mode, "feeAutoRecognition.updatedAt": at, "feeAutoRecognition.updatedBy": context.decoded.uid });
    tx.create(document.ref.collection("events").doc(randomUUID()), { type: "fee_auto_mode_updated", actorId: context.decoded.uid, actorNamespace: "main.users", at, reason: input.reason, previous: previous.success ? previous.data : "off", next: input.mode });
    return { mode: input.mode, updatedAt: at };
  });
}

type Counts = { recognized: number; wouldRecognize: number; amountCents: number; alreadyDone: number; pending: AutoPending[] };
/** Roda uma unidade/StoneCode/dia/meio. Falhas de uma fonte viram pendência e não interrompem as demais. */
async function runOne(request: FeeRequest, mode: Exclude<AutoMode, "off"> | "review", counts: Counts, context: FeeContext, deps: RecognitionDependencies) {
  const push = (reason: string) => counts.pending.push({ date: request.referenceDate, source: request.source, reason });
  try {
    const preview = await previewSaleFees(request, context, deps);
    const decision = decideAutoBatches(preview);
    counts.alreadyDone += decision.alreadyDone;
    decision.pending.forEach(push);
    for (const batch of decision.eligible) {
      if (mode === "review") {
        push("Taxa comprovada ainda sem lançamento. Use Reconhecer na apuração deste dia.");
        continue;
      }
      if (mode === "simulation") { counts.wouldRecognize += 1; counts.amountCents += batch.amountCents; continue; }
      try {
        await executeSaleFeeAction({ action: "recognize_sale", request, batchId: batch.id, fingerprint: batch.fingerprint, resultCenterId: preview.centers[0].id, expectedRevision: 0, confirmedNoManualExpense: true, reason: "Reconhecimento automático diário" }, context, deps);
        counts.recognized += 1; counts.amountCents += batch.amountCents;
      } catch (caught) { push(`${batch.soldOn}: ${caught instanceof AppError ? caught.safeMessage ?? caught.code : "falha ao reconhecer"}`); }
    }
  } catch (caught) { push(caught instanceof AppError ? caught.safeMessage ?? caught.code : "Fonte indisponível para este dia."); }
}

export async function recheckAutoPending(request: FeeRequest, context: FeeContext, signal?: AbortSignal) {
  const { document } = await recognitionMapping(request, context);
  const ref = pendingMonth(document.ref, request);
  const existing = (await ref.get()).get(`reviews.${reviewKey(request)}`) as AutoPendingReview | undefined;
  if (!existing?.reasons.length) return readAutoState(request, context);
  const checkedAt = new Date().toISOString();
  const counts: Counts = { recognized: 0, wouldRecognize: 0, amountCents: 0, alreadyDone: 0, pending: [] };
  await runOne(request, document.get("feeAutoRecognition.mode") === "simulation" ? "simulation" : "review", counts, context, recognitionDependencies(signal));
  signal?.throwIfAborted();
  await savePendingReview(ref, request, pendingReview(counts.pending, request.referenceDate, request.source, checkedAt));
  return readAutoState(request, context);
}

/** Passa por todas as unidades ligadas. Unidades em "off" não são tocadas; "simulation" nunca grava despesa. */
export async function runAutoRecognition(options: { now?: Date; days?: number; signal?: AbortSignal; dependencies?: RecognitionDependencies } = {}) {
  const context = autoContext();
  const deps = options.dependencies ?? recognitionDependencies(options.signal);
  const today = operationalCivilDate(options.now ?? new Date());
  const dates = autoWindow(today, options.days);
  const snapshot = await db.collection("stoneMerchantMappings").where("workspaceId", "==", context.workspace_id).limit(MAX_MAPPINGS + 1).get();
  if (snapshot.size > MAX_MAPPINGS) throw new AppError({ code: "FEE_AUTO_LIMIT", kind: "CONFLICT", safeMessage: "Mais unidades que o limite do reconhecimento automático." });
  const report: Array<{ mappingId: string; kioskId: string; mode: AutoMode } & Partial<Counts>> = [];
  for (const doc of snapshot.docs) {
    const parsedMode = autoModeSchema.safeParse(doc.get("feeAutoRecognition.mode"));
    const mode = parsedMode.success ? parsedMode.data : "off";
    const kioskId = String(doc.get("kioskId") ?? "");
    if (mode === "off" || doc.get("status") !== "active" || !kioskId) { report.push({ mappingId: doc.id, kioskId, mode }); continue; }
    const counts: Counts = { recognized: 0, wouldRecognize: 0, amountCents: 0, alreadyDone: 0, pending: [] };
    const validFrom = doc.get("validFrom");
    const validTo = doc.get("validTo");
    const eligibleDates = dates.filter(date => typeof validFrom === "string" && validFrom <= date && (!validTo || date <= validTo));
    for (const stoneCode of (doc.get("stoneCodes") as string[] | undefined) ?? [])
      for (const referenceDate of eligibleDates) for (const source of ["cards", "pix"] as const) {
        options.signal?.throwIfAborted();
        const request = { mappingId: doc.id, kioskId, stoneCode, referenceDate, source };
        const checkedAt = new Date().toISOString();
        const previousCount = counts.pending.length;
        await runOne(request, mode, counts, context, deps);
        options.signal?.throwIfAborted();
        const review = pendingReview(counts.pending.slice(previousCount), referenceDate, source, checkedAt);
        await savePendingReview(pendingMonth(doc.ref, request), request, review);
      }
    const summary: AutoRunSummary = { at: new Date().toISOString(), mode, dates: eligibleDates, recognized: counts.recognized, wouldRecognize: counts.wouldRecognize, amountCents: counts.amountCents, alreadyDone: counts.alreadyDone,
      pending: counts.pending.slice(0, AUTO_MAX_PENDING), pendingTruncated: counts.pending.length > AUTO_MAX_PENDING };
    await doc.ref.update({ "feeAutoRecognition.lastRun": summary });
    report.push({ mappingId: doc.id, kioskId, mode, ...counts, pending: summary.pending });
  }
  return { today, dates, units: report };
}
