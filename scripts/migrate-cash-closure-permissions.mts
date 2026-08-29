/**
 * Popula as chaves de fechamento e depósito em todos os perfis existentes.
 * Seguro por padrão: apenas perfis marcados como default admin recebem acesso;
 * os demais recebem todas as novas autoridades como false para configuração
 * explícita posterior na tela de perfis.
 *
 * Uso:
 *   node --import tsx scripts/migrate-cash-closure-permissions.mts
 *   node --import tsx scripts/migrate-cash-closure-permissions.mts --max-docs=5000
 *   node --import tsx scripts/migrate-cash-closure-permissions.mts --execute
 */
import { FieldPath } from "firebase-admin/firestore";
import { config } from "dotenv";

config({ path: ".env.local" });
const { dbAdmin } = await import("../src/lib/firebase-admin");

const execute = process.argv.includes("--execute");
const maxDocsArgument = process.argv.find((argument) => argument.startsWith("--max-docs="));
const maxDocs = Number(maxDocsArgument?.split("=")[1] ?? 5_000);
if (!Number.isSafeInteger(maxDocs) || maxDocs < 1 || maxDocs > 20_000) {
  throw new Error("--max-docs deve ser um inteiro entre 1 e 20000.");
}
const pageSize = 200;

async function readProfilesBounded() {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let lastId: string | null = null;
  while (documents.length <= maxDocs) {
    const requestLimit = Math.min(pageSize, maxDocs + 1 - documents.length);
    let query = dbAdmin.collection("profiles")
      .orderBy(FieldPath.documentId())
      .limit(requestLimit);
    if (lastId) query = query.startAfter(lastId);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.size < requestLimit) return documents;
    lastId = snapshot.docs.at(-1)?.id ?? null;
  }
  throw new Error(`profiles excedeu o limite de ${maxDocs} documentos. Revise --max-docs antes de continuar.`);
}

const documents = await readProfilesBounded();
const changes: Array<{
  id: string;
  admin: boolean;
  ref: FirebaseFirestore.DocumentReference;
  patch: Record<string, unknown>;
}> = [];

for (const document of documents) {
  const data = document.data();
  const admin = data.isDefaultAdmin === true;
  const currentFinancial = data.permissions?.financial ?? {};
  const currentCashClosures = currentFinancial.cashClosures ?? {};
  const cashClosures = {
    view: currentCashClosures.view ?? admin,
    edit: currentCashClosures.edit ?? admin,
    approve: currentCashClosures.approve ?? admin,
    adjustExpected: currentCashClosures.adjustExpected ?? admin,
    reopen: currentCashClosures.reopen ?? admin,
    resync: currentCashClosures.resync ?? admin,
  };
  const cashDeposits = currentFinancial.cashDeposits ?? {
    view: admin,
    issue: admin,
    cancel: admin,
    adjust: admin,
  };
  if (
    currentFinancial.cashClosures?.adjustExpected !== undefined
    && currentFinancial.cashDeposits
  ) continue;
  changes.push({
    id: document.id,
    admin,
    ref: document.ref,
    patch: {
      permissions: {
        financial: {
          ...currentFinancial,
          cashClosures,
          cashDeposits,
        },
      },
    },
  });
}

if (execute) {
  for (let index = 0; index < changes.length; index += 400) {
    const batch = dbAdmin.batch();
    for (const change of changes.slice(index, index + 400)) {
      batch.set(change.ref, change.patch, { merge: true });
    }
    await batch.commit();
  }
}

console.log(JSON.stringify({
  mode: execute ? "EXECUTED" : "DRY_RUN",
  scanned: documents.length,
  readCeiling: maxDocs + 1,
  changed: changes.length,
  profiles: changes.map(({ id, admin }) => ({ id, admin })),
}, null, 2));
