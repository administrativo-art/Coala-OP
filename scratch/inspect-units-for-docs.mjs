import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, databaseId);

const [unitSnap, companyDocsSnap] = await Promise.all([
  db.collection("dp_units").get(),
  db.collection("companyDocuments").get(),
]);

console.log(`Total unidades: ${unitSnap.size}`);
const units = unitSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
for (const u of units) {
  console.log(`- ${u.name} | isArchived=${!!u.isArchived} | cnpj=${u.cnpj || "-"} | address=${u.address || "-"} | unitType=${u.unitType || "-"} | mergedInto=${u.mergedIntoUnitName || "-"}`);
}

console.log(`\nTotal companyDocuments: ${companyDocsSnap.size}`);
for (const doc of companyDocsSnap.docs) {
  const d = doc.data();
  if (d.deletedAt) continue;
  console.log(`- title=${d.title} | category=${d.category} | unit=${d.unit || "-"}`);
}
