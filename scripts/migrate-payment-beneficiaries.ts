import { dbAdmin } from "../src/lib/firebase-admin";
import { normalizeBrazilianDocument } from "../src/features/financial/beneficiaries/normalization";

const apply = process.argv.includes("--apply");

async function main() {
  const snapshot = await dbAdmin.collection("entities").get();
  const byDocument = new Map<string, string[]>();
  const pending: Array<{ id: string; documentNormalized: string }> = [];

  snapshot.docs.forEach((document) => {
    const data = document.data();
    const normalized = normalizeBrazilianDocument(data.documentNormalized ?? data.document ?? data.cnpj);
    if (!normalized) return;
    byDocument.set(normalized, [...(byDocument.get(normalized) ?? []), document.id]);
    if (data.documentNormalized !== normalized) pending.push({ id: document.id, documentNormalized: normalized });
  });

  const duplicates = [...byDocument.entries()].filter(([, ids]) => ids.length > 1);
  const invalid = [...byDocument.keys()].filter((document) => ![11, 14].includes(document.length));
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    entities: snapshot.size,
    pendingNormalization: pending.length,
    duplicateDocuments: duplicates.map(([document, ids]) => ({ document, ids })),
    invalidDocuments: invalid,
  }, null, 2));

  if (!apply) return;
  if (duplicates.length || invalid.length) {
    throw new Error("Migração bloqueada: corrija documentos duplicados ou inválidos antes de aplicar.");
  }

  for (let offset = 0; offset < pending.length; offset += 400) {
    const batch = dbAdmin.batch();
    pending.slice(offset, offset + 400).forEach((item) => {
      batch.set(dbAdmin.collection("entities").doc(item.id), {
        documentNormalized: item.documentNormalized,
        beneficiaryMigrationAt: new Date().toISOString(),
      }, { merge: true });
    });
    await batch.commit();
  }
  console.log(`Normalização aplicada em ${pending.length} cadastro(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
