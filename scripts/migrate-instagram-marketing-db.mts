import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { applicationDefault, cert, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type DocumentData, type DocumentReference } from "firebase-admin/firestore";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "smart-converter-752gf";
const SOURCE_DATABASE_ID = "coala";
const TARGET_DATABASE_ID = "coala-signage";
const COLLECTIONS = ["instagramScheduledPosts", "instagramMediaLibrary"] as const;
const APPLY = process.argv.includes("--apply");

type CopyOperation = {
  target: DocumentReference;
  data: DocumentData;
};

async function credential() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!serviceAccountPath) return applicationDefault();
  const raw = await readFile(resolve(serviceAccountPath), "utf8");
  return cert(JSON.parse(raw) as ServiceAccount);
}

async function main() {
  const app = initializeApp({ credential: await credential(), projectId: PROJECT_ID });
  const source = getFirestore(app, SOURCE_DATABASE_ID);
  const target = getFirestore(app, TARGET_DATABASE_ID);
  const operations: CopyOperation[] = [];
  const summary: Record<string, number> = {};

  const processing = await source.collection("instagramScheduledPosts")
    .where("status", "==", "processing")
    .limit(1)
    .get();
  if (!processing.empty) {
    throw new Error("Há um agendamento em processamento no banco de origem. Aguarde a conclusão antes da migração.");
  }

  for (const collectionName of COLLECTIONS) {
    const [sourceSnapshot, targetSnapshot] = await Promise.all([
      source.collection(collectionName).get(),
      target.collection(collectionName).get(),
    ]);
    const targetIds = new Set(targetSnapshot.docs.map((doc) => doc.id));
    summary[`${collectionName}Source`] = sourceSnapshot.size;
    summary[`${collectionName}TargetBefore`] = targetSnapshot.size;
    for (const doc of sourceSnapshot.docs) {
      const targetRef = target.collection(collectionName).doc(doc.id);
      if (targetIds.has(doc.id)) {
        summary.skippedExistingDocuments = (summary.skippedExistingDocuments ?? 0) + 1;
      } else {
        operations.push({ target: targetRef, data: doc.data() });
        summary.documentsToCopy = (summary.documentsToCopy ?? 0) + 1;
      }

      if (collectionName === "instagramScheduledPosts") {
        const [sourceEvents, targetEvents] = await Promise.all([
          doc.ref.collection("events").get(),
          targetRef.collection("events").get(),
        ]);
        const targetEventIds = new Set(targetEvents.docs.map((event) => event.id));
        summary.instagramScheduleEventsSource = (summary.instagramScheduleEventsSource ?? 0) + sourceEvents.size;
        for (const event of sourceEvents.docs) {
          if (targetEventIds.has(event.id)) {
            summary.skippedExistingEvents = (summary.skippedExistingEvents ?? 0) + 1;
          } else {
            operations.push({ target: targetRef.collection("events").doc(event.id), data: event.data() });
            summary.eventsToCopy = (summary.eventsToCopy ?? 0) + 1;
          }
        }
      }
    }
  }

  console.log("Migração do Marketing", {
    projectId: PROJECT_ID,
    sourceDatabase: SOURCE_DATABASE_ID,
    targetDatabase: TARGET_DATABASE_ID,
    documents: summary,
    writes: operations.length,
    mode: APPLY ? "apply" : "dry-run",
  });
  if (!APPLY) return;

  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = target.batch();
    for (const operation of operations.slice(offset, offset + 400)) {
      batch.create(operation.target, operation.data);
    }
    await batch.commit();
  }

  console.log(`Migração concluída: ${operations.length} documentos copiados para ${TARGET_DATABASE_ID}.`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
