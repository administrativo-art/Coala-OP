import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { AppError } from "@/lib/observability/app-error";
import { operationalCivilDate } from "@/lib/operational-unit-periods";
import { feeRequestSchema, type FeeRequest } from "./contracts";
import { autoModeSchema, autoWindow, decideAutoBatches, settableAutoModeSchema, AUTO_MAX_PENDING, type AutoMode, type AutoPending, type AutoRunSummary } from "./auto-recognition";
import { executeSaleFeeAction, previewSaleFees, recognitionDependencies } from "./recognition.server";
import { recognitionMapping } from "./recognition-mapping.server";
import type { FeeContext } from "./source.server";

/** Autor das ações automáticas. Fica explícito na trilha de auditoria. */
export const AUTO_ACTOR_ID = "system:acquirer-fee-auto";
export const autoContext = (workspaceId = WORKSPACE_ID): FeeContext => ({ isDefaultAdmin: true, workspace_id: workspaceId, decoded: { uid: AUTO_ACTOR_ID } });
const MAX_MAPPINGS = 25;

export const autoModeActionSchema = z.object({ action: z.literal("save_auto_mode"), request: feeRequestSchema, mode: settableAutoModeSchema, reason: z.string().trim().min(3).max(500) }).strict();

export async function readAutoState(request: FeeRequest, context: FeeContext) {
  const { document } = await recognitionMapping(request, context);
  const mode = autoModeSchema.safeParse(document.get("feeAutoRecognition.mode"));
  return { mode: (mode.success ? mode.data : "off") as AutoMode, lastRun: (document.get("feeAutoRecognition.lastRun") ?? null) as AutoRunSummary | null, updatedAt: (document.get("feeAutoRecognition.updatedAt") ?? null) as string | null };
}

export async function saveAutoMode(raw: unknown, context: FeeContext) {
  const parsed = autoModeActionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: "FEE_AUTO_MODE_INVALID", kind: "VALIDATION", safeMessage: "Modo inválido. Nesta versão só é possível desligar ou deixar em simulação." });
  const input = parsed.data;
  return db.runTransaction(async tx => {
    const { document } = await recognitionMapping(input.request, context, tx);
    const at = new Date().toISOString();
    const previous = autoModeSchema.safeParse(document.get("feeAutoRecognition.mode"));
    tx.update(document.ref, { "feeAutoRecognition.mode": input.mode, "feeAutoRecognition.updatedAt": at, "feeAutoRecognition.updatedBy": context.decoded.uid });
    tx.create(document.ref.collection("events").doc(randomUUID()), { type: "fee_auto_mode_updated", actorId: context.decoded.uid, actorNamespace: "main.users", at, reason: input.reason, previous: previous.success ? previous.data : "off", next: input.mode });
    return { mode: input.mode, updatedAt: at };
  });
}

type Counts = { recognized: number; wouldRecognize: number; amountCents: number; alreadyDone: number; pending: AutoPending[] };
/** Roda uma unidade/StoneCode/dia/meio. Falhas de uma fonte viram pendência e não interrompem as demais. */
async function runOne(request: FeeRequest, mode: Exclude<AutoMode, "off">, counts: Counts, context: FeeContext, signal?: AbortSignal) {
  const push = (reason: string) => counts.pending.push({ date: request.referenceDate, source: request.source, reason });
  try {
    const deps = recognitionDependencies(signal);
    const preview = await previewSaleFees(request, context, deps);
    const decision = decideAutoBatches(preview);
    counts.alreadyDone += decision.alreadyDone;
    decision.pending.forEach(push);
    for (const batch of decision.eligible) {
      if (mode === "simulation") { counts.wouldRecognize += 1; counts.amountCents += batch.amountCents; continue; }
      try {
        await executeSaleFeeAction({ action: "recognize_sale", request, batchId: batch.id, fingerprint: batch.fingerprint, resultCenterId: preview.centers[0].id, expectedRevision: 0, confirmedNoManualExpense: true, reason: "Reconhecimento automático diário" }, context, deps);
        counts.recognized += 1; counts.amountCents += batch.amountCents;
      } catch (caught) { push(`${batch.soldOn}: ${caught instanceof AppError ? caught.safeMessage ?? caught.code : "falha ao reconhecer"}`); }
    }
  } catch (caught) { push(caught instanceof AppError ? caught.safeMessage ?? caught.code : "Fonte indisponível para este dia."); }
}

/** Passa por todas as unidades ligadas. Unidades em "off" não são tocadas; "simulation" nunca grava despesa. */
export async function runAutoRecognition(options: { now?: Date; days?: number; signal?: AbortSignal } = {}) {
  const context = autoContext();
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
    for (const stoneCode of (doc.get("stoneCodes") as string[] | undefined) ?? [])
      for (const referenceDate of dates) for (const source of ["cards", "pix"] as const) {
        if (options.signal?.aborted) break;
        await runOne({ mappingId: doc.id, kioskId, stoneCode, referenceDate, source }, mode, counts, context, options.signal);
      }
    const summary: AutoRunSummary = { at: new Date().toISOString(), mode, dates, recognized: counts.recognized, wouldRecognize: counts.wouldRecognize, amountCents: counts.amountCents, alreadyDone: counts.alreadyDone,
      pending: counts.pending.slice(0, AUTO_MAX_PENDING), pendingTruncated: counts.pending.length > AUTO_MAX_PENDING };
    await doc.ref.update({ "feeAutoRecognition.lastRun": summary });
    report.push({ mappingId: doc.id, kioskId, mode, ...counts, pending: summary.pending });
  }
  return { today, dates, units: report };
}
