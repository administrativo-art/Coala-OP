import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

import { PROFILE_COMPLIANCE_POLICY_VERSION } from "../src/features/hr/profile-compliance";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const APP_DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const HR_DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_RH_DATABASE_ID || "coala-rh";
const MIGRATION_ID = "profile-compliance-cache-v1-20260731";
const APPLY = process.argv.includes("--apply");

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const app = getApps().find((item) => item.name === "profile-compliance-cache-sync")
  ?? initializeApp({ credential: credential(), projectId: PROJECT_ID }, "profile-compliance-cache-sync");
const db = getFirestore(app, APP_DATABASE_ID);
const hrDb = getFirestore(app, HR_DATABASE_ID);
const usersSnap = await db.collection("users").get();
const users = usersSnap.docs.filter((document) => document.get("isActive") !== false);
const currentCaches = await Promise.all(users.map((user) => hrDb.collection("rh_access_cache").doc(user.id).get()));

console.table(users.map((user, index) => {
  const compliance = record(user.get("profileCompliance"));
  return {
    usuario: user.get("username") ?? user.get("email") ?? user.id,
    status: compliance.status ?? "pending",
    cacheExiste: currentCaches[index].exists,
  };
}));

if (!APPLY) {
  console.log(`DRY-RUN: ${users.length} cache(s) de acesso serão sincronizados.`);
  process.exit(0);
}

const backupRef = hrDb.collection("system_migration_backups").doc(MIGRATION_ID);
if (!(await backupRef.get()).exists) {
  await backupRef.create({
    migration: MIGRATION_ID,
    createdAt: Timestamp.now(),
    records: currentCaches.map((cache) => ({ id: cache.id, profileCompliance: {
      status: cache.get("profile_compliance_status") ?? null,
      policyVersion: cache.get("profile_compliance_policy_version") ?? null,
      nextReviewAt: cache.get("profile_compliance_next_review_at") ?? null,
    } })),
  });
}

const batch = hrDb.batch();
for (const user of users) {
  const compliance = record(user.get("profileCompliance"));
  const nextReviewAt = compliance.nextReviewAt;
  const employeeId = String(user.get("hrEmployeeId") ?? user.get("registrationIdBizneo") ?? user.id).trim();
  batch.set(hrDb.collection("rh_access_cache").doc(user.id), {
    auth_uid: user.id,
    bizneo_employee_id: employeeId,
    profile_compliance_status: compliance.status === "complete" ? "complete" : "pending",
    profile_compliance_policy_version: PROFILE_COMPLIANCE_POLICY_VERSION,
    profile_compliance_next_review_at: nextReviewAt && typeof nextReviewAt === "object"
      ? nextReviewAt
      : Timestamp.fromDate(new Date(0)),
    profile_compliance_updated_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  }, { merge: true });
}
await batch.commit();
console.log(`APLICADO: ${users.length} cache(s) de acesso sincronizados, sem exceções.`);
