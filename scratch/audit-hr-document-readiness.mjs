import 'dotenv/config';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'smart-converter-752gf';
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : null;
const app = getApps()[0] ?? initializeApp({ credential: serviceAccount ? cert(serviceAccount) : applicationDefault(), projectId });
const appDb = getFirestore(app, 'coala');
const hrDb = getFirestore(app, 'coala-rh');

const [profiles, documents] = await Promise.all([
  appDb.collection('profiles').get(),
  hrDb.collection('employeeDocuments').get(),
]);

const accessSummary = { salary: 0, elevatedRh: 0, collaboratorEditors: 0 };
for (const profile of profiles.docs) {
  const permissions = profile.get('permissions') ?? {};
  if (permissions?.dp?.rh?.can_view_salary === true) accessSummary.salary += 1;
  if (permissions?.dp?.rh_role === 'admin' || permissions?.dp?.rh_role === 'manager') accessSummary.elevatedRh += 1;
  if (permissions?.dp?.collaborators?.edit === true) accessSummary.collaboratorEditors += 1;
}

const legacy = documents.docs.filter((document) => {
  const path = String(document.get('storagePath') ?? '');
  return path.startsWith('hr/employee-documents/') && !/\/documents\/[^/]+\/versions\//.test(path);
});
const missingPolicy = documents.docs.filter((document) => !document.get('accessPolicyId'));
const missingDocumentCode = documents.docs.filter((document) => !document.get('documentTypeCode'));

console.log(JSON.stringify({
  profiles: profiles.size,
  accessSummary,
  employeeDocuments: documents.size,
  legacyDocuments: legacy.length,
  missingAccessPolicy: missingPolicy.length,
  missingDocumentTypeCode: missingDocumentCode.length,
}, null, 2));
