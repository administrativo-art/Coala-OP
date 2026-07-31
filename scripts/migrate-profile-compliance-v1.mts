import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

import { DEFAULT_COMPLEMENTARY_FIELDS } from "../src/features/rh/lib/default-field-map";
import {
  PROFILE_COMPLIANCE_POLICY_VERSION,
  evaluateProfileCompliance,
  isProfileReviewDue,
  profileReviewCycle,
} from "../src/features/hr/profile-compliance";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const APP_DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const HR_DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_RH_DATABASE_ID || "coala-rh";
const MIGRATION_ID = "profile-compliance-v1-20260731";
const APPLY = process.argv.includes("--apply");

const REQUIRED_HR_KEYS = [
  "employee.birth_date",
  "employee.phone",
  "employee.pix_key_type",
  "employee.pix_key",
  "employee.address_zipcode",
  "employee.address_street",
  "employee.address_number",
  "employee.address_no_number",
  "employee.address_neighborhood",
  "employee.city",
  "employee.state",
  "employee.emergency_name",
  "employee.emergency_relation",
  "employee.emergency_phone",
] as const;
const PROFILE_FIELD_KEYS = [
  "employee.personal_email",
  ...REQUIRED_HR_KEYS,
] as const;
const RETIRED_BANK_KEYS = ["employee.bank_name", "employee.bank_agency", "employee.bank_account"] as const;

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const app = getApps().find((item) => item.name === "profile-compliance-v1-migration")
  ?? initializeApp({ credential: credential(), projectId: PROJECT_ID }, "profile-compliance-v1-migration");
const db = getFirestore(app, APP_DATABASE_ID);
const hrDb = getFirestore(app, HR_DATABASE_ID);
const nowDate = new Date();
const now = Timestamp.fromDate(nowDate);
const cycle = profileReviewCycle(nowDate);

const [usersSnap, fieldMapSnap] = await Promise.all([
  db.collection("users").get(),
  hrDb.collection("schema").doc("field_map").get(),
]);
const users = usersSnap.docs
  .filter((document) => document.get("isActive") !== false)
  .map((document) => ({ id: document.id, ...document.data() }));

const evaluations = await Promise.all(users.map(async (user) => {
  const employeeId = String(user.hrEmployeeId ?? user.registrationIdBizneo ?? user.id).trim();
  const employeeRef = hrDb.collection("employees").doc(employeeId);
  const employeeSnap = await employeeRef.get();
  if (!employeeSnap.exists) throw new Error(`Cadastro RH ausente para ${user.username ?? user.id}.`);
  const valueDocs = await Promise.all(REQUIRED_HR_KEYS.map((key) => employeeRef.collection("field_values").doc(key).get()));
  const fieldValues = Object.fromEntries(valueDocs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data()]));
  const previousCompliance = record(user.profileCompliance);
  const result = evaluateProfileCompliance({
    user,
    fieldValues,
    reviewDue: isProfileReviewDue(previousCompliance.lastConfirmedAt, nowDate),
  });
  return { user, employeeId, previousCompliance, result };
}));

console.table(evaluations.map(({ user, employeeId, result }) => ({
  usuario: user.username ?? user.email ?? user.id,
  cadastroRh: employeeId,
  status: result.status,
  faltantes: result.missingFields.length,
  invalidos: result.invalidFields.length,
})));

if (!APPLY) {
  console.log(`DRY-RUN: ${evaluations.length} conta(s), sem qualquer isenção.`);
  process.exit(0);
}

const appBackupRef = db.collection("system_migration_backups").doc(MIGRATION_ID);
const hrBackupRef = hrDb.collection("system_migration_backups").doc(MIGRATION_ID);
const [appBackup, hrBackup] = await Promise.all([appBackupRef.get(), hrBackupRef.get()]);
if (appBackup.exists || hrBackup.exists) throw new Error(`Migração ${MIGRATION_ID} já aplicada ou iniciada.`);

await appBackupRef.create({
  migration: MIGRATION_ID,
  createdAt: now,
  records: evaluations.map(({ user }) => ({ id: user.id, profileCompliance: user.profileCompliance ?? null })),
});
await hrBackupRef.create({
  migration: MIGRATION_ID,
  createdAt: now,
  fieldMapPrevious: fieldMapSnap.data()?.fields ?? null,
});

const existingFields = record(fieldMapSnap.data()?.fields);
const nextFields = { ...existingFields };
for (const key of RETIRED_BANK_KEYS) delete nextFields[key];
for (const key of PROFILE_FIELD_KEYS) {
  nextFields[key] = {
    ...record(existingFields[key]),
    ...DEFAULT_COMPLEMENTARY_FIELDS[key],
  };
}
await hrDb.collection("schema").doc("field_map").set({
  fields: nextFields,
  profile_compliance_policy: {
    version: PROFILE_COMPLIANCE_POLICY_VERSION,
    applies_to: "all_active_human_users",
    exemptions: [],
    review_cycle: "quarterly_fixed",
    review_months: [1, 4, 7, 10],
    access_email_is_canonical: true,
  },
  updated_at: now,
  updated_by: `migration:${MIGRATION_ID}`,
}, { merge: true });

const batch = db.batch();
for (const { user, result, previousCompliance } of evaluations) {
  batch.set(db.collection("users").doc(user.id), {
    profileCompliance: {
      status: result.status,
      policyVersion: result.policyVersion,
      missingFields: result.missingFields,
      invalidFields: result.invalidFields,
      evaluatedAt: now,
      completedAt: result.complete ? (previousCompliance.completedAt ?? now) : null,
      lastConfirmedAt: previousCompliance.lastConfirmedAt ?? null,
      nextReviewAt: Timestamp.fromDate(cycle.nextStart),
    },
    profileComplianceUpdatedAt: FieldValue.serverTimestamp(),
    profileComplianceUpdatedBy: `migration:${MIGRATION_ID}`,
  }, { merge: true });
}
await batch.commit();
const hrCacheBatch = hrDb.batch();
for (const { user, employeeId, result } of evaluations) {
  hrCacheBatch.set(hrDb.collection("rh_access_cache").doc(user.id), {
    auth_uid: user.id,
    bizneo_employee_id: employeeId,
    profile_compliance_status: result.status,
    profile_compliance_policy_version: PROFILE_COMPLIANCE_POLICY_VERSION,
    profile_compliance_next_review_at: Timestamp.fromDate(cycle.nextStart),
    profile_compliance_updated_at: now,
    updated_at: now,
  }, { merge: true });
}
await hrCacheBatch.commit();
console.log(`APLICADO: política obrigatória gravada para ${evaluations.length} conta(s), sem isenções.`);
