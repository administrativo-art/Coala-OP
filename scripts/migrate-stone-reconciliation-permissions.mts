/**
 * Adiciona as autoridades da conciliação Stone aos perfis existentes.
 * Administradores padrão recebem true; os demais perfis recebem false para
 * concessão posterior e explícita na tela de perfis.
 *
 * Uso:
 *   npm run migrate:stone-reconciliation-permissions
 *   npm run migrate:stone-reconciliation-permissions -- --execute --confirmation=MIGRATE-STONE-RECONCILIATION-PERMISSIONS-V1
 */
import { FieldPath } from "firebase-admin/firestore";
import { config } from "dotenv";

config({ path: ".env.local" });
const { dbAdmin } = await import("../src/lib/firebase-admin");

const execute = process.argv.includes("--execute");
const confirmation = process.argv.find((value) => value.startsWith("--confirmation="))?.split("=")[1];
const expectedConfirmation = "MIGRATE-STONE-RECONCILIATION-PERMISSIONS-V1";
const maxDocs = Number(process.argv.find((value) => value.startsWith("--max-docs="))?.split("=")[1] ?? 5_000);
if (!Number.isSafeInteger(maxDocs) || maxDocs < 1 || maxDocs > 20_000) {
  throw new Error("--max-docs deve ser um inteiro entre 1 e 20000.");
}
const pageSize = 200;

async function readProfilesBounded() {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let lastId: string | null = null;
  while (documents.length <= maxDocs) {
    const requestLimit = Math.min(pageSize, maxDocs + 1 - documents.length);
    let query = dbAdmin.collection("profiles").orderBy(FieldPath.documentId()).limit(requestLimit);
    if (lastId) query = query.startAfter(lastId);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.size < requestLimit) return documents;
    lastId = snapshot.docs.at(-1)?.id ?? null;
  }
  throw new Error(`profiles excedeu o teto de ${maxDocs} documentos.`);
}

const documents = await readProfilesBounded();
const changes = documents.flatMap((document) => {
  const data = document.data();
  const admin = data.isDefaultAdmin === true;
  const currentFinancial = data.permissions?.financial ?? {};
  const currentSales = currentFinancial.salesReconciliation ?? {};
  const currentStone = currentFinancial.stoneIntegration ?? {};
  const salesReconciliation = {
    view: currentSales.view ?? admin,
    review: currentSales.review ?? admin,
    classify: currentSales.classify ?? admin,
    close: currentSales.close ?? admin,
    reopen: currentSales.reopen ?? admin,
  };
  const stoneIntegration = { manage: currentStone.manage ?? admin };
  const complete = ["view", "review", "classify", "close", "reopen"].every((key) => currentSales[key] !== undefined)
    && currentStone.manage !== undefined;
  return complete ? [] : [{
    id: document.id,
    admin,
    ref: document.ref,
    patch: {
      permissions: {
        financial: {
          ...currentFinancial,
          salesReconciliation,
          stoneIntegration,
        },
      },
    },
  }];
});

if (execute) {
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Confirmação ausente. Use --confirmation=${expectedConfirmation}. Nenhuma escrita foi iniciada.`);
  }
  for (let index = 0; index < changes.length; index += 400) {
    const batch = dbAdmin.batch();
    changes.slice(index, index + 400).forEach((change) => batch.set(change.ref, change.patch, { merge: true }));
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
