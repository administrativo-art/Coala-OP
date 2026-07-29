import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'smart-converter-752gf';
function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, 'utf8')));
  return applicationDefault();
}
const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId, storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET });
const bucket = getStorage(app).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
const documents = [
  ['sara', 'hr/employee-documents/FzliQXBLykURpu9CxL8EzoAe4Xq1/documents/6208a4dadcc23e46144c761e18a50f64/versions/01/signed.pdf'],
  ['aliny', 'hr/employee-documents/18688727/documents/67becd9234d3f9d2d032648cce340240/versions/01/original.pdf'],
  ['maria', 'hr/employee-documents/18688741/documents/2711f2746807208ca82dc1dcd7eb802f/versions/01/original.pdf'],
];
for (const [name, path] of documents) {
  const [buffer] = await bucket.file(path).download();
  const target = `/tmp/${name}-probation-contract-20260721.pdf`;
  writeFileSync(target, buffer);
  console.log(target);
}
