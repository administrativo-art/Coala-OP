import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const FINANCIAL_DATABASE = process.env.FINANCIAL_FIRESTORE_DATABASE || "coala-financeiro";
const MAIN_DATABASE = process.env.MAIN_FIRESTORE_DATABASE || "coala";
const CUTOFF_ISO = process.env.FINANCIAL_CUTOVER_DATE || "2026-08-01T00:00:00-03:00";
const DEFAULT_RUN_ID = "cutover-2026-08-01-v1";
const ARCHIVE_ROOT = "financialArchiveRuns";
const MAX_BATCH_OPERATIONS = 400;

const args = new Set(process.argv.slice(2));
const mode = ["--archive", "--execute", "--verify", "--restore"].find((item) => args.has(item)) || "--dry-run";
const runIdArgument = process.argv.slice(2).find((item) => item.startsWith("--run-id="));
const runId = runIdArgument?.slice("--run-id=".length) || DEFAULT_RUN_ID;
const cutoff = new Date(CUTOFF_ISO);

const TARGET_COLLECTIONS = ["expenses", "payments", "transactions", "importDrafts", "bankPaymentRequests"];
const TERMINAL_PAYMENT_REQUEST_STATUSES = new Set(["paid", "cancelled", "failed", "rejected"]);

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) return cert(JSON.parse(raw));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function getApp() {
  return getApps().find((item) => item.name === "financial-cutover-2026-08") ??
    initializeApp({ credential: loadCredential(), projectId: PROJECT_ID }, "financial-cutover-2026-08");
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function firstDate(row, fields) {
  for (const field of fields) {
    const date = asDate(row[field]);
    if (date) return date;
  }
  return null;
}

export function shouldKeepExpenseActive(row, cutoffDate = cutoff) {
  const dueDate = asDate(row.dueDate);
  return row.originModule === "purchasing" && row.status !== "cancelled" && !!dueDate && dueDate >= cutoffDate;
}

export function shouldArchiveDocument(collection, row, cutoffDate = cutoff) {
  if (collection === "expenses") return !shouldKeepExpenseActive(row, cutoffDate);
  if (collection === "importDrafts") {
    const date = firstDate(row, ["createdAt", "updatedAt"]);
    return row.status === "discarded" || !date || date < cutoffDate;
  }
  if (collection === "payments") {
    const date = firstDate(row, ["paymentDate", "paidAt", "date", "createdAt"]);
    return !date || date < cutoffDate;
  }
  if (collection === "transactions") {
    const date = firstDate(row, ["date", "transactionDate", "competenceDate", "createdAt"]);
    return !date || date < cutoffDate;
  }
  if (collection === "bankPaymentRequests") {
    const date = firstDate(row, ["paidAt", "scheduledFor", "createdAt"]);
    return TERMINAL_PAYMENT_REQUEST_STATUSES.has(row.status) && (!date || date < cutoffDate);
  }
  return false;
}

function canonicalize(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Timestamp) {
    return { __type: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) return { __type: "date", value: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __type: "bytes", value: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    if (typeof value.path === "string" && value.firestore) return { __type: "reference", path: value.path };
    if (typeof value.latitude === "number" && typeof value.longitude === "number") {
      return { __type: "geopoint", latitude: value.latitude, longitude: value.longitude };
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function checksum(data) {
  return createHash("sha256").update(JSON.stringify(canonicalize(data))).digest("hex");
}

function summarizeSelection(selection) {
  return Object.fromEntries(
    Object.entries(selection).map(([collection, items]) => [collection, { archive: items.archive.length, keep: items.keep.length }]),
  );
}

async function loadSelection(financialDb) {
  const selection = {};
  for (const collection of TARGET_COLLECTIONS) {
    const snapshot = await financialDb.collection(collection).get();
    const rows = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data(), ref: doc.ref }));
    const withSubcollections = [];
    for (const row of rows) {
      const children = await row.ref.listCollections();
      if (children.length > 0) withSubcollections.push({ id: row.id, collections: children.map((item) => item.id) });
    }
    if (withSubcollections.length > 0) {
      throw new Error(`${collection} contém subcoleções não suportadas: ${JSON.stringify(withSubcollections)}`);
    }
    selection[collection] = {
      archive: rows.filter((row) => shouldArchiveDocument(collection, row.data)),
      keep: rows.filter((row) => !shouldArchiveDocument(collection, row.data)),
    };
  }
  return selection;
}

async function loadPurchaseLinkSelection(mainDb, archivedExpenseIds, activeExpenseIds) {
  const [ordersSnapshot, financialsSnapshot] = await Promise.all([
    mainDb.collection("purchase_orders").get(),
    mainDb.collection("purchase_financials").get(),
  ]);
  const all = [
    ...ordersSnapshot.docs.map((doc) => ({ collection: "purchase_orders", id: doc.id, data: doc.data(), ref: doc.ref })),
    ...financialsSnapshot.docs.map((doc) => ({ collection: "purchase_financials", id: doc.id, data: doc.data(), ref: doc.ref })),
  ];

  return all.filter((row) => {
    const linkedExpenseId = row.data.linkedExpenseId;
    if (typeof linkedExpenseId !== "string" || !linkedExpenseId) return false;
    return archivedExpenseIds.has(linkedExpenseId) || !activeExpenseIds.has(linkedExpenseId);
  });
}

function archiveRunRef(financialDb) {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/i.test(runId)) throw new Error(`run-id inválido: ${runId}`);
  return financialDb.collection(ARCHIVE_ROOT).doc(runId);
}

async function commitOperations(operations) {
  for (let offset = 0; offset < operations.length; offset += MAX_BATCH_OPERATIONS) {
    const batch = operations[offset].ref.firestore.batch();
    for (const operation of operations.slice(offset, offset + MAX_BATCH_OPERATIONS)) {
      if (operation.type === "set") batch.set(operation.ref, operation.data, operation.options || {});
      else if (operation.type === "update") batch.update(operation.ref, operation.data);
      else if (operation.type === "delete") batch.delete(operation.ref);
    }
    await batch.commit();
  }
}

function manifestSelection(selection) {
  return Object.fromEntries(
    Object.entries(selection).map(([collection, items]) => [
      collection,
      {
        archive: items.archive.map((row) => ({ id: row.id, checksum: checksum(row.data) })),
        keep: items.keep.map((row) => ({ id: row.id, checksum: checksum(row.data) })),
      },
    ]),
  );
}

function purchaseLinkBackup(row) {
  const fields = ["linkedExpenseId", "archivedLinkedExpenseId", "financialArchiveRunId", "financialExpenseArchivedAt"];
  return {
    sourceCollection: row.collection,
    sourceId: row.id,
    fields: Object.fromEntries(
      fields.map((field) => [field, { present: Object.prototype.hasOwnProperty.call(row.data, field), value: row.data[field] ?? null }]),
    ),
  };
}

async function archive(financialDb, mainDb, selection, linkSelection) {
  const runRef = archiveRunRef(financialDb);
  const existing = await runRef.get();
  if (existing.exists && !["preparing", "verified"].includes(existing.data()?.state)) {
    throw new Error(`O arquivo ${runId} já existe no estado ${existing.data()?.state}.`);
  }

  const now = Timestamp.now();
  const manifest = manifestSelection(selection);
  await runRef.set(
    {
      state: "preparing",
      projectId: PROJECT_ID,
      financialDatabase: FINANCIAL_DATABASE,
      mainDatabase: MAIN_DATABASE,
      cutoff: Timestamp.fromDate(cutoff),
      createdAt: existing.data()?.createdAt ?? now,
      updatedAt: now,
      policy: "archive-all-except-purchasing-due-from-cutoff",
      manifest,
      summary: summarizeSelection(selection),
      purchaseLinkCount: linkSelection.length,
    },
    { merge: true },
  );

  const operations = [];
  for (const [collection, items] of Object.entries(selection)) {
    for (const row of items.archive) {
      operations.push({ type: "set", ref: runRef.collection(collection).doc(row.id), data: row.data });
    }
  }
  for (const row of linkSelection) {
    const archiveId = `${row.collection}__${row.id}`;
    operations.push({ type: "set", ref: runRef.collection("purchaseLinks").doc(archiveId), data: purchaseLinkBackup(row) });
  }
  await commitOperations(operations);

  await verifyArchiveDocuments(runRef, manifest, linkSelection.length);
  await runRef.set({ state: "verified", verifiedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
}

async function verifyArchiveDocuments(runRef, manifest, expectedPurchaseLinks) {
  for (const [collection, entry] of Object.entries(manifest)) {
    const snapshot = await runRef.collection(collection).get();
    const expected = new Map(entry.archive.map((item) => [item.id, item.checksum]));
    if (snapshot.size !== expected.size) {
      throw new Error(`Arquivo ${collection}: esperado ${expected.size}, encontrado ${snapshot.size}.`);
    }
    for (const doc of snapshot.docs) {
      if (checksum(doc.data()) !== expected.get(doc.id)) throw new Error(`Checksum divergente no arquivo ${collection}/${doc.id}.`);
    }
  }
  const links = await runRef.collection("purchaseLinks").count().get();
  if (links.data().count !== expectedPurchaseLinks) {
    throw new Error(`Arquivo purchaseLinks: esperado ${expectedPurchaseLinks}, encontrado ${links.data().count}.`);
  }
}

async function verifySourcesBeforeDelete(financialDb, manifest) {
  for (const [collection, entry] of Object.entries(manifest)) {
    for (const item of entry.archive) {
      const doc = await financialDb.collection(collection).doc(item.id).get();
      if (!doc.exists) throw new Error(`Documento fonte ausente antes da exclusão: ${collection}/${item.id}.`);
      if (checksum(doc.data()) !== item.checksum) throw new Error(`Documento fonte alterado após o arquivo: ${collection}/${item.id}.`);
    }
  }
}

async function execute(financialDb, mainDb) {
  const runRef = archiveRunRef(financialDb);
  const runSnapshot = await runRef.get();
  if (!runSnapshot.exists || runSnapshot.data()?.state !== "verified") {
    throw new Error(`O arquivo ${runId} precisa estar no estado verified antes da execução.`);
  }
  const run = runSnapshot.data();
  await verifyArchiveDocuments(runRef, run.manifest, run.purchaseLinkCount);
  await verifySourcesBeforeDelete(financialDb, run.manifest);

  await runRef.set({ state: "executing", executionStartedAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });

  const deleteOperations = [];
  for (const [collection, entry] of Object.entries(run.manifest)) {
    for (const item of entry.archive) {
      deleteOperations.push({ type: "delete", ref: financialDb.collection(collection).doc(item.id) });
    }
  }
  const linkSnapshot = await runRef.collection("purchaseLinks").get();
  const linkOperations = linkSnapshot.docs.map((doc) => {
    const backup = doc.data();
    const linkedExpenseId = backup.fields.linkedExpenseId.value;
    return {
      type: "update",
      ref: mainDb.collection(backup.sourceCollection).doc(backup.sourceId),
      data: {
        linkedExpenseId: FieldValue.delete(),
        archivedLinkedExpenseId: linkedExpenseId,
        financialArchiveRunId: runId,
        financialExpenseArchivedAt: Timestamp.now(),
      },
    };
  });
  try {
    await commitOperations(linkOperations);
    await commitOperations(deleteOperations);
    await runRef.set(
      {
        state: "executed",
        executedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        deletedDocumentCount: deleteOperations.length,
        updatedPurchaseLinkCount: linkOperations.length,
      },
      { merge: true },
    );
  } catch (error) {
    await runRef.set(
      {
        state: "execute_failed",
        executionFailedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        executionError: error instanceof Error ? error.message : String(error),
      },
      { merge: true },
    );
    throw error;
  }
}

async function verify(financialDb, mainDb) {
  const runRef = archiveRunRef(financialDb);
  const runSnapshot = await runRef.get();
  if (!runSnapshot.exists) throw new Error(`Arquivo ${runId} não encontrado.`);
  const run = runSnapshot.data();
  await verifyArchiveDocuments(runRef, run.manifest, run.purchaseLinkCount);

  const remainingArchivedSources = [];
  for (const [collection, entry] of Object.entries(run.manifest)) {
    for (const item of entry.archive) {
      if ((await financialDb.collection(collection).doc(item.id).get()).exists) remainingArchivedSources.push(`${collection}/${item.id}`);
    }
  }
  const activeExpenses = await financialDb.collection("expenses").get();
  const invalidActiveExpenses = activeExpenses.docs
    .filter((doc) => !shouldKeepExpenseActive(doc.data()))
    .map((doc) => doc.id);
  const [orders, financials] = await Promise.all([
    mainDb.collection("purchase_orders").get(),
    mainDb.collection("purchase_financials").get(),
  ]);
  const activeExpenseIds = new Set(activeExpenses.docs.map((doc) => doc.id));
  const brokenLinks = [...orders.docs, ...financials.docs]
    .filter((doc) => typeof doc.data().linkedExpenseId === "string" && doc.data().linkedExpenseId)
    .filter((doc) => !activeExpenseIds.has(doc.data().linkedExpenseId))
    .map((doc) => doc.ref.path);

  const result = {
    runId,
    state: run.state,
    archiveSummary: run.summary,
    activeExpenseCount: activeExpenses.size,
    invalidActiveExpenses,
    remainingArchivedSources,
    brokenLinks,
  };
  console.log(JSON.stringify(result, null, 2));
  if (run.state === "executed" && (invalidActiveExpenses.length || remainingArchivedSources.length || brokenLinks.length)) {
    throw new Error("A verificação pós-corte encontrou divergências.");
  }
}

function restoreFieldUpdate(backup) {
  const update = {};
  for (const [field, state] of Object.entries(backup.fields)) {
    update[field] = state.present ? state.value : FieldValue.delete();
  }
  return update;
}

async function restore(financialDb, mainDb) {
  const runRef = archiveRunRef(financialDb);
  const runSnapshot = await runRef.get();
  if (!runSnapshot.exists || !["executed", "executing", "execute_failed"].includes(runSnapshot.data()?.state)) {
    throw new Error(`O arquivo ${runId} precisa estar em estado de execução para restauração.`);
  }
  const run = runSnapshot.data();
  await verifyArchiveDocuments(runRef, run.manifest, run.purchaseLinkCount);

  const restoreOperations = [];
  for (const [collection, entry] of Object.entries(run.manifest)) {
    for (const item of entry.archive) {
      const archived = await runRef.collection(collection).doc(item.id).get();
      restoreOperations.push({ type: "set", ref: financialDb.collection(collection).doc(item.id), data: archived.data() });
    }
  }
  await commitOperations(restoreOperations);

  const linkSnapshot = await runRef.collection("purchaseLinks").get();
  const linkOperations = linkSnapshot.docs.map((doc) => {
    const backup = doc.data();
    return {
      type: "update",
      ref: mainDb.collection(backup.sourceCollection).doc(backup.sourceId),
      data: restoreFieldUpdate(backup),
    };
  });
  await commitOperations(linkOperations);
  await runRef.set({ state: "restored", restoredAt: Timestamp.now(), updatedAt: Timestamp.now() }, { merge: true });
}

async function main() {
  if (Number.isNaN(cutoff.getTime())) throw new Error(`Data de corte inválida: ${CUTOFF_ISO}`);
  const app = getApp();
  const financialDb = getFirestore(app, FINANCIAL_DATABASE);
  const mainDb = getFirestore(app, MAIN_DATABASE);

  if (mode === "--execute") return execute(financialDb, mainDb);
  if (mode === "--verify") return verify(financialDb, mainDb);
  if (mode === "--restore") return restore(financialDb, mainDb);

  const selection = await loadSelection(financialDb);
  const archivedExpenseIds = new Set(selection.expenses.archive.map((row) => row.id));
  const activeExpenseIds = new Set(selection.expenses.keep.map((row) => row.id));
  const linkSelection = await loadPurchaseLinkSelection(mainDb, archivedExpenseIds, activeExpenseIds);
  const summary = {
    mode,
    runId,
    cutoff: cutoff.toISOString(),
    collections: summarizeSelection(selection),
    purchaseLinksToArchive: linkSelection.length,
    activeExpenseIds: [...activeExpenseIds].sort(),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (mode === "--archive") await archive(financialDb, mainDb, selection, linkSelection);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error("[financial-cutover] falhou", error);
    process.exitCode = 1;
  });
}
