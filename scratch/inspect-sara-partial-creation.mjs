import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "smart-converter-752gf.firebasestorage.app";
function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}
const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId, storageBucket });
const db = getFirestore(app, "coala");
const hrDb = getFirestore(app, "coala-rh");
const bucket = getStorage(app).bucket(storageBucket);
const userSnap = await db.collection("users").where("email", "==", "sara17ferreira2004@gmail.com").limit(1).get();
const userId = userSnap.empty ? null : userSnap.docs[0].id;
const employeeSnap = userId ? await hrDb.collection("employees").doc(userId).get() : null;
const fieldValues = employeeSnap?.exists ? await employeeSnap.ref.collection("field_values").get() : null;
const consentEvents = employeeSnap?.exists ? await employeeSnap.ref.collection("consentimentos_imagem_voz_historico").get() : null;
const workflows = await hrDb.collection("hrSignatureDocuments").where("onboardingId", "==", "AuN2P9qU5GMQRGvVLc86").get();
const workflowInfo = [];
for (const workflow of workflows.docs) {
  const sourcePath = workflow.get("signedStoragePath");
  const documentId = createHash("sha256").update(`signed-signature:${workflow.id}`).digest("hex").slice(0, 32);
  const permanentPath = userId ? `hr/employee-documents/${userId}/documents/${documentId}/versions/01/signed.pdf` : null;
  const [sourceExists] = sourcePath ? await bucket.file(sourcePath).exists() : [false];
  const [permanentExists] = permanentPath ? await bucket.file(permanentPath).exists() : [false];
  const archived = await hrDb.collection("employeeDocuments").doc(documentId).get();
  workflowInfo.push({
    workflowId: workflow.id,
    status: workflow.get("status"),
    sourcePath,
    sourceExists,
    documentId,
    permanentPath,
    permanentExists,
    archivedDocumentExists: archived.exists,
    archivedEmployeeId: archived.exists ? archived.get("employeeId") : null,
    archivedSignatureRequired: archived.exists ? archived.get("signatureRequired") ?? null : null,
    archivedSignatureStatus: archived.exists ? archived.get("signatureStatus") ?? null : null,
    archivedDocumentTypeCode: archived.exists ? archived.get("documentTypeCode") ?? null : null,
  });
}
console.log(JSON.stringify({
  userId,
  employeeExists: employeeSnap?.exists || false,
  employee: employeeSnap?.exists ? employeeSnap.data() : null,
  fieldValueIds: fieldValues?.docs.map((doc) => doc.id) || [],
  consentEventIds: consentEvents?.docs.map((doc) => doc.id) || [],
  workflows: workflowInfo,
}, null, 2));
