import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}
const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const hrDb = getFirestore(app, "coala-rh");
const ref = hrDb.collection("onboardingProcesses").doc("AuN2P9qU5GMQRGvVLc86");
const doc = await ref.get();
const data = doc.data();
console.log(JSON.stringify({
  currentStage: data.currentStage,
  status: data.status,
  stages: data.stages,
  generateSignatureDocuments: data.generateSignatureDocuments,
  accountantWorkflow: data.accountantWorkflow ?? null,
}, null, 2));

const generatedDocs = await ref.collection("generatedDocuments").get();
console.log(`\ngeneratedDocuments: ${generatedDocs.size}`);
for (const d of generatedDocs.docs) console.log(JSON.stringify({ id: d.id, ...d.data() }, null, 2));

const registryVersions = await ref.collection("accountantRegistryVersions").get();
console.log(`\naccountantRegistryVersions: ${registryVersions.size}`);
for (const d of registryVersions.docs) console.log(JSON.stringify({ id: d.id, ...d.data() }, null, 2));
