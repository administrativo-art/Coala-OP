import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (credentialPath && existsSync(credentialPath)) return cert(JSON.parse(readFileSync(credentialPath, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const hrDb = getFirestore(app, "coala-rh");
const defaultDb = getFirestore(app, "coala");
const processRef = hrDb.collection("onboardingProcesses").doc("AuN2P9qU5GMQRGvVLc86");
const processSnapshot = await processRef.get();
const processData = processSnapshot.data() ?? {};

const identifiers = {
  employeeId: processData.employeeId ?? null,
  userId: processData.userId ?? null,
  createdUserId: processData.createdUserId ?? null,
  collaboratorId: processData.collaboratorId ?? null,
  candidateId: processData.candidateId ?? null,
};

const possibleEmployeeIds = [...new Set(Object.values(identifiers).filter((value) => typeof value === "string" && value))];
const email = String(processData.candidateEmail ?? "").toLowerCase();
const usersByEmail = email
  ? await defaultDb.collection("users").where("email", "==", email).get()
  : { docs: [] };
for (const snapshot of usersByEmail.docs) possibleEmployeeIds.push(snapshot.id);

const uniqueEmployeeIds = [...new Set(possibleEmployeeIds)];
const archivedDocuments = [];
for (const employeeId of uniqueEmployeeIds) {
  const documents = await hrDb.collection("employeeDocuments").where("employeeId", "==", employeeId).get();
  archivedDocuments.push(...documents.docs.map((document) => ({
    id: document.id,
    employeeId,
    documentTypeCode: document.get("documentTypeCode") ?? null,
    documentType: document.get("documentType") ?? null,
    originalName: document.get("originalName") ?? null,
    status: document.get("status") ?? null,
    signatureRequired: document.get("signatureRequired") ?? null,
    signatureStatus: document.get("signatureStatus") ?? null,
    contentHash: document.get("contentHash") ?? null,
  })));
}

console.log(JSON.stringify({
  processId: processSnapshot.id,
  candidateName: processData.candidateName ?? null,
  candidateEmail: processData.candidateEmail ?? null,
  currentStage: processData.currentStage ?? null,
  status: processData.status ?? null,
  expectedAdmissionDate: processData.expectedAdmissionDate ?? null,
  identifiers,
  matchedUsers: usersByEmail.docs.map((snapshot) => ({ id: snapshot.id, username: snapshot.get("username") ?? null, email: snapshot.get("email") ?? null })),
  possibleEmployeeIds: uniqueEmployeeIds,
  signatureWorkflow: processData.signatureWorkflow ?? null,
  accountantWorkflow: processData.accountantWorkflow ?? null,
  imageVoiceConsent: processData.consentimento_imagem_voz ?? null,
  privacyAcceptance: processData.publicPrivacyAcceptance ?? null,
  archivedDocuments,
  processKeys: Object.keys(processData).sort(),
}, null, 2));
