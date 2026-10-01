import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { financialAgentIdentifier, type FinancialAgentMapping } from "../agent/contracts";
import { financialDateKey } from "../lib/financial-dates";
import { latestPublishedDate } from "../receivables/period-review";
import { listAutomatedSalesReviewMappings } from "./mapping.server";
import { buildSalesReviewAutomationPlan, initialSalesReviewAutomationState, type SalesReviewAutomationState } from "./review-automation";
import { collectDailySalesReview } from "./review-service.server";

const AUTOMATION_COLLECTION = "dailySalesReviewAutomation";
const MAX_WORKSPACES = 10;
const MAX_DATES_PER_RUN = 6;
const CONCURRENCY = 2;
const ACTOR_ID = "system:pdv-stone-review";

const stateSchema = z.object({
  backfillNextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  maintenanceOffset: z.number().int().min(0).max(6),
  lateSweepMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
  lateSweepNextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict();

const controlSchema = z.object({ nextScopeIndex: z.number().int().nonnegative() }).passthrough();

type AutomationScope = {
  workspaceId: string;
  mapping: FinancialAgentMapping;
  stoneCode: string;
};

function fail(code: string, safeMessage: string): never {
  throw new AppError({ code, kind: "DATA_INTEGRITY", safeMessage });
}

export function configuredSalesReviewWorkspaces(value = process.env.STONE_SALES_REVIEW_WORKSPACE_IDS) {
  const items = [...new Set((value ?? "coala").split(",").map(item => item.trim()).filter(Boolean))];
  if (!items.length || items.length > MAX_WORKSPACES || items.some(item => !financialAgentIdentifier.safeParse(item).success)) {
    fail("SALES_REVIEW_AUTOMATION_WORKSPACES_INVALID", "A lista de workspaces da rotina de conciliação está inválida.");
  }
  return items;
}

const scopeId = (scope: AutomationScope) => createHash("sha256")
  .update(JSON.stringify([scope.workspaceId, scope.mapping.id, scope.mapping.kioskId, scope.stoneCode]))
  .digest("hex");

async function listScopes() {
  const scopes: AutomationScope[] = [];
  for (const workspaceId of configuredSalesReviewWorkspaces()) {
    const mappings = await listAutomatedSalesReviewMappings(workspaceId);
    for (const mapping of mappings) {
      for (const stoneCode of mapping.stoneCodes) scopes.push({ workspaceId, mapping, stoneCode });
    }
  }
  return scopes.sort((left, right) => scopeId(left).localeCompare(scopeId(right)));
}

async function runBounded<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    results.push(...await Promise.all(items.slice(index, index + concurrency).map(operation)));
  }
  return results;
}

export async function runAutomatedSalesReviews(options: { now?: Date; signal?: AbortSignal } = {}) {
  const now = options.now ?? new Date();
  const currentDate = financialDateKey(now);
  if (!currentDate) fail("SALES_REVIEW_AUTOMATION_DATE_INVALID", "A rotina não conseguiu determinar a data financeira.");
  const publishedThrough = latestPublishedDate(now);
  const scopes = await listScopes();
  if (!scopes.length) return { consideredScopes: 0, processedScope: null, processedDates: [], statuses: [],
    backfillActive: false, lateSweepActive: false, publishedThrough };

  const controlRef = financialDbAdmin.collection(AUTOMATION_COLLECTION).doc("control");
  const controlDocument = await controlRef.get();
  const parsedControl = controlDocument.exists ? controlSchema.safeParse(controlDocument.data()) : null;
  if (parsedControl && !parsedControl.success) fail("SALES_REVIEW_AUTOMATION_CONTROL_INVALID", "O cursor global da rotina está inválido.");
  const scopeIndex = (parsedControl?.success ? parsedControl.data.nextScopeIndex : 0) % scopes.length;
  const scope = scopes[scopeIndex];
  const id = scopeId(scope);
  const stateRef = financialDbAdmin.collection(AUTOMATION_COLLECTION).doc(`scope-${id}`);
  const stateDocument = await stateRef.get();
  let state: SalesReviewAutomationState = initialSalesReviewAutomationState(Number(currentDate.slice(0, 4)));
  if (stateDocument.exists) {
    const parsed = stateSchema.safeParse(stateDocument.data()?.state);
    if (!parsed.success) fail("SALES_REVIEW_AUTOMATION_STATE_INVALID", "O cursor de histórico da rotina está inválido.");
    state = parsed.data;
  }
  const plan = buildSalesReviewAutomationPlan({
    state,
    publishedThrough,
    currentDate,
    validFrom: scope.mapping.validFrom,
    validTo: scope.mapping.validTo,
    maxDates: MAX_DATES_PER_RUN,
  });
  options.signal?.throwIfAborted();
  const results = await runBounded(plan.dates, CONCURRENCY, async referenceDate => {
    options.signal?.throwIfAborted();
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(110_000)])
      : AbortSignal.timeout(110_000);
    return collectDailySalesReview({ kioskId: scope.mapping.kioskId, mappingId: scope.mapping.id,
      stoneCode: scope.stoneCode, referenceDate }, { isDefaultAdmin: true, workspace_id: scope.workspaceId }, ACTOR_ID, requestSignal);
  });
  options.signal?.throwIfAborted();
  const updatedAt = now.toISOString();
  const batch = financialDbAdmin.batch();
  batch.set(stateRef, { schemaVersion: 1, scope: { workspaceId: scope.workspaceId, mappingId: scope.mapping.id,
    kioskId: scope.mapping.kioskId, stoneCode: scope.stoneCode }, state: plan.nextState,
    lastRunAt: updatedAt, lastDates: plan.dates, updatedAt }, { merge: true });
  batch.set(controlRef, { schemaVersion: 1, nextScopeIndex: (scopeIndex + 1) % scopes.length,
    scopeCount: scopes.length, updatedAt }, { merge: true });
  await batch.commit();
  return {
    consideredScopes: scopes.length,
    processedScope: { workspaceId: scope.workspaceId, mappingId: scope.mapping.id,
      kioskId: scope.mapping.kioskId, stoneCode: scope.stoneCode },
    processedDates: plan.dates,
    statuses: results.map(result => ({ referenceDate: result.scope.referenceDate, status: result.review.status,
      revision: result.review.revision, sourceChanged: result.review.sourceChanged })),
    backfillActive: plan.backfillActive,
    lateSweepActive: plan.lateSweepActive,
    publishedThrough,
  };
}
