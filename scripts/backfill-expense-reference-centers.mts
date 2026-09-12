/**
 * Preenche o centro de referência sem alterar o rateio nem o estado financeiro.
 * O modo padrão é somente leitura.
 *
 * Uso:
 *   node --import tsx scripts/backfill-expense-reference-centers.mts
 *   node --import tsx scripts/backfill-expense-reference-centers.mts --apply
 */
import { isDeepStrictEqual } from "node:util";

import { config } from "dotenv";
import { FieldPath } from "firebase-admin/firestore";

import {
  ADMIN_REFERENCE_RESULT_CENTER,
  expenseReferenceCenterFields,
  resolveExpenseReferenceCenter,
} from "../src/features/financial/lib/expense-reference-center";

config({ path: ".env.local" });
const { financialDbAdmin } = await import("../src/lib/firebase-financial-admin");

const apply = process.argv.includes("--apply");
const maxDocsArgument = process.argv.find((argument) => argument.startsWith("--max-docs="));
const maxDocs = Number(maxDocsArgument?.split("=")[1] ?? 10_000);
if (!Number.isSafeInteger(maxDocs) || maxDocs < 1 || maxDocs > 100_000) {
  throw new Error("--max-docs deve ser um inteiro entre 1 e 100000.");
}

const pageSize = 250;
const legacyAdministrativeNames = new Set([
  "centro administrativo - renascença",
  "centro de distribuição - matriz",
]);

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("pt-BR") : "";
}

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
  throw new Error(`${label} excedeu o limite de ${maxDocs} documentos.`);
}

const [expenseDocuments, resultCenterDocuments, bankAccountDocuments] = await Promise.all([
  readBounded(financialDbAdmin.collection("expenses"), "expenses"),
  readBounded(financialDbAdmin.collection("resultCenters"), "resultCenters"),
  readBounded(financialDbAdmin.collection("bankAccounts"), "bankAccounts"),
]);
const namesById = Object.fromEntries(resultCenterDocuments.map((document) => [
  document.id,
  String(document.get("name") || document.id).trim(),
]));
const centersByName = new Map(resultCenterDocuments.map((document) => [
  normalized(document.get("name")),
  { id: document.id, name: String(document.get("name") || document.id).trim() },
]));
const expensesById = new Map(expenseDocuments.map((document) => [document.id, document.data()]));
const bankAccountCenterById = new Map(bankAccountDocuments.flatMap((document) => {
  const resultCenterId = String(document.get("resultCenterId") || "").trim();
  if (!resultCenterId) return [];
  return [[document.id, {
    id: resultCenterId,
    name: namesById[resultCenterId] || resultCenterId,
  }] as const];
}));

function targetCenter(expense: Record<string, unknown>, visited = new Set<string>()) {
  const hasExplicitReference = normalized(expense.referenceResultCenterId)
    || normalized(expense.referenceResultCenterName);
  if (hasExplicitReference) return resolveExpenseReferenceCenter(expense, namesById);
  if (expense.isApportioned === true) return ADMIN_REFERENCE_RESULT_CENTER;

  const legacy = resolveExpenseReferenceCenter(expense, namesById);
  if (legacy) {
    const knownById = legacy.id && namesById[legacy.id]
      ? { id: legacy.id, name: namesById[legacy.id] }
      : null;
    if (knownById) return knownById;
    if (legacyAdministrativeNames.has(normalized(legacy.name))) return ADMIN_REFERENCE_RESULT_CENTER;
    const knownByName = centersByName.get(normalized(legacy.name));
    if (knownByName) return knownByName;
  }

  const replacementId = String(expense.replacedByExpenseId || "").trim();
  if (replacementId && !visited.has(replacementId)) {
    const replacement = expensesById.get(replacementId);
    if (replacement) {
      const inherited = targetCenter(replacement, new Set([...visited, replacementId]));
      if (inherited) return inherited;
    }
  }
  const bankAccountId = String(expense.plannedBankAccountId || "").trim();
  return bankAccountCenterById.get(bankAccountId) ?? null;
}

const changes = expenseDocuments.flatMap((document) => {
  const data = document.data();
  const center = targetCenter(data);
  if (!center) return [];
  const patch = expenseReferenceCenterFields(center);
  if (
    data.referenceResultCenterId === patch.referenceResultCenterId
    && data.referenceResultCenterName === patch.referenceResultCenterName
  ) return [];
  return [{
    id: document.id,
    ref: document.ref,
    status: String(data.status || "unknown"),
    provisionType: String(data.provisionType || "none"),
    isApportioned: data.isApportioned === true,
    before: data,
    patch,
  }];
});
const unresolved = expenseDocuments.flatMap((document) => targetCenter(document.data()) ? [] : [{
  id: document.id,
  status: String(document.get("status") || "unknown"),
  description: String(document.get("description") || ""),
}]);

if (apply) {
  for (let index = 0; index < changes.length; index += 400) {
    const batch = financialDbAdmin.batch();
    for (const change of changes.slice(index, index + 400)) {
      batch.set(change.ref, change.patch, { merge: true });
    }
    await batch.commit();
  }

  for (let index = 0; index < changes.length; index += 400) {
    const group = changes.slice(index, index + 400);
    const snapshots = await financialDbAdmin.getAll(...group.map((change) => change.ref));
    snapshots.forEach((snapshot, snapshotIndex) => {
      const change = group[snapshotIndex]!;
      const after = snapshot.data();
      if (!after) throw new Error(`A despesa ${change.id} não existe após a migração.`);
      const beforeWithoutReference = { ...change.before };
      const afterWithoutReference = { ...after };
      delete beforeWithoutReference.referenceResultCenterId;
      delete beforeWithoutReference.referenceResultCenterName;
      delete afterWithoutReference.referenceResultCenterId;
      delete afterWithoutReference.referenceResultCenterName;
      if (!isDeepStrictEqual(beforeWithoutReference, afterWithoutReference)) {
        throw new Error(`A migração alterou campos financeiros da despesa ${change.id}.`);
      }
      if (
        after.referenceResultCenterId !== change.patch.referenceResultCenterId
        || after.referenceResultCenterName !== change.patch.referenceResultCenterName
      ) throw new Error(`Falha ao validar o centro de referência da despesa ${change.id}.`);
    });
  }
}

const byStatus = Object.fromEntries(Array.from(
  changes.reduce((totals, change) => totals.set(change.status, (totals.get(change.status) || 0) + 1), new Map<string, number>()),
).sort(([left], [right]) => left.localeCompare(right)));
const byProvisionType = Object.fromEntries(Array.from(
  changes.reduce((totals, change) => totals.set(change.provisionType, (totals.get(change.provisionType) || 0) + 1), new Map<string, number>()),
).sort(([left], [right]) => left.localeCompare(right)));

console.log(JSON.stringify({
  mode: apply ? "APPLIED_AND_VERIFIED" : "DRY_RUN",
  scanned: expenseDocuments.length,
  resultCentersScanned: resultCenterDocuments.length,
  bankAccountsScanned: bankAccountDocuments.length,
  changed: changes.length,
  apportionedChanged: changes.filter((change) => change.isApportioned).length,
  byStatus,
  byProvisionType,
  unresolved,
}, null, 2));
