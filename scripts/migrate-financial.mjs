import { readFileSync, existsSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const DEFAULT_PROJECT_ID = "smart-converter-752gf";
const DEFAULT_COLLECTIONS = [
  "accountPlans",
  "resultCenters",
  "expenses",
  "bankAccounts",
  "payments",
  "transactions",
  "importAliases",
  "importDrafts",
];

function getCredentialFromEnv(envName) {
  const raw = process.env[envName];
  if (raw) return cert(JSON.parse(raw));

  // Also support a file path variant (e.g. SOURCE_FIREBASE_SERVICE_ACCOUNT_PATH)
  const pathEnv = `${envName}_PATH`;
  const filePath = process.env[pathEnv] ?? process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (filePath && existsSync(filePath)) {
    return cert(JSON.parse(readFileSync(filePath, "utf8")));
  }

  return applicationDefault();
}

function getOrCreateAdminApp(name, projectId, credentialEnv) {
  const existing = getApps().find((app) => app.name === name);
  if (existing) return existing;

  return initializeApp(
    {
      credential: getCredentialFromEnv(credentialEnv),
      projectId,
    },
    name
  );
}

function parseCollections() {
  if (!process.env.MIGRATE_COLLECTIONS) return DEFAULT_COLLECTIONS;
  return process.env.MIGRATE_COLLECTIONS.split(",").map((value) => value.trim()).filter(Boolean);
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function migrateCollection({ sourceDb, targetDb, name, dryRun }) {
  const snapshot = await sourceDb.collection(name).get();
  const docs = snapshot.docs;
  console.log(`\n[financial-migrate] ${name}: ${docs.length} documentos encontrados`);

  if (dryRun || docs.length === 0) {
    return { collection: name, count: docs.length };
  }

  for (const batchDocs of chunk(docs, 400)) {
    const batch = targetDb.batch();
    for (const documentSnapshot of batchDocs) {
      const targetRef = targetDb.collection(name).doc(documentSnapshot.id);
      batch.set(targetRef, documentSnapshot.data(), { merge: true });
    }
    await batch.commit();
  }

  return { collection: name, count: docs.length };
}

async function main() {
  const sourceProjectId = process.env.SOURCE_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const targetProjectId = process.env.TARGET_FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const sourceDatabase = process.env.SOURCE_FIRESTORE_DATABASE || "coalafinan";
  const targetDatabase = process.env.TARGET_FIRESTORE_DATABASE || "coala-financeiro";
  const collections = parseCollections();
  const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";

  console.log("[financial-migrate] configuração");
  console.log(`  source project : ${sourceProjectId}`);
  console.log(`  source db      : ${sourceDatabase}`);
  console.log(`  target project : ${targetProjectId}`);
  console.log(`  target db      : ${targetDatabase}`);
  console.log(`  dry run        : ${dryRun ? "sim" : "não"}`);
  console.log(`  coleções       : ${collections.join(", ")}`);

  const sourceApp = getOrCreateAdminApp("financial-source", sourceProjectId, "SOURCE_FIREBASE_SERVICE_ACCOUNT");
  const targetApp =
    sourceProjectId === targetProjectId &&
    (process.env.SOURCE_FIREBASE_SERVICE_ACCOUNT || "") === (process.env.TARGET_FIREBASE_SERVICE_ACCOUNT || "")
      ? sourceApp
      : getOrCreateAdminApp("financial-target", targetProjectId, "TARGET_FIREBASE_SERVICE_ACCOUNT");

  const sourceDb = getFirestore(sourceApp, sourceDatabase);
  const targetDb = getFirestore(targetApp, targetDatabase);

  const results = [];
  for (const name of collections) {
    results.push(await migrateCollection({ sourceDb, targetDb, name, dryRun }));
  }

  console.log("\n[financial-migrate] resumo");
  for (const result of results) {
    console.log(`  - ${result.collection}: ${result.count} documento(s)`);
  }
}

main().catch((error) => {
  console.error("[financial-migrate] falhou", error);
  process.exitCode = 1;
});
