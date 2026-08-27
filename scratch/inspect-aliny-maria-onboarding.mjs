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

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchesTarget(value) {
  const text = normalized(value);
  return text.includes("aliny") || (text.includes("maria") && text.includes("sousa") && text.includes("pereira"));
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const db = getFirestore(app, "coala");
const hrDb = getFirestore(app, "coala-rh");

const [processes, users, employees] = await Promise.all([
  hrDb.collection("onboardingProcesses").get(),
  db.collection("users").get(),
  hrDb.collection("employees").get(),
]);
const fieldMapSnapshot = await hrDb.collection("schema").doc("field_map").get();
const schemaFields = fieldMapSnapshot.get("fields") || {};
if (process.argv.includes("--schema-only")) {
  console.log(JSON.stringify(Object.keys(schemaFields).sort(), null, 2));
  process.exit(0);
}

const processMatches = processes.docs.filter((document) => {
  const data = document.data();
  return matchesTarget(data.candidateName) || matchesTarget(data.candidateEmail);
}).map((document) => {
  const data = document.data();
  return {
    id: document.id,
    candidateName: data.candidateName,
    candidateEmail: data.candidateEmail,
    candidateId: data.candidateId,
    currentStage: data.currentStage,
    status: data.status,
    expectedAdmissionDate: data.expectedAdmissionDate,
    employmentRelationshipType: data.employmentRelationshipType,
    unitId: data.unitId,
    roleId: data.roleId,
    functionId: data.functionId,
    collaboratorUserId: data.collaboratorUserId,
    documents: Array.isArray(data.documents) ? data.documents.map((item) => ({
      id: item.id,
      label: item.label,
      documentTypeCode: item.documentTypeCode,
      required: item.required,
      status: item.status,
      fileName: item.fileName,
      storagePath: item.storagePath,
    })) : [],
    asoWorkflow: data.asoWorkflow,
    accountantWorkflow: data.accountantWorkflow,
    signatureWorkflow: data.signatureWorkflow,
  };
});

const userDocuments = users.docs.filter((document) => {
  const data = document.data();
  return matchesTarget(data.username) || matchesTarget(data.email);
});
const userMatches = userDocuments.map((document) => {
  const data = document.data();
  return {
    id: document.id,
    data,
    username: data.username,
    email: data.email,
    profileId: data.profileId,
    isActive: data.isActive,
    registrationIdBizneo: data.registrationIdBizneo,
    registrationIdPdv: data.registrationIdPdv,
    pdvOperatorIds: data.pdvOperatorIds,
    assignedKioskIds: data.assignedKioskIds,
    unitIds: data.unitIds,
    jobRoleId: data.jobRoleId,
    jobRoleName: data.jobRoleName,
    employmentRelationshipType: data.employmentRelationshipType,
  };
});

const employeeMatches = employees.docs.filter((document) => {
  const data = document.data();
  return matchesTarget(data.name) || matchesTarget(data.full_name) || matchesTarget(data.email);
});

const employeeDetails = [];
for (const document of employeeMatches) {
  const data = document.data();
  const fieldValues = await document.ref.collection("field_values").get();
  const history = await document.ref.collection("consentimentos_imagem_voz_historico").get();
  const docsByBizneo = await hrDb.collection("employeeDocuments").where("employeeId", "==", document.id).get();
  employeeDetails.push({
    id: document.id,
    data,
    fieldValues: Object.fromEntries(fieldValues.docs.map((item) => [item.id, item.data()])),
    consentHistory: history.docs.map((item) => ({ id: item.id, ...item.data() })),
    documents: docsByBizneo.docs.map((item) => ({ id: item.id, ...item.data() })),
  });
}

for (const user of userMatches) {
  const byAuth = await hrDb.collection("employeeDocuments").where("employeeId", "==", user.id).get();
  user.documents = byAuth.docs.map((item) => ({ id: item.id, ...item.data() }));
}

console.log(JSON.stringify({
  processes: processMatches,
  users: userMatches,
  employees: employeeDetails,
  schemaFieldKeys: Object.keys(schemaFields).sort(),
}, null, 2));
