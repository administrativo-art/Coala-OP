import { readFileSync } from "node:fs";

import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const userIdIndex = process.argv.indexOf("--user-id");
const ONLY_USER_ID = userIdIndex >= 0 ? process.argv[userIdIndex + 1]?.trim() : null;
const BACKUP_ID = `termination-effects-reconciliation-${new Date().toISOString().slice(0, 10)}`;

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH não configurado.");

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
const app = initializeApp({ credential: cert(serviceAccount) }, `termination-reconciliation-${Date.now()}`);
const db = getFirestore(app, "coala");

const userDocuments = ONLY_USER_ID
  ? [await db.collection("users").doc(ONLY_USER_ID).get()]
  : (await db.collection("users").where("isActive", "==", false).get()).docs;

const targets = userDocuments
  .filter((document) => document.exists)
  .filter((document) => {
    const data = document.data() ?? {};
    return (data.inactivationType === "contract_termination" || data.employmentStatus === "terminated")
      && data.terminationEffectsVersion !== 1;
  })
  .map((document) => ({
    id: document.id,
    username: document.get("username") ?? document.id,
    terminationDate: document.get("terminationDate") ?? null,
    inactivationType: document.get("inactivationType") ?? null,
    employmentStatus: document.get("employmentStatus") ?? null,
    data: document.data() ?? {},
  }));

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  requestedUserId: ONLY_USER_ID,
  targetCount: targets.length,
  targets: targets.map(({ data: _data, ...target }) => target),
}, null, 2));

if (!APPLY || !targets.length) process.exit(0);

const backupRef = db.collection("system_migration_backups").doc(BACKUP_ID);
const backup = await backupRef.get();
if (backup.exists) throw new Error(`Backup ${BACKUP_ID} já existe; reconciliação não reaplicada.`);

await backupRef.set({
  type: "termination_effects_reconciliation",
  targets: targets.map(({ id, data }) => ({ id, data })),
  createdAt: FieldValue.serverTimestamp(),
});

for (let index = 0; index < targets.length; index += 400) {
  const batch = db.batch();
  targets.slice(index, index + 400).forEach((target) => {
    batch.set(db.collection("users").doc(target.id), {
      terminationEffectsVersion: FieldValue.delete(),
      terminationEffectsReprocessRequestedAt: FieldValue.serverTimestamp(),
      terminationEffectsReprocessSource: "system:reconcile-terminated-user-effects",
    }, { merge: true });
  });
  await batch.commit();
}

await backupRef.set({
  appliedAt: FieldValue.serverTimestamp(),
  targetCount: targets.length,
}, { merge: true });

console.log(`Reconciliação solicitada para ${targets.length} usuário(s). Backup: ${BACKUP_ID}.`);
