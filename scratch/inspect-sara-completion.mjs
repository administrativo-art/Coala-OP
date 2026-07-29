import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const EMAIL = "sara17ferreira2004@gmail.com";
const PROCESS_ID = "AuN2P9qU5GMQRGvVLc86";
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, "coala");
const hrDb = getFirestore(app, "coala-rh");

const processRef = hrDb.collection("onboardingProcesses").doc(PROCESS_ID);
const processSnap = await processRef.get();
if (!processSnap.exists) throw new Error("Processo da Sara não encontrado.");
const onboarding = processSnap.data();
const candidateId = onboarding.candidateId || null;
const candidateSnap = candidateId ? await hrDb.collection("candidates").doc(candidateId).get() : null;
const usersByEmail = await db.collection("users").where("email", "==", EMAIL).get();
const allUsers = await db.collection("users").get();
const usersByName = allUsers.docs.filter((doc) => String(doc.get("username") || "").toLowerCase().includes("sara"));
const allCandidates = await hrDb.collection("candidates").get();
const candidatesByName = allCandidates.docs.filter((doc) => String(doc.get("name") || "").toLowerCase().includes("sara"));
let authUser = null;
try {
  const user = await getAuth(app).getUserByEmail(EMAIL);
  authUser = { uid: user.uid, disabled: user.disabled, emailVerified: user.emailVerified };
} catch (error) {
  authUser = { missing: true, code: error?.code || null };
}

const roleId = onboarding.jobRoleId || null;
const functionId = onboarding.functionId || null;
const roleSnap = roleId ? await hrDb.collection("jobRoles").doc(roleId).get() : null;
const functionSnap = functionId ? await hrDb.collection("jobFunctions").doc(functionId).get() : null;
const profileId = roleSnap?.data()?.defaultProfileId || functionSnap?.data()?.defaultProfileId || null;
const profileSnap = profileId ? await db.collection("profiles").doc(profileId).get() : null;
const unitId = onboarding.unitId || null;
const unitSnap = unitId ? await db.collection("dp_units").doc(unitId).get() : null;
const kioskSnaps = await db.collection("kiosks").get();
const possibleKiosks = kioskSnaps.docs.filter((doc) => {
  const data = doc.data();
  const unitKioskId = unitSnap?.get("kioskId") || unitSnap?.get("linkedKioskId") || null;
  return doc.id === unitKioskId ||
    String(data.name || "").toLowerCase().includes("tirir") ||
    String(data.pdvFilialId || "") === "17343";
});
const signatureSnaps = await hrDb.collection("hrSignatureDocuments").where("onboardingId", "==", PROCESS_ID).get();

const compactProcess = {
  id: processSnap.id,
  candidateId,
  candidateName: onboarding.candidateName,
  candidateEmail: onboarding.candidateEmail,
  currentStage: onboarding.currentStage,
  status: onboarding.status,
  jobRoleId: roleId,
  jobRoleName: onboarding.jobRoleName,
  functionId,
  functionName: onboarding.functionName,
  unitId: onboarding.unitId,
  unitName: onboarding.unitName,
  shiftDefinitionId: onboarding.shiftDefinitionId,
  expectedAdmissionDate: onboarding.expectedAdmissionDate,
  employmentRelationshipType: onboarding.employmentRelationshipType || null,
  finalizationSettings: onboarding.finalizationSettings || null,
  collaboratorUserId: onboarding.collaboratorUserId || null,
  employeeId: onboarding.employeeId || null,
  firstAccess: onboarding.firstAccess || null,
  accessProvisioning: onboarding.accessProvisioning || null,
  integrationAlerts: onboarding.integrationAlerts || null,
  accountantStatus: onboarding.accountantWorkflow?.status || null,
  asoStatus: onboarding.asoWorkflow?.status || null,
  signatureDocuments: onboarding.signatureWorkflow?.documents?.map?.((entry) => ({
    id: entry.id,
    status: entry.status,
    selected: entry.selected,
  })) || null,
  signatureWorkflow: onboarding.signatureWorkflow || null,
  stages: Array.isArray(onboarding.stages) ? onboarding.stages.map((stage) => ({ id: stage.id, order: stage.order, status: stage.status })) : null,
  integrationTemplate: onboarding.integrationV2?.snapshot ? {
    keys: Object.keys(onboarding.integrationV2.snapshot),
    templateId: onboarding.integrationV2.snapshot.templateId,
    version: onboarding.integrationV2.snapshot.version,
    communications: Array.isArray(onboarding.integrationV2.snapshot.communications)
      ? onboarding.integrationV2.snapshot.communications.map((entry) => ({ event: entry.event, enabled: entry.enabled, subject: entry.subject }))
      : null,
  } : null,
};

console.log(JSON.stringify({
  process: compactProcess,
  candidate: candidateSnap?.exists ? {
    id: candidateSnap.id,
    name: candidateSnap.get("name"),
    email: candidateSnap.get("email"),
    registrationIdBizneo: candidateSnap.get("registrationIdBizneo") || null,
    registrationIdPdv: candidateSnap.get("registrationIdPdv") || null,
    pdvOperatorIds: candidateSnap.get("pdvOperatorIds") || null,
  } : null,
  authUser,
  users: usersByEmail.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  usersByName: usersByName.map((doc) => ({
    id: doc.id,
    username: doc.get("username"),
    email: doc.get("email"),
    registrationIdBizneo: doc.get("registrationIdBizneo") || null,
    registrationIdPdv: doc.get("registrationIdPdv") || null,
    pdvOperatorIds: doc.get("pdvOperatorIds") || null,
    isActive: doc.get("isActive"),
  })),
  candidatesByName: candidatesByName.map((doc) => ({
    id: doc.id,
    name: doc.get("name"),
    email: doc.get("email"),
    registrationIdBizneo: doc.get("registrationIdBizneo") || null,
    registrationIdPdv: doc.get("registrationIdPdv") || null,
    pdvOperatorIds: doc.get("pdvOperatorIds") || null,
  })),
  role: roleSnap?.exists ? { id: roleSnap.id, ...roleSnap.data() } : null,
  function: functionSnap?.exists ? { id: functionSnap.id, ...functionSnap.data() } : null,
  resolvedProfile: profileSnap?.exists ? { id: profileSnap.id, name: profileSnap.get("name") } : { id: profileId, missing: true },
  unit: unitSnap?.exists ? { id: unitSnap.id, ...unitSnap.data() } : null,
  possibleKiosks: possibleKiosks.map((doc) => ({ id: doc.id, ...doc.data() })),
  signatureRecords: signatureSnaps.docs.map((doc) => ({
    id: doc.id,
    status: doc.get("status"),
    selected: doc.get("selected"),
    employeeDocumentId: doc.get("employeeDocumentId") || null,
    signedStoragePath: doc.get("signedStoragePath") || null,
  })),
}, null, 2));
