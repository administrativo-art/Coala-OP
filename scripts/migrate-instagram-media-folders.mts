import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { applicationDefault, cert, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

import { planMediaFolderMigration } from "../src/features/instagram-scheduler/media-folders-migration";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "smart-converter-752gf";
const DATABASE_ID = "coala-signage";
const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 400;

async function credential() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!serviceAccountPath) return applicationDefault();
  const raw = await readFile(resolve(serviceAccountPath), "utf8");
  return cert(JSON.parse(raw) as ServiceAccount);
}

async function main() {
  const app = initializeApp({ credential: await credential(), projectId: PROJECT_ID });
  const db = getFirestore(app, DATABASE_ID);
  const snapshot = await db.collection("instagramMediaLibrary").get();
  const plan = planMediaFolderMigration(
    snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        workspaceId: String(data.workspace_id ?? ""),
        folder: data.folder,
        hasFolderId: Object.prototype.hasOwnProperty.call(data, "folderId"),
      };
    }).filter((doc) => doc.workspaceId),
  );

  const existing = new Set(
    (await Promise.all(plan.folders.map((folder) => db.collection("instagramMediaFolders").doc(folder.id).get())))
      .filter((doc) => doc.exists)
      .map((doc) => doc.id),
  );
  const foldersToCreate = plan.folders.filter((folder) => !existing.has(folder.id));

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    mediaDocuments: snapshot.size,
    alreadyMigrated: plan.alreadyMigrated,
    mediaToAssign: plan.assignments.length,
    foldersNeeded: plan.folders.length,
    foldersToCreate: foldersToCreate.length,
    folderNames: plan.folders.map((folder) => folder.name),
  }, null, 2));

  if (!APPLY) {
    console.log("Dry-run: nada foi gravado. Use --apply para executar.");
    return;
  }

  const now = Timestamp.now();
  for (const folder of foldersToCreate) {
    await db.collection("instagramMediaFolders").doc(folder.id).create({
      workspace_id: folder.workspaceId,
      name: folder.name,
      parentId: null,
      createdAt: now,
      updatedAt: now,
      createdBy: { uid: "migration", email: null },
      updatedBy: { uid: "migration", email: null },
    });
  }
  for (let offset = 0; offset < plan.assignments.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    for (const item of plan.assignments.slice(offset, offset + BATCH_SIZE)) {
      batch.update(db.collection("instagramMediaLibrary").doc(item.mediaId), { folderId: item.folderId, updatedAt: now });
    }
    await batch.commit();
  }
  console.log(`Concluído: ${foldersToCreate.length} pasta(s) criada(s), ${plan.assignments.length} arquivo(s) atribuído(s).`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
