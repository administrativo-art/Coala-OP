import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const PROCESS_ID = "AuN2P9qU5GMQRGvVLc86";
const EMAIL = "sara17ferreira2004@gmail.com";
const ACTOR_ID = "U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2";
const ACTOR_EMAIL = "tiagobrasilll@gmail.com";
const PROFILE_ID = "wiwQTNJWPWJhkIgokpPS";
const BIZNEO_ID = "18681052";
const PDV_ID = "657365";
const KIOSK_ID = "tirirical";
const PDV_BRANCH_ID = "17343";
const DP_UNIT_ID = "pvLHa7BtW826JmhMkTJA";
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://op.coalashakes.com").replace(/\/+$/, "");
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const auth = getAuth(app);
const db = getFirestore(app, "coala");
const hrDb = getFirestore(app, "coala-rh");
const processRef = hrDb.collection("onboardingProcesses").doc(PROCESS_ID);

async function loadProcess() {
  const snapshot = await processRef.get();
  if (!snapshot.exists) throw new Error("Processo da Sara não encontrado.");
  const data = snapshot.data();
  if (String(data.candidateEmail || "").trim().toLowerCase() !== EMAIL) {
    throw new Error("O processo não pertence ao e-mail esperado da Sara.");
  }
  return data;
}

async function adminIdToken() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY não configurada.");
  await auth.getUser(ACTOR_ID);
  const customToken = await auth.createCustomToken(ACTOR_ID);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.idToken) {
    throw new Error(`Não foi possível autenticar a conclusão: ${payload.error?.message || response.status}`);
  }
  return payload.idToken;
}

async function onboardingAction(idToken, body) {
  const response = await fetch(`${APP_URL}/api/hr/onboarding/${encodeURIComponent(PROCESS_ID)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${body.action}: ${payload.error || `HTTP ${response.status}`}`);
  return payload.process || {};
}

async function copyEmployeeRecordToBizneoId(userId) {
  const sourceRef = hrDb.collection("employees").doc(userId);
  const targetRef = hrDb.collection("employees").doc(BIZNEO_ID);
  const [sourceSnapshot, targetSnapshot] = await Promise.all([sourceRef.get(), targetRef.get()]);
  if (!sourceSnapshot.exists && targetSnapshot.exists && targetSnapshot.get("auth_uid") === userId) {
    return { movedCollections: [], alreadyMoved: true };
  }
  if (!sourceSnapshot.exists) throw new Error("Perfil RH provisório não foi criado.");
  if (targetSnapshot.exists) {
    const targetEmail = String(targetSnapshot.get("email") || "").trim().toLowerCase();
    const targetAuthUid = asString(targetSnapshot.get("auth_uid"));
    if ((targetEmail && targetEmail !== EMAIL) || (targetAuthUid && targetAuthUid !== userId)) {
      throw new Error("O ID Bizneo já está associado a outro perfil RH.");
    }
  }

  const sourceCollections = await sourceRef.listCollections();
  for (const collection of sourceCollections) {
    const documents = await collection.get();
    for (const document of documents.docs) {
      await targetRef.collection(collection.id).doc(document.id).set(document.data(), { merge: true });
    }
  }

  const now = new Date().toISOString();
  await targetRef.set({
    ...sourceSnapshot.data(),
    auth_uid: userId,
    source_user_id: userId,
    bizneo_employee_id: BIZNEO_ID,
    registration_id_pdv: PDV_ID,
    pdv_operator_ids: { [KIOSK_ID]: Number(PDV_ID) },
    unit_id: DP_UNIT_ID,
    status: "active",
    externalLinksUpdatedAt: now,
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });

  const verification = await targetRef.get();
  if (!verification.exists || verification.get("auth_uid") !== userId || String(verification.get("bizneo_employee_id")) !== BIZNEO_ID) {
    throw new Error("Falha ao validar o perfil RH no ID do Bizneo.");
  }

  for (const collection of sourceCollections) {
    const documents = await collection.get();
    for (const document of documents.docs) await document.ref.delete();
  }
  await sourceRef.delete();
  return { movedCollections: sourceCollections.map((collection) => collection.id) };
}

const before = await loadProcess();
const signatureSnapshot = await hrDb.collection("hrSignatureDocuments").where("onboardingId", "==", PROCESS_ID).get();
const requiredDocuments = Array.isArray(before.documents) ? before.documents.filter((document) => document.required === true) : [];
const completionReady =
  before.asoWorkflow?.status === "completed" &&
  before.accountantWorkflow?.status === "completed" &&
  before.signatureWorkflow?.status === "completed" &&
  requiredDocuments.every((document) => document.status === "approved") &&
  signatureSnapshot.docs.some((document) => document.get("selected") === true && ["signed", "signed_archived_pending_employee", "archived"].includes(String(document.get("status"))));

const existingUsers = await db.collection("users").where("email", "==", EMAIL).get();
const recoverableExistingUser = existingUsers.size === 1
  && existingUsers.docs[0].get("source") === "recruitment_onboarding"
  && existingUsers.docs[0].get("onboardingId") === PROCESS_ID;
let authExists = true;
try { await auth.getUserByEmail(EMAIL); } catch { authExists = false; }
const plan = {
  apply: APPLY,
  processId: PROCESS_ID,
  candidate: before.candidateName,
  email: EMAIL,
  currentStage: before.currentStage,
  currentStatus: before.status,
  completionReady,
  profileId: PROFILE_ID,
  employmentRelationshipType: "clt",
  bizneo: { id: BIZNEO_ID, matchedBy: "email", activeContractStart: "2026-07-08" },
  pdv: { id: PDV_ID, name: "Sara Coelho", kioskId: KIOSK_ID, branchId: PDV_BRANCH_ID, active: true },
  existingCoalaUsers: existingUsers.size,
  recoverableExistingUser,
  authExists,
  emailsToSend: ["first_access"],
  skippedEmails: ["formalization_started", "aso_clinic", "aso_candidate", "accountant"],
};

if (!APPLY) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
if (!completionReady) throw new Error("As evidências anteriores não estão completas; conclusão interrompida.");
if (existingUsers.size > 0 && !asString(before.collaboratorUserId) && !recoverableExistingUser) {
  throw new Error("Já existe usuário Coala com este e-mail fora do processo; conclusão interrompida.");
}
if (authExists && !asString(before.collaboratorUserId) && !recoverableExistingUser) {
  throw new Error("Já existe usuário Auth com este e-mail fora do processo; conclusão interrompida.");
}

const startedAt = new Date().toISOString();
await processRef.set({
  employmentRelationshipType: "clt",
  priorStagesCompletion: {
    status: "completed",
    completedAt: startedAt,
    completedBy: ACTOR_ID,
    source: "manual_verified_completion",
    emailsSkipped: ["formalization_started", "aso_clinic", "aso_candidate", "accountant"],
  },
  updatedAt: startedAt,
}, { merge: true });

const token = await adminIdToken();
for (const workflowDocument of signatureSnapshot.docs) {
  if (workflowDocument.get("selected") !== true || workflowDocument.get("signatureRequestId")) continue;
  const signatureRequestId = `manual_import_${workflowDocument.id}`;
  await Promise.all([
    workflowDocument.ref.set({ signatureRequestId, updatedAt: new Date().toISOString() }, { merge: true }),
    hrDb.collection("hrSignatureRequests").doc(signatureRequestId).set({
      onboardingId: PROCESS_ID,
      workflowDocumentId: workflowDocument.id,
      status: "signed",
      source: "manual_import",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true }),
  ]);
}
let current = await loadProcess();
const transitions = [];
for (const nextStage of ["accountant", "signature", "formalization_validation"]) {
  current = await loadProcess();
  if (current.currentStage === nextStage) continue;
  if (asString(current.collaboratorUserId)) break;
  const stageOrder = ["document_review", "accountant", "signature", "formalization_validation"];
  if (stageOrder.indexOf(String(current.currentStage)) > stageOrder.indexOf(nextStage)) continue;
  await onboardingAction(token, { action: "advance_stage", currentStage: nextStage });
  transitions.push(nextStage);
}

current = await loadProcess();
let collaboratorUserId = asString(current.collaboratorUserId);
let firstAccessEmailTriggered = false;
if (!collaboratorUserId) {
  const result = await onboardingAction(token, { action: "create_collaborator" });
  collaboratorUserId = asString(result.collaboratorUserId);
  firstAccessEmailTriggered = true;
}
if (!collaboratorUserId) throw new Error("A criação não retornou o usuário colaborador.");

const userRef = db.collection("users").doc(collaboratorUserId);
const userSnapshot = await userRef.get();
if (!userSnapshot.exists || String(userSnapshot.get("email") || "").trim().toLowerCase() !== EMAIL) {
  throw new Error("Usuário criado não corresponde à Sara.");
}
const profileSnapshot = await db.collection("profiles").doc(PROFILE_ID).get();
if (!profileSnapshot.exists) throw new Error("Perfil de permissão esperado não existe.");
const currentClaims = (await auth.getUser(collaboratorUserId)).customClaims || {};
await auth.setCustomUserClaims(collaboratorUserId, {
  ...currentClaims,
  profileId: PROFILE_ID,
  isDefaultAdmin: false,
});

const linkedAt = new Date().toISOString();
await userRef.set({
  profileId: PROFILE_ID,
  employmentRelationshipType: "clt",
  registrationIdBizneo: BIZNEO_ID,
  registrationIdPdv: PDV_ID,
  pdvOperatorIds: { [KIOSK_ID]: Number(PDV_ID) },
  assignedKioskIds: [KIOSK_ID],
  unitIds: [before.unitId],
  operacional: true,
  participatesInGoals: true,
  externalLinksUpdatedAt: linkedAt,
  updatedAt: linkedAt,
}, { merge: true });

const moveResult = await copyEmployeeRecordToBizneoId(collaboratorUserId);
const collaboratorDocuments = await hrDb.collection("employeeDocuments").where("employeeId", "==", collaboratorUserId).get();
for (const document of collaboratorDocuments.docs) {
  if (document.get("signatureStatus") !== "signed") continue;
  await document.ref.set({ signatureRequired: true, updatedAt: new Date().toISOString() }, { merge: true });
}
const integrationAlerts = [
  {
    id: "bizneo_id",
    label: "Bizneo HR",
    status: "resolved",
    message: `Cadastro sincronizado pelo e-mail (ID ${BIZNEO_ID}).`,
    checkedAt: linkedAt,
    externalId: BIZNEO_ID,
    source: "bizneo_api",
  },
  {
    id: "pdv_id",
    label: "PDV Legal",
    status: "resolved",
    message: `Usuário PDV ativo sincronizado na filial ${PDV_BRANCH_ID} (ID ${PDV_ID}).`,
    checkedAt: linkedAt,
    externalId: PDV_ID,
    source: "pdv_api",
  },
];
await processRef.set({
  integrationAlerts,
  externalIdentitySync: {
    status: "completed",
    completedAt: linkedAt,
    completedBy: ACTOR_ID,
    bizneoId: BIZNEO_ID,
    pdvId: PDV_ID,
    kioskId: KIOSK_ID,
    pdvBranchId: PDV_BRANCH_ID,
  },
  updatedAt: linkedAt,
}, { merge: true });

let completionProcess = await loadProcess();
if (completionProcess.firstAccess?.status === "used") {
  const accessProvisioning = completionProcess.accessProvisioning && typeof completionProcess.accessProvisioning === "object"
    ? completionProcess.accessProvisioning
    : {};
  const accessEmail = accessProvisioning.email && typeof accessProvisioning.email === "object"
    ? accessProvisioning.email
    : {};
  if (accessEmail.status !== "delivered") {
    const confirmedAt = completionProcess.firstAccess.usedAt || new Date().toISOString();
    await processRef.set({
      accessProvisioning: {
        ...accessProvisioning,
        status: "completed",
        email: {
          ...accessEmail,
          status: "delivered",
          deliveredAt: confirmedAt,
          deliveryConfirmationSource: "first_access_used",
        },
      },
      updatedAt: confirmedAt,
    }, { merge: true });
  }
  completionProcess = await loadProcess();
  if (completionProcess.currentStage === "formalization_validation") {
    await onboardingAction(token, { action: "advance_stage", currentStage: "integration" });
  }
  completionProcess = await loadProcess();
  if (completionProcess.currentStage === "integration" && completionProcess.integrationAlerts?.every((entry) => entry.status === "resolved")) {
    await onboardingAction(token, { action: "complete" });
  }
}

const [after, finalUser, finalEmployee, communication] = await Promise.all([
  loadProcess(),
  userRef.get(),
  hrDb.collection("employees").doc(BIZNEO_ID).get(),
  hrDb.collection("emailCommunications").doc(`${PROCESS_ID}_first_access`).get(),
]);
const finalAuth = await auth.getUser(collaboratorUserId);
const result = {
  ...plan,
  appliedAt: new Date().toISOString(),
  transitions,
  collaboratorUserId,
  firstAccessEmailTriggered,
  final: {
    stage: after.currentStage,
    status: after.status,
    firstAccessStatus: after.firstAccess?.status || null,
    emailStatus: communication.exists ? communication.get("status") : after.accessProvisioning?.email?.status || null,
    emailProviderId: communication.exists ? communication.get("providerId") || null : null,
    profileId: finalUser.get("profileId"),
    customClaimProfileId: finalAuth.customClaims?.profileId || null,
    employmentRelationshipType: finalUser.get("employmentRelationshipType"),
    registrationIdBizneo: finalUser.get("registrationIdBizneo"),
    registrationIdPdv: finalUser.get("registrationIdPdv"),
    pdvOperatorIds: finalUser.get("pdvOperatorIds"),
    employeeRecordId: finalEmployee.id,
    employeeAuthUid: finalEmployee.get("auth_uid"),
    integrationAlerts: after.integrationAlerts,
    movedEmployeeCollections: moveResult.movedCollections,
  },
  ok: true,
};
console.log(JSON.stringify(result, null, 2));
