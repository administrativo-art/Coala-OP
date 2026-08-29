/**
 * Prepara blocos existentes para o histórico de cobranças Inter.
 * O modo padrão é somente leitura; use --execute apenas durante o rollout.
 *
 * Uso:
 *   npm run migrate:cash-deposit-inter
 *   npm run migrate:cash-deposit-inter -- --execute
 */
import { config } from "dotenv";
import { FieldPath } from "firebase-admin/firestore";

config({ path: ".env.local" });
const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");

const execute = process.argv.includes("--execute");
const maxDocsArgument = process.argv.find((argument) => argument.startsWith("--max-docs="));
const maxDocs = Number(maxDocsArgument?.split("=")[1] ?? 5_000);
if (!Number.isSafeInteger(maxDocs) || maxDocs < 1 || maxDocs > 20_000) {
  throw new Error("--max-docs deve ser um inteiro entre 1 e 20000.");
}
const pageSize = 200;

async function readBounded(collection: FirebaseFirestore.CollectionReference, label: string) {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let lastId: string | null = null;
  while (documents.length <= maxDocs) {
    const requestLimit = Math.min(pageSize, maxDocs + 1 - documents.length);
    let query = collection.orderBy(FieldPath.documentId()).limit(requestLimit);
    if (lastId) query = query.startAfter(lastId);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.size < requestLimit) return documents;
    lastId = snapshot.docs.at(-1)?.id ?? null;
  }
  throw new Error(`${label} excedeu o limite de ${maxDocs} documentos. Revise --max-docs antes de continuar.`);
}

const [batchDocuments, adjustmentDocuments, cobrancaDocuments] = await Promise.all([
  readBounded(financialDbAdmin.collection("cashDepositBatches"), "cashDepositBatches"),
  readBounded(financialDbAdmin.collection("cashDepositAdjustments"), "cashDepositAdjustments"),
  readBounded(financialDbAdmin.collection("interCobrancas"), "interCobrancas"),
]);
const batchChanges = batchDocuments.flatMap((document) => {
  const data = document.data();
  const patch: Record<string, unknown> = {};
  if (!Array.isArray(data.interCobrancaIds)) {
    patch.interCobrancaIds = typeof data.interCobrancaId === "string" && data.interCobrancaId
      ? [data.interCobrancaId]
      : [];
  }
  if (!("bankWarning" in data)) patch.bankWarning = null;
  if (!("lastBankSyncAt" in data)) patch.lastBankSyncAt = null;
  if (!("ledgerTransactionId" in data)) patch.ledgerTransactionId = null;
  return Object.keys(patch).length > 0
    ? [{ collection: "cashDepositBatches", id: document.id, ref: document.ref, patch }]
    : [];
});
const adjustmentChanges = adjustmentDocuments.flatMap((document) => {
  const data = document.data();
  if (Array.isArray(data.targetBatchIds)) return [];
  return [{
    collection: "cashDepositAdjustments",
    id: document.id,
    ref: document.ref,
    patch: { targetBatchIds: [] },
  }];
});
const cobrancaChanges = cobrancaDocuments.flatMap((document) => {
  const data = document.data();
  const patch: Record<string, unknown> = {};
  if (!("ledgerTransactionId" in data)) patch.ledgerTransactionId = null;
  if (!("ledgerPostedAt" in data)) patch.ledgerPostedAt = null;
  return Object.keys(patch).length > 0
    ? [{ collection: "interCobrancas", id: document.id, ref: document.ref, patch }]
    : [];
});
const changes = [...batchChanges, ...adjustmentChanges, ...cobrancaChanges];

if (execute) {
  for (let index = 0; index < changes.length; index += 400) {
    const batch = financialDbAdmin.batch();
    for (const change of changes.slice(index, index + 400)) {
      batch.set(change.ref, change.patch, { merge: true });
    }
    await batch.commit();
  }
}

console.log(JSON.stringify({
  mode: execute ? "EXECUTED" : "DRY_RUN",
  scanned: batchDocuments.length + adjustmentDocuments.length + cobrancaDocuments.length,
  readCeilingPerCollection: maxDocs + 1,
  changed: changes.length,
  documents: changes.map(({ collection, id, patch }) => ({ collection, id, fields: Object.keys(patch) })),
}, null, 2));
