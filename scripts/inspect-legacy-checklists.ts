import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serviceAccountPath = resolve(
  __dirname,
  "smart-converter-752gf-firebase-adminsdk-fbsvc-aaa18b4778.json"
);

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

const app = initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore(app, "coala-checklist");

async function main() {
  // Coleções raiz
  console.log("=== Coleções raiz no banco coala-checklist ===");
  const collections = await db.listCollections();
  console.log(`Total de coleções: ${collections.length}`);
  for (const col of collections) {
    const countSnap = await col.count().get();
    console.log(`- ${col.id}  (total: ${countSnap.data().count} documentos)`);
  }

  // checklistTemplates (pedido original)
  console.log("\n=== checklistTemplates (máx 50) ===");
  const templatesSnap = await db.collection("checklistTemplates").limit(50).get();
  console.log(`Total encontrado: ${templatesSnap.size}`);
  templatesSnap.forEach((doc) => {
    const d = doc.data();
    console.log({
      id: doc.id,
      name: d.name ?? "(sem nome)",
      occurrence_type: d.occurrence_type ?? d.occurrenceType ?? "(n/a)",
      jobRoleIds: d.jobRoleIds ?? [],
      isActive: d.isActive ?? d.active ?? "(n/a)",
    });
  });

  // checklistTypes (pedido original)
  console.log("\n=== checklistTypes (máx 20) ===");
  const typesSnap = await db.collection("checklistTypes").limit(20).get();
  console.log(`Total encontrado: ${typesSnap.size}`);
  typesSnap.forEach((doc) => {
    const d = doc.data();
    console.log({ id: doc.id, name: d.name ?? "(sem nome)" });
  });

  // checklistExecutions — dados completos
  console.log("\n=== checklistExecutions (máx 50) — campos relevantes ===");
  const execSnap = await db.collection("checklistExecutions").limit(50).get();
  console.log(`Total encontrado: ${execSnap.size}`);
  execSnap.forEach((doc) => {
    const d = doc.data();
    console.log({
      id: doc.id,
      templateId: d.templateId ?? "(n/a)",
      templateName: d.templateName ?? "(n/a)",
      templateType: d.templateType ?? "(n/a)",
      occurrenceType: d.occurrenceType ?? "(n/a)",
      status: d.status ?? "(n/a)",
      unitId: d.unitId ?? "(n/a)",
      unitName: d.unitName ?? "(n/a)",
      checklistDate: d.checklistDate ?? "(n/a)",
    });
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
