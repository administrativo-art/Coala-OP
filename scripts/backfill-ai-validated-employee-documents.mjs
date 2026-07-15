import fs from "node:fs";
import { cert, deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH não configurado.");

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app, "coala-rh");
const documents = await db.collection("employeeDocuments").where("status", "==", "received").get();

const eligible = [];
for (const document of documents.docs) {
  if (document.get("deletedAt")) continue;
  const items = await db.collection("documentUploadItems").where("filedDocumentId", "==", document.id).get();
  const source = items.docs.find((item) =>
    item.get("decisionAction") === "READY_TO_FILE" && item.get("decisionReason") === "VALIDATED"
  );
  if (!source) continue;
  eligible.push({ document, source });
}

console.log(JSON.stringify({ apply, eligible: eligible.map(({ document, source }) => ({
  documentId: document.id,
  employeeId: document.get("employeeId"),
  originalName: document.get("originalName"),
  confidence: source.get("confidence") ?? null,
})) }, null, 2));

if (apply) {
  for (const { document, source } of eligible) {
    const now = Timestamp.now();
    await document.ref.update({
      status: "validated",
      validationSource: "document_analysis",
      validatedBy: "system:document-analysis",
      validatedByName: "Copiloto RH",
      validatedAt: now,
      updatedAt: now,
    });
    await document.ref.collection("audit").add({
      action: "DOCUMENT_AUTO_VALIDATED_BACKFILL",
      actorId: "system:document-analysis",
      actorName: "Copiloto RH",
      decisionAction: source.get("decisionAction"),
      decisionReason: source.get("decisionReason"),
      confidence: source.get("confidence") ?? null,
      analysisModel: source.get("analysisModel") ?? null,
      promptVersion: source.get("promptVersion") ?? null,
      sourceItemId: source.id,
      at: now,
    });
  }
}

console.log(apply ? `${eligible.length} documento(s) atualizado(s).` : "Simulação concluída. Use --apply para atualizar.");
await deleteApp(app);
