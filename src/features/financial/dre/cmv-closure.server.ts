import "server-only";
import { createHash } from "node:crypto";
import { FieldPath, type Transaction } from "firebase-admin/firestore";
import { dbAdmin } from "@/lib/firebase-admin";
import { AppError } from "@/lib/observability/app-error";
import { canAccessUnit } from "@/lib/unit-access";
import type { requireUser } from "@/lib/auth-server";
import type { BaseProduct, ProductSimulationItem, SalesReport } from "@/types";
import { calculateProductCompositionCmv, COMPOSITION_CMV_FORMULA_VERSION, type CompositionCmvResult } from "@/lib/product-composition-cmv";
import { chunkDreSimulationIds, DreSourceLimitError } from "./source-data";
import { canCloseCmvPeriod, cmvClosureInputSchema, type CmvClosureInput, type CmvClosureRecord, type CmvProductSnapshot, type DreCmvPeriod } from "./cmv-closure";

export const CMV_LIMITS = { simulations: 5_000, items: 20_000, ingredients: 10_000,
  closeReports: 500, closeSalesItems: 5_000, closeSimulations: 500, closeItems: 3_000,
  closeIngredients: 2_000, snapshotBytes: 700_000, closeReadBytes: 6_000_000 } as const;
const PAGE_SIZE = 250;
export const CMV_CLOSURE_COLLECTION = "dreCmvClosures";
type Actor = Awaited<ReturnType<typeof requireUser>>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160 && !value.includes("/");
export const cmvClosureId = (workspaceId: string, kioskId: string, period: string) => digest([workspaceId, kioskId, period, "composition"]);
const conflict = (code: string, safeMessage: string): never => { throw new AppError({ code, kind: "CONFLICT", safeMessage }); };
export function cmvCapabilities(context: Actor) {
  const read = context.isDefaultAdmin || (context.permissions.financial?.view === true && context.permissions.financial?.dre === true);
  return { canClose: read && (context.isDefaultAdmin || context.permissions.financial?.cashClosures?.approve === true),
    canReopen: read && (context.isDefaultAdmin || context.permissions.financial?.cashClosures?.reopen === true) };
}
export function assertCmvActionAccess(context: Actor, input: CmvClosureInput) {
  const capabilities = cmvCapabilities(context);
  if (!(input.action === "close" ? capabilities.canClose : capabilities.canReopen)
    || !canAccessUnit(context.userDoc, input.kioskId, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw new AppError({ code: "DRE_CMV_FORBIDDEN", kind: "AUTHORIZATION" });
  }
}

async function getRefs(refs: FirebaseFirestore.DocumentReference[], transaction?: Transaction, fieldMask?: string[]) {
  const documents: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let i = 0; i < refs.length; i += 200) {
    const batch = refs.slice(i, i + 200);
    documents.push(...await (transaction ? transaction.getAll(...batch, ...(fieldMask ? [{ fieldMask }] : [])) : dbAdmin.getAll(...batch, ...(fieldMask ? [{ fieldMask }] : []))));
  }
  return documents;
}
export async function loadCmvClosures(workspaceId: string, kioskIds: string[], periods: string[]) {
  const refs = kioskIds.flatMap(kioskId => periods.map(period => dbAdmin.collection(CMV_CLOSURE_COLLECTION).doc(cmvClosureId(workspaceId, kioskId, period))));
  return (await getRefs(refs)).flatMap(doc => doc.exists ? [doc.data() as CmvClosureRecord] : []);
}

export async function loadCurrentCompositionCosts(simulationIds: string[], transaction?: Transaction) {
  const ids = [...new Set(simulationIds.filter(validId))].sort();
  const limit = transaction ? CMV_LIMITS.closeSimulations : CMV_LIMITS.simulations;
  if (ids.length > limit) throw new DreSourceLimitError("simulations");
  const simulationDocs = await getRefs(ids.map(id => dbAdmin.collection("productSimulations").doc(id)), transaction, ["name"]);
  const existingIds = new Set(simulationDocs.filter(doc => doc.exists).map(doc => doc.id));
  const items: ProductSimulationItem[] = [];
  let readBytes = 0;
  const addBytes = (data: unknown) => { readBytes += Buffer.byteLength(JSON.stringify(data));
    if (transaction && readBytes > CMV_LIMITS.closeReadBytes / 2) throw new DreSourceLimitError("snapshot"); };
  // Random item document IDs: query the simulationId field, never derive item paths or scan the collection.
  for (const group of chunkDreSimulationIds(ids, 30)) {
    let cursor: string | null = null;
    const maximum = transaction ? CMV_LIMITS.closeItems : CMV_LIMITS.items;
    while (true) {
      const pageLimit = Math.min(PAGE_SIZE, maximum + 1 - items.length);
      let query = dbAdmin.collection("productSimulationItems").where("simulationId", "in", group)
        .orderBy(FieldPath.documentId()).limit(pageLimit)
        .select("simulationId", "baseProductId", "quantity", "useDefault", "overrideCostPerUnit", "overrideUnit");
      if (cursor) query = query.startAfter(cursor);
      const page = await (transaction ? transaction.get(query) : query.get());
      for (const doc of page.docs) { const data = doc.data(); addBytes(data); items.push({ ...data, id: doc.id } as ProductSimulationItem); }
      if (items.length > maximum) throw new DreSourceLimitError("compositionItems");
      if (page.size < pageLimit) break;
      cursor = page.docs.at(-1)!.id;
    }
  }
  const ingredientIds = [...new Set(items.map(item => item.baseProductId).filter(validId))].sort();
  if (ingredientIds.length > (transaction ? CMV_LIMITS.closeIngredients : CMV_LIMITS.ingredients)) throw new DreSourceLimitError("ingredients");
  const ingredientDocs = await getRefs(ingredientIds.map(id => dbAdmin.collection("baseProducts").doc(id)), transaction, ["name", "category", "unit", "initialCostPerUnit", "lastEffectivePrice"]);
  const ingredients = new Map(ingredientDocs.flatMap(doc => {
    if (!doc.exists) return [];
    const data = doc.data()!;
    // Keep only cost inputs: inventory maps are irrelevant to this calculation.
    const base = { id: doc.id, name: data.name, category: data.category, unit: data.unit,
      initialCostPerUnit: data.initialCostPerUnit, lastEffectivePrice: data.lastEffectivePrice } as BaseProduct;
    addBytes(base);
    return [[doc.id, base] as const];
  }));
  for (const doc of simulationDocs) if (doc.exists) addBytes(doc.data());
  const bySimulation = new Map<string, ProductSimulationItem[]>();
  for (const item of items) bySimulation.set(item.simulationId, [...(bySimulation.get(item.simulationId) ?? []), item]);
  const costs = new Map<string, CompositionCmvResult>();
  for (const id of ids) {
    const result = calculateProductCompositionCmv(bySimulation.get(id) ?? [], ingredients);
    if (!existingIds.has(id)) { result.complete = false; result.totalCmv = null; result.diagnostics.push("missing_simulation"); }
    costs.set(id, result);
  }
  return { costs, stats: { simulationDocuments: simulationDocs.length, compositionItemDocuments: items.length, ingredientDocuments: ingredientDocs.length } };
}

/** Fingerprints quantities, merchandise and mapping, independent of mutable cost inputs. */
export function salesCmvEvidence(reports: SalesReport[]) {
  const diagnostics: string[] = [];
  const quantities = new Map<string, number>();
  if (!reports.length) diagnostics.push("no_sales_reports");
  const rows = [...reports].sort((a, b) => a.id.localeCompare(b.id)).map(report => {
    if (!Array.isArray(report.items)) diagnostics.push(`invalid_sales_report:${report.id}`);
    const items = (Array.isArray(report.items) ? report.items : []).map(item => {
      if (!item || typeof item !== "object") { diagnostics.push(`invalid_sales_item:${report.id}`); return { sku: null, simulationId: null, quantity: null }; }
      if (!validId(item.simulationId) || !Number.isFinite(item.quantity) || item.quantity <= 0
        || typeof item.sku !== "string" || !item.sku.trim()
        || (item.unitPrice != null && (!Number.isFinite(item.unitPrice) || item.unitPrice < 0))) diagnostics.push(`invalid_sales_item:${report.id}`);
      else quantities.set(item.simulationId, (quantities.get(item.simulationId) ?? 0) + item.quantity);
      return { sku: item.sku ?? null, simulationId: item.simulationId ?? null, quantity: item.quantity ?? null };
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { id: report.id, kioskId: report.kioskId, year: report.year, month: report.month, day: report.day ?? null, items };
  });
  return { rows, salesFingerprint: digest(rows), diagnostics: [...new Set(diagnostics)], quantities };
}
export function buildCmvPeriod(kioskId: string, period: string, reports: SalesReport[],
  costs: ReadonlyMap<string, CompositionCmvResult>, closure?: CmvClosureRecord, now = new Date().toISOString()) {
  const evidence = salesCmvEvidence(reports);
  if (closure?.status === "closed") {
    const sourceChanged = evidence.salesFingerprint !== closure.salesFingerprint;
    const view: DreCmvPeriod = { kioskId, period, status: "closed", revision: closure.revision,
      totalCmv: closure.totalCmv, complete: true, diagnostics: sourceChanged ? ["sales_source_changed"] : [],
      sourceFingerprint: closure.sourceFingerprint, salesFingerprint: evidence.salesFingerprint, sourceChanged,
      closedAt: closure.closedAt, closedBy: closure.closedBy, calculatedAt: closure.referenceAt };
    return { view, products: closure.products };
  }
  const diagnostics = [...evidence.diagnostics];
  const products: CmvProductSnapshot[] = [];
  for (const [simulationId, quantity] of [...evidence.quantities].sort(([a], [b]) => a.localeCompare(b))) {
    const composition = costs.get(simulationId);
    if (!composition?.complete || composition.totalCmv === null) {
      diagnostics.push(...(composition?.diagnostics ?? ["missing_simulation"]).map(code => `${simulationId}:${code}`)); continue;
    }
    products.push({ simulationId, quantity, unitCmv: composition.totalCmv, totalCmv: quantity * composition.totalCmv, composition });
  }
  const total = products.reduce((sum, product) => sum + product.totalCmv, 0);
  if (!Number.isFinite(total)) diagnostics.push("invalid_total");
  const view: DreCmvPeriod = { kioskId, period, status: "open", revision: closure?.revision ?? 0,
    totalCmv: diagnostics.length ? null : total, complete: diagnostics.length === 0, diagnostics,
    sourceFingerprint: digest({ salesFingerprint: evidence.salesFingerprint, products, diagnostics }),
    salesFingerprint: evidence.salesFingerprint, sourceChanged: false, closedAt: null, closedBy: null, calculatedAt: now };
  return { view, products };
}

async function transactionReports(transaction: Transaction, kioskId: string, period: string) {
  const [year, month] = period.split("-").map(Number);
  const reports: SalesReport[] = [];
  let cursor: string | null = null;
  let bytes = 0;
  while (true) {
    const limit = Math.min(PAGE_SIZE, CMV_LIMITS.closeReports + 1 - reports.length);
    let query = dbAdmin.collection("salesReports").where("year", "==", year).where("month", "==", month)
      .where("kioskId", "==", kioskId).orderBy(FieldPath.documentId()).limit(limit)
      .select("year", "month", "day", "kioskId", "items");
    if (cursor) query = query.startAfter(cursor);
    const page = await transaction.get(query);
    for (const doc of page.docs) { const data = doc.data(); bytes += Buffer.byteLength(JSON.stringify(data)); reports.push({ ...data, id: doc.id } as SalesReport); }
    if (reports.length > CMV_LIMITS.closeReports) throw new DreSourceLimitError("reports");
    if (bytes > CMV_LIMITS.closeReadBytes / 2) throw new DreSourceLimitError("snapshot");
    if (page.size < limit) break;
    cursor = page.docs.at(-1)!.id;
  }
  if (reports.reduce((sum, report) => sum + (Array.isArray(report.items) ? report.items.length : 0), 0) > CMV_LIMITS.closeSalesItems) throw new DreSourceLimitError("reports");
  return reports;
}

/** Snapshot, immutable revision and audit share the operational Firestore transaction.
 * Financial revenue/coverage is deliberately NOT claimed to be atomic with these sources. */
export async function mutateCmvClosure(context: Actor, rawInput: CmvClosureInput, now = new Date()) {
  const parsed = cmvClosureInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError({ code: "DRE_CMV_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Confira os dados do congelamento de CMV." });
  const input = parsed.data;
  assertCmvActionAccess(context, input);
  if (!canCloseCmvPeriod(input.period, now)) throw new AppError({ code: "DRE_CMV_PERIOD_INVALID", kind: "VALIDATION", safeMessage: "Selecione uma competência anterior ao mês atual, a partir do início da DRE." });
  const id = cmvClosureId(context.workspace_id, input.kioskId, input.period);
  const ref = dbAdmin.collection(CMV_CLOSURE_COLLECTION).doc(id);
  const actorId = context.decoded.uid;
  const requestFingerprint = digest(input);
  return dbAdmin.runTransaction(async transaction => {
    const document = await transaction.get(ref);
    const previous = document.exists ? document.data() as CmvClosureRecord : undefined;
    if (previous?.lastOperation?.actorId === actorId && previous.lastOperation.requestFingerprint === requestFingerprint) {
      return { status: previous.status, revision: previous.revision, idempotent: true };
    }
    if ((previous?.revision ?? 0) !== input.expectedRevision) conflict("DRE_CMV_REVISION_CONFLICT", "O CMV mudou desde sua consulta. Atualize a DRE.");
    const timestamp = now.toISOString();
    const revision = (previous?.revision ?? 0) + 1;
    const operation = { action: input.action, expectedRevision: input.expectedRevision, actorId, requestFingerprint };
    let next: CmvClosureRecord;
    if (input.action === "reopen") {
      if (!previous || previous.status !== "closed") conflict("DRE_CMV_NOT_CLOSED", "O CMV desta competência não está congelado.");
      next = { ...previous!, status: "open", revision, reopenedAt: timestamp, reopenedBy: actorId, reopenReason: input.reason, lastOperation: operation };
    } else {
      if (previous?.status === "closed") conflict("DRE_CMV_ALREADY_CLOSED", "Reabra o CMV antes de fazer um novo congelamento.");
      const reports = await transactionReports(transaction, input.kioskId, input.period);
      const ids = reports.flatMap(report => Array.isArray(report.items) ? report.items.map(item => item?.simulationId) : []);
      const { costs } = await loadCurrentCompositionCosts(ids, transaction);
      const { view, products } = buildCmvPeriod(input.kioskId, input.period, reports, costs, previous, timestamp);
      if (!view.complete || view.totalCmv === null) conflict("DRE_CMV_INCOMPLETE", "As vendas ou composições estão incompletas. Corrija as pendências antes de congelar o CMV.");
      if (view.sourceFingerprint !== input.expectedSourceFingerprint) conflict("DRE_CMV_SOURCE_CONFLICT", "As vendas ou custos mudaram desde sua conferência. Atualize a DRE.");
      next = { workspaceId: context.workspace_id, kioskId: input.kioskId, period: input.period, criterion: "composition",
        status: "closed", revision, sourceFingerprint: view.sourceFingerprint, salesFingerprint: view.salesFingerprint,
        totalCmv: view.totalCmv!, products, sales: salesCmvEvidence(reports).rows, formulaVersion: COMPOSITION_CMV_FORMULA_VERSION,
        referenceAt: timestamp, closedAt: timestamp, closedBy: actorId, lastOperation: operation };
    }
    if (Buffer.byteLength(JSON.stringify(next)) > CMV_LIMITS.snapshotBytes) throw new DreSourceLimitError("snapshot");
    transaction.set(ref, next);
    transaction.create(ref.collection("revisions").doc(String(revision)), next);
    transaction.create(ref.collection("audit").doc(String(revision)), { action: input.action, actorId, at: timestamp,
      revision, previousRevision: previous?.revision ?? 0, workspaceId: context.workspace_id, kioskId: input.kioskId,
      period: input.period, reason: input.action === "reopen" ? input.reason : null,
      salesReviewed: input.action === "close", sourceFingerprint: next.sourceFingerprint,
      costBasis: "current_at_manual_freeze", financialRevenueAtomic: false });
    return { status: next.status, revision, idempotent: false };
  });
}
