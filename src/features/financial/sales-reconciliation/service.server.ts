import "server-only";

import { createHash } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";

import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { serializeFinancialValue } from "@/features/financial/lib/server-access";
import {
  prepareCanonicalSalesImportBatch,
  SalesImportValidationError,
} from "./ingestion.server";
import {
  salesReconciliationCaseId,
  salesReconciliationCaseIdentityId,
  salesReconciliationControlId,
  salesReconciliationPeriodId,
  stoneIngestionRunId,
} from "./identity.server";
import { suggestSalesReconciliationCases } from "./matching";
import type {
  PdvPaymentFact,
  SalesMatchFact,
  SalesReconciliationReviewStatus,
  StoneSaleTransaction,
  SuggestedSalesReconciliationCase,
} from "./types";

const MAX_MAPPINGS = 100;
const MAX_FACTS_PER_SOURCE_PERIOD = 5_000;
const FACT_ROWS_PER_BATCH = 200;
const CASES_PER_BATCH = 400;
const RUN_LEASE_MS = 5 * 60 * 1_000;

export class SalesReconciliationLimitError extends Error {
  constructor(readonly source: "mappings" | "pdv" | "stone" | "periods") {
    super("O volume de conciliação ultrapassa o limite operacional configurado.");
    this.name = "SalesReconciliationLimitError";
  }
}

export class SalesReconciliationConflictError extends Error {
  constructor(message = "Já existe uma execução de conciliação em andamento.") {
    super(message);
    this.name = "SalesReconciliationConflictError";
  }
}

export class SalesReconciliationAccessError extends Error {
  constructor(message = "O lote contém unidade fora do escopo permitido.") {
    super(message);
    this.name = "SalesReconciliationAccessError";
  }
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => (
    values.slice(index * size, (index + 1) * size)
  ));
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function caseFingerprint(value: SuggestedSalesReconciliationCase) {
  return sha256({
    pdvFactIds: value.pdvFactIds,
    stoneSaleIds: value.stoneSaleIds,
    pdvGrossAmountCents: value.pdvGrossAmountCents,
    stoneGrossAmountCents: value.stoneGrossAmountCents,
    kind: value.kind,
    matchBasis: value.matchBasis,
  });
}

function toMatchFact(value: PdvPaymentFact | StoneSaleTransaction): SalesMatchFact {
  if ("couponId" in value) {
    return {
      id: value.id,
      source: "pdv",
      workspaceId: value.workspaceId,
      kioskId: value.kioskId,
      businessDate: value.businessDate,
      soldAt: value.soldAt,
      channel: value.channel,
      grossAmountCents: value.grossAmountCents,
      status: value.status,
      couponId: value.couponId,
      identifiers: value.identifiers,
    };
  }
  return {
    id: value.id,
    source: "stone",
    workspaceId: value.workspaceId,
    kioskId: value.kioskId,
    businessDate: value.businessDate,
    soldAt: value.soldAt,
    channel: value.channel,
    grossAmountCents: value.grossAmountCents,
    status: value.status,
    identifiers: value.identifiers,
  };
}

function periodCases(pdv: PdvPaymentFact[], stone: StoneSaleTransaction[]) {
  const groups = new Map<string, { pdv: SalesMatchFact[]; stone: SalesMatchFact[] }>();
  for (const fact of pdv.map(toMatchFact)) {
    const key = `${fact.businessDate}:${fact.channel}`;
    const group = groups.get(key) ?? { pdv: [], stone: [] };
    group.pdv.push(fact);
    groups.set(key, group);
  }
  for (const fact of stone.map(toMatchFact)) {
    const key = `${fact.businessDate}:${fact.channel}`;
    const group = groups.get(key) ?? { pdv: [], stone: [] };
    group.stone.push(fact);
    groups.set(key, group);
  }
  return [...groups.keys()].sort().flatMap((key) => {
    const group = groups.get(key)!;
    return suggestSalesReconciliationCases({ pdvFacts: group.pdv, stoneSales: group.stone });
  });
}

async function listActiveMappings(workspaceId: string) {
  const snapshot = await financialDbAdmin.collection("stoneMerchantMappings")
    .where("workspaceId", "==", workspaceId)
    .orderBy(FieldPath.documentId())
    .limit(MAX_MAPPINGS + 1)
    .get();
  if (snapshot.size > MAX_MAPPINGS) throw new SalesReconciliationLimitError("mappings");
  return snapshot.docs.flatMap((document) => {
    const data = document.data();
    if (data.status !== "active" || typeof data.kioskId !== "string") return [];
    const stoneCodes = Array.isArray(data.stoneCodes)
      ? data.stoneCodes.map(String)
      : typeof data.stoneCode === "string" ? [data.stoneCode] : [];
    const terminalIds = Array.isArray(data.terminalIds) ? data.terminalIds.map(String) : [];
    return [{
      kioskId: data.kioskId,
      kioskName: typeof data.kioskName === "string" ? data.kioskName : null,
      stoneCodes: new Set(stoneCodes.map((value) => value.trim().toUpperCase())),
      terminalIds: new Set(terminalIds.map((value) => value.trim().toUpperCase())),
    }];
  });
}

async function resolveStoneMappings(workspaceId: string, rows: StoneSaleTransaction[]) {
  if (rows.every((row) => row.kioskId)) return rows;
  const mappings = await listActiveMappings(workspaceId);
  return rows.map((row) => {
    if (row.kioskId) return row;
    const stoneCode = row.stoneCode.trim().toUpperCase();
    const terminalId = row.identifiers.terminalId?.trim().toUpperCase() ?? null;
    const candidates = mappings.filter((mapping) => (
      mapping.stoneCodes.has(stoneCode)
      && (mapping.terminalIds.size === 0 || (terminalId !== null && mapping.terminalIds.has(terminalId)))
    ));
    return candidates.length === 1
      ? { ...row, kioskId: candidates[0].kioskId, kioskName: candidates[0].kioskName }
      : row;
  });
}

async function startRun(input: {
  runId: string;
  workspaceId: string;
  source: "pdv" | "stone_sales";
  period: string;
  businessDates: string[];
  rowCount: number;
  duplicateCount: number;
  finalize: boolean;
  actorId: string;
}) {
  const runRef = financialDbAdmin.collection("stoneIngestionRuns").doc(input.runId);
  const now = Timestamp.now();
  const result = await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef);
    const current = snapshot.data() ?? {};
    if (current.status === "completed") return { completed: true, result: current.result ?? null };
    const leaseUntil = current.leaseUntil && typeof current.leaseUntil.toMillis === "function"
      ? current.leaseUntil.toMillis()
      : 0;
    if (current.status === "processing" && leaseUntil > now.toMillis()) {
      throw new SalesReconciliationConflictError();
    }
    transaction.set(runRef, {
      id: input.runId,
      workspaceId: input.workspaceId,
      source: input.source,
      period: input.period,
      businessDates: input.businessDates,
      rowCount: input.rowCount,
      duplicateCount: input.duplicateCount,
      finalize: input.finalize,
      status: "processing",
      actorId: input.actorId,
      attemptCount: Number(current.attemptCount ?? 0) + 1,
      leaseUntil: Timestamp.fromMillis(now.toMillis() + RUN_LEASE_MS),
      createdAt: current.createdAt ?? now,
      updatedAt: now,
    }, { merge: true });
    return { completed: false, result: null };
  });
  return { ...result, runRef };
}

async function persistFacts(input: {
  runId: string;
  source: "pdv" | "stone_sales";
  rows: Array<PdvPaymentFact | StoneSaleTransaction>;
}) {
  const collection = input.source === "pdv" ? "pdvPaymentFacts" : "stoneSaleTransactions";
  for (const page of chunks(input.rows, FACT_ROWS_PER_BATCH)) {
    const batch = financialDbAdmin.batch();
    for (const row of page) {
      const reference = financialDbAdmin.collection(collection).doc(row.id);
      batch.set(reference, {
        ...row,
        latestRunId: input.runId,
        updatedAt: Timestamp.now(),
      }, { merge: true });
      batch.set(reference.collection("events").doc(row.sourceHash), {
        ...row,
      });
    }
    await batch.commit();
  }
}

async function loadPeriodSource<T>(input: {
  collection: "pdvPaymentFacts" | "stoneSaleTransactions";
  workspaceId: string;
  period: string;
  source: "pdv" | "stone";
}) {
  const snapshot = await financialDbAdmin.collection(input.collection)
    .where("workspaceId", "==", input.workspaceId)
    .where("period", "==", input.period)
    .orderBy(FieldPath.documentId())
    .limit(MAX_FACTS_PER_SOURCE_PERIOD + 1)
    .get();
  if (snapshot.size > MAX_FACTS_PER_SOURCE_PERIOD) {
    throw new SalesReconciliationLimitError(input.source);
  }
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() } as T));
}

async function getAllByChunks(references: FirebaseFirestore.DocumentReference[]) {
  const snapshots: FirebaseFirestore.DocumentSnapshot[] = [];
  for (const page of chunks(references, 200)) {
    snapshots.push(...await financialDbAdmin.getAll(...page));
  }
  return snapshots;
}

function approvedTotal(rows: Array<PdvPaymentFact | StoneSaleTransaction>) {
  return rows.reduce((sum, row) => sum + (row.status === "approved" ? row.grossAmountCents : 0), 0);
}

function automaticReconciledTotal(input: {
  cases: Array<Pick<SuggestedSalesReconciliationCase, "kind" | "pdvFactIds" | "pdvGrossAmountCents"> & {
    reviewStatus: SalesReconciliationReviewStatus;
  }>;
  pdvById: ReadonlyMap<string, PdvPaymentFact>;
}) {
  return input.cases.reduce((sum, entry) => {
    if (entry.reviewStatus !== "matched_auto" || entry.kind !== "matched") return sum;
    const rows = entry.pdvFactIds.map((id) => input.pdvById.get(id)).filter((row): row is PdvPaymentFact => Boolean(row));
    return rows.every((row) => row.status === "approved")
      ? sum + entry.pdvGrossAmountCents
      : sum;
  }, 0);
}

async function rebuildPeriod(input: { workspaceId: string; period: string; projectionId: string }) {
  const controlRef = financialDbAdmin.collection("revenueReconciliationPeriods")
    .doc(salesReconciliationControlId(input));
  await financialDbAdmin.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(controlRef);
    transaction.set(controlRef, {
      id: controlRef.id,
      workspaceId: input.workspaceId,
      kioskId: null,
      scope: "workspace",
      period: input.period,
      buildingProjectionId: input.projectionId,
      buildStartedAt: Timestamp.now(),
      createdAt: snapshot.data()?.createdAt ?? Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  });

  const [pdv, stone] = await Promise.all([
    loadPeriodSource<PdvPaymentFact>({ collection: "pdvPaymentFacts", workspaceId: input.workspaceId, period: input.period, source: "pdv" }),
    loadPeriodSource<StoneSaleTransaction>({ collection: "stoneSaleTransactions", workspaceId: input.workspaceId, period: input.period, source: "stone" }),
  ]);
  const suggested = periodCases(pdv, stone);
  const identityIds = suggested.map((entry) => salesReconciliationCaseIdentityId({
    workspaceId: input.workspaceId,
    deterministicKey: entry.deterministicKey,
  }));
  const caseRefs = suggested.map((entry) => financialDbAdmin.collection("salesReconciliationCases").doc(
    salesReconciliationCaseId({
      workspaceId: input.workspaceId,
      deterministicKey: entry.deterministicKey,
      projectionId: input.projectionId,
    }),
  ));
  const decisionRefs = identityIds.map((identityId) => financialDbAdmin.collection("salesReconciliationDecisions").doc(identityId));
  const decisions = new Map((await getAllByChunks(decisionRefs)).filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() ?? {}]));
  const activeCases = suggested.map((entry, index) => {
    const id = caseRefs[index].id;
    const identityId = identityIds[index];
    const previous = decisions.get(identityId);
    const sourceFingerprint = caseFingerprint(entry);
    const sourceChanged = Boolean(previous?.sourceFingerprint && previous.sourceFingerprint !== sourceFingerprint);
    const previousStatus = previous?.reviewStatus as SalesReconciliationReviewStatus | undefined;
    const reviewStatus = !sourceChanged && (previousStatus === "resolved" || previousStatus === "ignored")
      ? previousStatus
      : entry.reviewStatus;
    return {
      ...entry,
      id,
      identityId,
      projectionId: input.projectionId,
      sourceFingerprint,
      suggestedReviewStatus: entry.reviewStatus,
      reviewStatus,
      decision: sourceChanged ? null : previous?.decision ?? null,
      sourceChanged,
    };
  });

  for (const page of chunks(activeCases, CASES_PER_BATCH)) {
    const batch = financialDbAdmin.batch();
    for (const entry of page) {
      const reference = financialDbAdmin.collection("salesReconciliationCases").doc(entry.id);
      batch.set(reference, {
        ...entry,
        updatedAt: Timestamp.now(),
        ...(entry.sourceChanged ? { decisionSupersededAt: Timestamp.now() } : {}),
      }, { merge: true });
    }
    await batch.commit();
  }

  const kioskIds = [...new Set([...pdv, ...stone].flatMap((row) => row.kioskId ? [row.kioskId] : []))].sort();
  const pdvById = new Map(pdv.map((row) => [row.id, row]));
  const unitSummaries = kioskIds.map((kioskId) => {
    const unitPdv = pdv.filter((row) => row.kioskId === kioskId);
    const unitStone = stone.filter((row) => row.kioskId === kioskId);
    const unitCases = activeCases.filter((entry) => entry.kioskIds.includes(kioskId));
    const decidedCaseCount = unitCases.filter((entry) => entry.reviewStatus !== "pending_review").length;
    const pendingCaseCount = unitCases.length - decidedCaseCount;
    const pdvGrossAmountCents = approvedTotal(unitPdv);
    const stoneGrossAmountCents = approvedTotal(unitStone);
    return {
      id: salesReconciliationPeriodId({ workspaceId: input.workspaceId, kioskId, period: input.period }),
      workspaceId: input.workspaceId,
      kioskId,
      scope: "unit",
      period: input.period,
      activeProjectionId: input.projectionId,
      pdvFactCount: unitPdv.length,
      stoneSaleCount: unitStone.length,
      caseCount: unitCases.length,
      decidedCaseCount,
      pendingCaseCount,
      coveragePercent: unitCases.length === 0 ? 0 : Math.round((decidedCaseCount / unitCases.length) * 10_000) / 100,
      pdvGrossAmountCents,
      stoneGrossAmountCents,
      differenceAmountCents: stoneGrossAmountCents - pdvGrossAmountCents,
      reconciledRevenueCents: automaticReconciledTotal({ cases: unitCases, pdvById }),
      sourceFingerprint: sha256({
        pdv: unitPdv.map((row) => row.sourceHash).sort(),
        stone: unitStone.map((row) => row.sourceHash).sort(),
      }),
      computedStatus: unitPdv.length === 0 || unitStone.length === 0
        ? "open"
        : pendingCaseCount > 0 ? "partial" : "ready",
    };
  });

  await financialDbAdmin.runTransaction(async (transaction) => {
    const control = await transaction.get(controlRef);
    if (control.data()?.buildingProjectionId !== input.projectionId) {
      throw new SalesReconciliationConflictError("A projeção foi substituída por uma execução mais recente.");
    }
    const periodRefs = unitSummaries.map((summary) => financialDbAdmin.collection("revenueReconciliationPeriods").doc(summary.id));
    const periodSnapshots: FirebaseFirestore.DocumentSnapshot[] = [];
    for (const reference of periodRefs) periodSnapshots.push(await transaction.get(reference));
    const now = Timestamp.now();
    unitSummaries.forEach((summary, index) => {
      const previous = periodSnapshots[index].data() ?? {};
      const status = previous.status === "closed" ? "stale" : summary.computedStatus;
      transaction.set(periodRefs[index], {
        ...summary,
        status,
        createdAt: previous.createdAt ?? now,
        updatedAt: now,
      }, { merge: true });
      transaction.set(financialDbAdmin.collection("revenueMonthlySummaries").doc(summary.id), {
        id: summary.id,
        workspaceId: input.workspaceId,
        kioskId: summary.kioskId,
        period: input.period,
        activeProjectionId: input.projectionId,
        pdvRevenueTotalCents: summary.pdvGrossAmountCents,
        stoneGrossTotalCents: summary.stoneGrossAmountCents,
        reconciledRevenueTotalCents: summary.reconciledRevenueCents,
        differenceAmountCents: summary.differenceAmountCents,
        coveragePercent: summary.coveragePercent,
        periodStatus: status,
        sourceFingerprint: summary.sourceFingerprint,
        updatedAt: now,
      }, { merge: true });
    });
    transaction.set(controlRef, {
      activeProjectionId: input.projectionId,
      buildingProjectionId: null,
      caseCount: activeCases.length,
      pdvFactCount: pdv.length,
      stoneSaleCount: stone.length,
      kioskIds,
      updatedAt: now,
    }, { merge: true });
  });

  return {
    projectionId: input.projectionId,
    pdvFactCount: pdv.length,
    stoneSaleCount: stone.length,
    caseCount: activeCases.length,
    unitCount: unitSummaries.length,
    pendingCaseCount: activeCases.filter((entry) => entry.reviewStatus === "pending_review").length,
  };
}

export async function importCanonicalSalesBatch(raw: unknown, actor: {
  id: string;
  workspaceId: string;
  canAccessKiosk: (kioskId: string) => boolean;
}) {
  const prepared = prepareCanonicalSalesImportBatch(raw);
  if (prepared.workspaceId !== actor.workspaceId) {
    throw new SalesReconciliationAccessError("O workspace do lote não corresponde à sessão autenticada.");
  }
  const runId = stoneIngestionRunId({ workspaceId: prepared.workspaceId, idempotencyKey: prepared.idempotencyKey });
  const started = await startRun({
    runId,
    workspaceId: prepared.workspaceId,
    source: prepared.source,
    period: prepared.period,
    businessDates: prepared.businessDates,
    rowCount: prepared.rows.length,
    duplicateCount: prepared.duplicateCount,
    finalize: prepared.finalize,
    actorId: actor.id,
  });
  if (started.completed) return { runId, idempotent: true, ...(started.result as object ?? {}) };

  try {
    const rows = prepared.source === "stone_sales"
      ? await resolveStoneMappings(prepared.workspaceId, prepared.rows as StoneSaleTransaction[])
      : prepared.rows;
    if (rows.some((row) => row.kioskId && !actor.canAccessKiosk(row.kioskId))) {
      throw new SalesReconciliationAccessError();
    }
    await persistFacts({ runId, source: prepared.source, rows });
    const result = prepared.finalize
      ? await rebuildPeriod({ workspaceId: prepared.workspaceId, period: prepared.period, projectionId: runId })
      : {
          projectionId: null,
          projectionDeferred: true,
          importedFactCount: rows.length,
          duplicateCount: prepared.duplicateCount,
        };
    await started.runRef.set({
      status: "completed",
      leaseUntil: null,
      result,
      completedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
    return { runId, idempotent: false, ...result };
  } catch (error) {
    await started.runRef.set({
      status: "failed",
      leaseUntil: null,
      failureCode: error instanceof SalesReconciliationLimitError
        ? `LIMIT_${error.source.toUpperCase()}`
        : error instanceof SalesImportValidationError ? "VALIDATION" : "UNEXPECTED",
      failedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true }).catch(() => undefined);
    throw error;
  }
}

export async function listSalesReconciliationCases(input: {
  workspaceId: string;
  period: string;
  kioskId?: string;
  status?: SalesReconciliationReviewStatus;
  cursor?: string;
  limit: number;
}) {
  const controlRef = financialDbAdmin.collection("revenueReconciliationPeriods")
    .doc(salesReconciliationControlId({ workspaceId: input.workspaceId, period: input.period }));
  const control = await controlRef.get();
  const projectionId = typeof control.data()?.activeProjectionId === "string"
    ? control.data()?.activeProjectionId as string
    : null;
  if (!projectionId) return { cases: [], periods: [], nextCursor: null, projectionId: null };

  let query: FirebaseFirestore.Query = financialDbAdmin.collection("salesReconciliationCases")
    .where("workspaceId", "==", input.workspaceId)
    .where("period", "==", input.period)
    .where("projectionId", "==", projectionId);
  if (input.kioskId) query = query.where("kioskIds", "array-contains", input.kioskId);
  if (input.status) query = query.where("reviewStatus", "==", input.status);
  query = query.orderBy(FieldPath.documentId());
  if (input.cursor) query = query.startAfter(input.cursor);
  const snapshot = await query.limit(input.limit + 1).get();
  const hasMore = snapshot.size > input.limit;
  const documents = snapshot.docs.slice(0, input.limit);

  let periodDocuments: FirebaseFirestore.DocumentSnapshot[];
  if (input.kioskId) {
    periodDocuments = [await financialDbAdmin.collection("revenueReconciliationPeriods").doc(
      salesReconciliationPeriodId({ workspaceId: input.workspaceId, kioskId: input.kioskId, period: input.period }),
    ).get()];
  } else {
    const periods = await financialDbAdmin.collection("revenueReconciliationPeriods")
      .where("workspaceId", "==", input.workspaceId)
      .where("period", "==", input.period)
      .orderBy(FieldPath.documentId())
      .limit(21)
      .get();
    if (periods.size > 20) throw new SalesReconciliationLimitError("periods");
    periodDocuments = periods.docs.filter((document) => document.data().scope === "unit");
  }

  return serializeFinancialValue({
    cases: documents.map((document) => ({ id: document.id, ...document.data() })),
    periods: periodDocuments.filter((document) => document.exists).map((document) => ({ id: document.id, ...document.data() })),
    nextCursor: hasMore ? documents.at(-1)?.id ?? null : null,
    projectionId,
  });
}
