/**
 * Prepara blocos existentes para o histórico de cobranças Inter.
 * O modo padrão é somente leitura; use --execute apenas durante o rollout.
 *
 * Uso:
 *   npm run migrate:cash-deposit-inter
 *   npm run migrate:cash-deposit-inter -- --execute
 */
import { config } from "dotenv";

config({ path: ".env.local" });
const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");

const execute = process.argv.includes("--execute");
const [batchSnapshot, adjustmentSnapshot, cobrancaSnapshot] = await Promise.all([
  financialDbAdmin.collection("cashDepositBatches").get(),
  financialDbAdmin.collection("cashDepositAdjustments").get(),
  financialDbAdmin.collection("interCobrancas").get(),
]);
const batchChanges = batchSnapshot.docs.flatMap((document) => {
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
const adjustmentChanges = adjustmentSnapshot.docs.flatMap((document) => {
  const data = document.data();
  if (Array.isArray(data.targetBatchIds)) return [];
  return [{
    collection: "cashDepositAdjustments",
    id: document.id,
    ref: document.ref,
    patch: { targetBatchIds: [] },
  }];
});
const cobrancaChanges = cobrancaSnapshot.docs.flatMap((document) => {
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
  scanned: batchSnapshot.size + adjustmentSnapshot.size + cobrancaSnapshot.size,
  changed: changes.length,
  documents: changes.map(({ collection, id, patch }) => ({ collection, id, fields: Object.keys(patch) })),
}, null, 2));
