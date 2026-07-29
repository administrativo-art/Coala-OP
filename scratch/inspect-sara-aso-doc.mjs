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
const doc = await hrDb.collection("onboardingProcesses").doc("AuN2P9qU5GMQRGvVLc86").get();
const data = doc.data();
const asoDoc = (data.documents || []).find((d) => d.id === "aso_admission");
console.log(JSON.stringify(asoDoc, null, 2));
console.log("---asoWorkflow (raw)---");
console.log(JSON.stringify(data.asoWorkflow ?? null, null, 2));
