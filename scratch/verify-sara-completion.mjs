import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROCESS_ID = "AuN2P9qU5GMQRGvVLc86";
const EMAIL = "sara17ferreira2004@gmail.com";
const BIZNEO_ID = "18681052";
const PDV_ID = "657365";
const PROFILE_ID = "wiwQTNJWPWJhkIgokpPS";
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}
const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId });
const auth = getAuth(app);
const db = getFirestore(app, "coala");
const hrDb = getFirestore(app, "coala-rh");

const processSnap = await hrDb.collection("onboardingProcesses").doc(PROCESS_ID).get();
assert.equal(processSnap.exists, true);
const onboarding = processSnap.data();
const userId = onboarding.collaboratorUserId;
assert.equal(typeof userId, "string");
const [userSnap, employeeSnap, provisionalEmployeeSnap, documentsSnap, communicationSnap, allCommunications] = await Promise.all([
  db.collection("users").doc(userId).get(),
  hrDb.collection("employees").doc(BIZNEO_ID).get(),
  hrDb.collection("employees").doc(userId).get(),
  hrDb.collection("employeeDocuments").where("employeeId", "==", userId).get(),
  hrDb.collection("emailCommunications").doc(`${PROCESS_ID}_first_access`).get(),
  hrDb.collection("emailCommunications").where("onboardingId", "==", PROCESS_ID).get(),
]);
const authUser = await auth.getUser(userId);
const fieldValues = employeeSnap.exists ? await employeeSnap.ref.collection("field_values").get() : null;
const consentEvents = employeeSnap.exists ? await employeeSnap.ref.collection("consentimentos_imagem_voz_historico").get() : null;

assert.equal(userSnap.get("email"), EMAIL);
assert.equal(userSnap.get("profileId"), PROFILE_ID);
assert.equal(authUser.customClaims?.profileId, PROFILE_ID);
assert.equal(userSnap.get("employmentRelationshipType"), "clt");
assert.equal(userSnap.get("registrationIdBizneo"), BIZNEO_ID);
assert.equal(userSnap.get("registrationIdPdv"), PDV_ID);
assert.equal(userSnap.get("pdvOperatorIds")?.tirirical, Number(PDV_ID));
assert.equal(employeeSnap.exists, true);
assert.equal(employeeSnap.get("auth_uid"), userId);
assert.equal(employeeSnap.get("bizneo_employee_id"), BIZNEO_ID);
assert.equal(provisionalEmployeeSnap.exists, false);
assert.equal(onboarding.currentStage, "done");
assert.equal(onboarding.status, "completed");
assert.equal(onboarding.firstAccess?.status, "used");
assert.equal(onboarding.accessProvisioning?.email?.status, "delivered");
assert.equal(onboarding.accessProvisioning?.email?.deliveryConfirmationSource, "first_access_used");
assert.equal(userSnap.get("mustChangePassword"), false);
assert.equal(authUser.disabled, false);
assert.equal(communicationSnap.exists, true);
assert.ok(["accepted", "delivered"].includes(String(communicationSnap.get("status"))));
assert.equal(communicationSnap.get("attempts"), 1);
assert.equal(onboarding.integrationAlerts?.every((entry) => entry.status === "resolved"), true);
assert.ok(documentsSnap.size >= 8);
assert.equal(documentsSnap.docs.some((doc) => doc.get("signatureRequired") === true && doc.get("signatureStatus") === "signed"), true);
assert.ok((fieldValues?.size || 0) > 0);
assert.ok((consentEvents?.size || 0) > 0);

console.log(JSON.stringify({
  ok: true,
  processId: PROCESS_ID,
  userId,
  stage: onboarding.currentStage,
  status: onboarding.status,
  firstAccessStatus: onboarding.firstAccess?.status,
  emailProviderStatus: communicationSnap.get("status"),
  emailDeliveryConfirmation: onboarding.accessProvisioning?.email?.deliveryConfirmationSource,
  profileId: userSnap.get("profileId"),
  relationship: userSnap.get("employmentRelationshipType"),
  bizneoId: userSnap.get("registrationIdBizneo"),
  pdvId: userSnap.get("registrationIdPdv"),
  kioskOperatorId: userSnap.get("pdvOperatorIds")?.tirirical,
  employeeRecordId: employeeSnap.id,
  documentsArchived: documentsSnap.size,
  signedDocuments: documentsSnap.docs.filter((doc) => doc.get("signatureStatus") === "signed").length,
  fieldValues: fieldValues?.size || 0,
  consentHistoryEvents: consentEvents?.size || 0,
  consentHistoryEventIds: consentEvents?.docs.map((doc) => doc.id) || [],
  communications: allCommunications.docs.map((doc) => ({ event: doc.get("event"), status: doc.get("status"), attempts: doc.get("attempts") })),
}, null, 2));
