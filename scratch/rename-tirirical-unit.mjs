import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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

const ref = db.collection("dp_units").doc("pvLHa7BtW826JmhMkTJA");
const before = await ref.get();
console.log(`Antes: name="${before.data().name}"`);

await ref.update({ name: "Quiosque Tirirical", updatedAt: Timestamp.now() });

const after = await ref.get();
console.log(`Depois: name="${after.data().name}"`);
