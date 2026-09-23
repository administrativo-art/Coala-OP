import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { financialDbAdmin as db } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { financialAgentIdentifier } from "./contracts";
import { managementRequestSchema } from "./management";
import { runManagementAnalysis } from "./management.server";
import { readReceivablePeriodMapping } from "../receivables/mapping.server";
import { managementPeriod } from "./management";

const revision = z.number().int().min(0);
export const routineActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), request: managementRequestSchema, enabled: z.boolean(),
    cadence: z.enum(["daily", "weekly"]), revision }).strict(),
  z.object({ action: z.literal("run"), id: financialAgentIdentifier }).strict(),
  z.object({ action: z.literal("acknowledge"), id: financialAgentIdentifier,
    runId: financialAgentIdentifier, alertCode: z.string().regex(/^[a-z_]{1,40}$/) }).strict(),
]);
function conflict(): never { throw new AppError({ code: "FINANCIAL_ROUTINE_CONFLICT", kind: "CONFLICT", safeMessage: "A rotina mudou ou está em execução. Atualize antes de continuar." }); }
function forbidden(): never { throw new AppError({ code: "FINANCIAL_ROUTINE_FORBIDDEN", kind: "AUTHORIZATION" }); }
const collection = db.collection("financialAnalysisRoutines");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const view = (id: string, data: FirebaseFirestore.DocumentData) => ({ id, request: data.request,
  cadence: data.cadence, enabled: data.enabled, revision: data.revision, nextRunAt: data.nextRunAt,
  lastRun: data.lastRun ?? null, lastErrorCode: data.lastErrorCode ?? null });

export async function listFinancialRoutines(workspaceId: string) {
  const rows = await collection.where("workspaceId", "==", workspaceId).limit(21).get();
  if (rows.size > 20) throw new AppError({ code: "FINANCIAL_ROUTINE_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "Limite de 20 rotinas nesta tela. Consulte a administração." });
  return rows.docs.map(doc => view(doc.id, doc.data()));
}

export async function actFinancialRoutine(raw: unknown, context: { isDefaultAdmin: boolean; workspace_id: string }, actor: string) {
  if (!context.isDefaultAdmin) forbidden();
  const parsed = routineActionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: "FINANCIAL_ROUTINE_INVALID", kind: "VALIDATION" });
  const input = parsed.data;
  if (input.action === "run") return executeFinancialRoutine(input.id, context.workspace_id, actor, false);
  if (input.action === "save") {
    // Scheduled routines never repeatedly download 31 Stone files. Explicit manual
    // analyses retain that option; recurring checks use canonical local sources.
    const request = { ...input.request, includeStone: false };
    const period = managementPeriod(request.month);
    const mapping = await readReceivablePeriodMapping({ kioskId: request.kioskId, stoneCode: request.stoneCode,
      from: period.from, through: period.through }, context.workspace_id);
    if (mapping.id !== request.mappingId) conflict();
    const id = digest(`${context.workspace_id}:${request.kioskId}:${request.stoneCode}`);
    const ref = collection.doc(id); const now = new Date().toISOString();
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref); const data = snapshot.data();
      if (!snapshot.exists) {
        const existing = await tx.get(collection.where("workspaceId", "==", context.workspace_id).limit(20));
        if (existing.size >= 20) throw new AppError({ code: "FINANCIAL_ROUTINE_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "Limite de 20 rotinas por workspace." });
      }
      if (data && data.workspaceId !== context.workspace_id) forbidden();
      if ((data?.revision ?? 0) !== input.revision || (data?.leaseUntil && data.leaseUntil > now)) conflict();
      tx.set(ref, { workspaceId: context.workspace_id, request, cadence: input.cadence,
        enabled: input.enabled, revision: input.revision + 1, nextRunAt: now,
        updatedAt: now, updatedBy: actor, leaseUntil: null, leaseId: null }, { merge: true });
      tx.set(ref.collection("audit").doc(String(input.revision + 1)), { action: "configure", actor, at: now,
        enabled: input.enabled, cadence: input.cadence, revision: input.revision + 1 });
    });
    return { id, revision: input.revision + 1 };
  }
  const ref = collection.doc(input.id);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref); const data = snapshot.data();
    if (!data || data.workspaceId !== context.workspace_id) forbidden();
    if (data.lastRun?.id !== input.runId) conflict();
    const alerts = data.lastRun.alerts as Array<{ code: string; acknowledgedAt?: string | null }>;
    if (!alerts.some(alert => alert.code === input.alertCode)) conflict();
    if (alerts.some(alert => alert.code === input.alertCode && alert.acknowledgedAt)) return;
    const now = new Date().toISOString();
    tx.update(ref, { lastRun: { ...data.lastRun, alerts: alerts.map(alert => alert.code === input.alertCode
      ? { ...alert, acknowledgedAt: now, acknowledgedBy: actor } : alert) } });
    tx.set(ref.collection("audit").doc(digest(`${input.runId}:${input.alertCode}`)), {
      action: "acknowledge", runId: input.runId, alertCode: input.alertCode, actor, at: now,
    });
  });
  return { acknowledged: true };
}

export async function executeFinancialRoutine(id: string, workspaceId: string, actor: string, scheduled: boolean) {
  const ref = collection.doc(id); const now = new Date(); const instant = now.toISOString();
  const leaseId = randomUUID();
  const config = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref); const data = snapshot.data();
    if (!data || data.workspaceId !== workspaceId) forbidden();
    if (scheduled && (!data.enabled || data.nextRunAt > instant)) return null;
    if (data.leaseUntil && data.leaseUntil > instant) return null;
    const request = managementRequestSchema.safeParse(data.request);
    if (!request.success || !["daily", "weekly"].includes(data.cadence)) conflict();
    const day = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
    const runId = digest(`${id}:${data.revision}:${day}`);
    if (data.lastRun?.id === runId) return null;
    tx.update(ref, { leaseId, leaseUntil: new Date(now.getTime() + 180_000).toISOString() });
    return { request: { ...request.data, month: day.slice(0, 7), includeStone: false },
      cadence: data.cadence, revision: data.revision, runId };
  });
  if (!config) return { executed: false };
  try {
    const result = await runManagementAnalysis(config.request, { isDefaultAdmin: true, workspace_id: workspaceId }, AbortSignal.timeout(110_000));
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref); const data = snapshot.data();
      if (data?.leaseId !== leaseId || data.revision !== config.revision) conflict();
      const lastRun = { id: config.runId, at: result.collectedAt, actor,
        month: config.request.month, coverage: result.coverage, alerts: result.alerts.map(alert => ({ ...alert, acknowledgedAt: null })) };
      tx.update(ref, { lastRun, lastErrorCode: null, leaseUntil: null, leaseId: null,
        nextRunAt: new Date(now.getTime() + (config.cadence === "daily" ? 1 : 7) * 86_400_000).toISOString() });
      tx.set(ref.collection("runs").doc(config.runId), lastRun);
    });
    return { executed: true, runId: config.runId };
  } catch (error) {
    await db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (snapshot.data()?.leaseId !== leaseId) return;
      tx.update(ref, { leaseId: null, leaseUntil: null, lastErrorCode: "ANALYSIS_FAILED",
        nextRunAt: new Date(now.getTime() + 86_400_000).toISOString() });
    });
    throw error;
  }
}

export async function runDueFinancialRoutine(workspaceId: string) {
  const due = await collection.where("workspaceId", "==", workspaceId).where("enabled", "==", true)
    .where("nextRunAt", "<=", new Date().toISOString()).orderBy("nextRunAt").limit(1).get();
  if (due.empty) return { executed: false };
  return executeFinancialRoutine(due.docs[0].id, workspaceId, "financial-scheduler", true);
}
