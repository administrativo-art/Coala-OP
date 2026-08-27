import fs from "node:fs";
import { cert, deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH não configurado.");

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
const appName = "automatic-probation-extension-migration";
const app = getApps().find((item) => item.name === appName)
  ?? initializeApp({ credential: cert(serviceAccount) }, appName);
const db = getFirestore(app, "coala-rh");
const now = new Date().toISOString();

const processSnapshot = await db.collection("onboardingProcesses").get();
const processTargets = processSnapshot.docs.filter((document) => {
  const probation = document.get("probationV2");
  return probation && (
    probation.config?.extensionTermRequired !== false
    || probation.extensionTerm?.required !== false
  );
});

const templateSnapshot = await db.collection("onboardingTemplates").get();
const versionTargets = [];
for (const template of templateSnapshot.docs) {
  const versions = await template.ref.collection("versions").get();
  for (const version of versions.docs) {
    if (version.get("probation.extensionTermRequired") !== false) versionTargets.push(version);
  }
}

console.log(JSON.stringify({
  apply,
  onboardingProcesses: processTargets.map((document) => document.id),
  templateVersions: versionTargets.map((document) => document.ref.path),
}, null, 2));

if (apply) {
  for (const document of processTargets) {
    const probation = document.get("probationV2");
    const normalized = {
      ...probation,
      config: { ...probation.config, extensionTermRequired: false },
      extensionTerm: { ...probation.extensionTerm, required: false },
      updatedAt: now,
    };
    await db.runTransaction(async (transaction) => {
      transaction.update(document.ref, { probationV2: normalized, updatedAt: now });
      transaction.set(document.ref.collection("audit").doc(), {
        action: "PROBATION_AUTOMATIC_EXTENSION_ENABLED",
        actorId: "system:migration:automatic-probation-extension",
        actorName: "Migração de contrato de experiência",
        at: FieldValue.serverTimestamp(),
      });
    });
  }

  for (const version of versionTargets) {
    await version.ref.update({
      "probation.extensionTermRequired": false,
      updatedAt: now,
    });
  }
}

console.log(apply
  ? `${processTargets.length} processo(s) e ${versionTargets.length} versão(ões) normalizados.`
  : "Simulação concluída. Use --apply para atualizar.");
await deleteApp(app);
