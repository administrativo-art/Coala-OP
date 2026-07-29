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

const snap = await hrDb.collection("onboardingProcesses").get();
const matches = snap.docs.filter((doc) => {
  const data = doc.data();
  const name = String(data.candidateName || "").toLowerCase();
  return name.includes("sara");
});

console.log(`Encontrados: ${matches.length}`);
for (const doc of matches) {
  const data = doc.data();
  console.log(JSON.stringify({
    id: doc.id,
    candidateName: data.candidateName,
    candidateEmail: data.candidateEmail,
    stage: data.stage,
    expectedAdmissionDate: data.expectedAdmissionDate,
    asoWorkflow: data.asoWorkflow,
    documentsCount: Array.isArray(data.documents) ? data.documents.length : null,
    documentsStatuses: Array.isArray(data.documents) ? data.documents.map((d) => ({ id: d.id, required: d.required, status: d.status, documentTypeCode: d.documentTypeCode })) : null,
  }, null, 2));
}
