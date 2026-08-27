import { readFileSync } from "node:fs";

import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { CnpjValidator } from "../src/lib/company/cnpj-validator";

const APPLY = process.argv.includes("--apply");
const userIdIndex = process.argv.indexOf("--user-id");
const ONLY_USER_ID = userIdIndex >= 0 ? process.argv[userIdIndex + 1]?.trim() : null;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH não configurado.");

const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
const app = initializeApp({ credential: cert(serviceAccount) }, `termination-employer-backfill-${Date.now()}`);
const db = getFirestore(app, "coala");
const hrDb = getFirestore(app, "coala-rh");

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type EmployerSource = {
  unitId: string | null;
  legalName: string;
  cnpj: string;
  address: string;
};

async function unitFallback(source: EmployerSource) {
  if (!source.unitId) return source;
  const unit = await db.collection("dp_units").doc(source.unitId).get();
  if (!unit.exists) return source;
  return {
    unitId: source.unitId,
    legalName: source.legalName || text(unit.get("legalName")) || text(unit.get("name")) || "",
    cnpj: source.cnpj || text(unit.get("cnpj")) || "",
    address: source.address || text(unit.get("address")) || "",
  };
}

async function employerForUser(user: FirebaseFirestore.DocumentSnapshot): Promise<EmployerSource | null> {
  const stored: EmployerSource = {
    unitId: text(user.get("employerUnitId")),
    legalName: text(user.get("employerUnitName")) || "",
    cnpj: CnpjValidator.clean(text(user.get("employerCnpj")) || ""),
    address: text(user.get("employerAddress")) || "",
  };
  if (CnpjValidator.validate(stored.cnpj).valid) return unitFallback(stored);

  const onboardingId = text(user.get("onboardingId"));
  if (onboardingId) {
    const onboarding = await hrDb.collection("onboardingProcesses").doc(onboardingId).get();
    if (onboarding.exists) {
      const source: EmployerSource = {
        unitId: text(onboarding.get("employerUnitId")),
        legalName: text(onboarding.get("employerUnitName")) || "",
        cnpj: CnpjValidator.clean(text(onboarding.get("employerCnpj")) || ""),
        address: text(onboarding.get("employerAddress")) || "",
      };
      if (CnpjValidator.validate(source.cnpj).valid) return unitFallback(source);
    }
  }

  const employee = await hrDb.collection("employees").doc(user.id).get();
  const employerField = await employee.ref.collection("field_values").doc("employee.employer_cnpj").get();
  const employeeCnpj = CnpjValidator.clean(text(employee.get("employer_cnpj")) || text(employerField.get("value_text")) || "");
  if (!CnpjValidator.validate(employeeCnpj).valid) return null;
  const unitMatch = await db.collection("dp_units").where("cnpj", "==", employeeCnpj).limit(1).get();
  const unit = unitMatch.docs[0] ?? null;
  return unitFallback({
    unitId: text(employee.get("employer_unit_id")) || unit?.id || null,
    legalName: text(employee.get("employer_unit_name")) || text(unit?.get("legalName")) || text(unit?.get("name")) || "",
    cnpj: employeeCnpj,
    address: text(employee.get("employer_address")) || text(unit?.get("address")) || "",
  });
}

async function entityForCnpj(cnpj: string) {
  const byCnpj = await db.collection("entities").where("cnpj", "==", cnpj).limit(1).get();
  if (!byCnpj.empty) return byCnpj.docs[0];
  const byDocument = await db.collection("entities").where("document", "==", cnpj).limit(1).get();
  return byDocument.docs[0] ?? null;
}

const userDocuments = ONLY_USER_ID
  ? [await db.collection("users").doc(ONLY_USER_ID).get()]
  : (await db.collection("users").get()).docs;

const targets: Array<{
  user: FirebaseFirestore.DocumentSnapshot;
  employer: EmployerSource;
  entityId: string | null;
}> = [];
const unresolved: Array<{ id: string; username: string; onboardingId: string | null }> = [];

for (const user of userDocuments) {
  if (!user.exists || user.get("isActive") === false) continue;
  if (!["clt", "pj"].includes(String(user.get("employmentRelationshipType") ?? ""))) continue;
  const employer = await employerForUser(user);
  if (!employer || !employer.legalName) {
    unresolved.push({ id: user.id, username: text(user.get("username")) || user.id, onboardingId: text(user.get("onboardingId")) });
    continue;
  }
  const entity = await entityForCnpj(employer.cnpj);
  targets.push({ user, employer, entityId: entity?.id ?? null });
}

const activeTerminations = (await hrDb.collection("terminationProcesses").get()).docs.filter((process) => (
  !["completed", "cancelled"].includes(String(process.get("status") ?? ""))
  && !CnpjValidator.validate(String(process.get("employer.cnpj") ?? "")).valid
));
const targetsByUser = new Map(targets.map((target) => [target.user.id, target]));
const terminationTargets = activeTerminations.flatMap((process) => {
  const target = targetsByUser.get(String(process.get("employeeId") ?? ""));
  return target ? [{ process, target }] : [];
});

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  requestedUserId: ONLY_USER_ID,
  collaboratorCount: targets.length,
  activeTerminationCount: terminationTargets.length,
  unresolved,
  targets: targets.map(({ user, employer, entityId }) => ({ userId: user.id, username: user.get("username"), employer, entityId })),
}, null, 2));

if (!APPLY || (!targets.length && !terminationTargets.length)) process.exit(0);

const backupId = `termination-employer-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const backupRef = hrDb.collection("system_migration_backups").doc(backupId);
await backupRef.set({
  type: "termination_employer_backfill",
  createdAt: FieldValue.serverTimestamp(),
  collaboratorCount: targets.length,
  terminationCount: terminationTargets.length,
});

for (const target of targets) {
  const employer = {
    unitId: target.employer.unitId,
    entityId: target.entityId,
    legalName: target.employer.legalName,
    tradeName: null,
    cnpj: target.employer.cnpj,
    address: target.employer.address,
    capturedAt: new Date().toISOString(),
  };
  await backupRef.collection("users").doc(target.user.id).set(target.user.data() ?? {});
  await Promise.all([
    target.user.ref.set({
      employerUnitId: employer.unitId,
      employerUnitName: employer.legalName,
      employerCnpj: employer.cnpj,
      employerAddress: employer.address,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    hrDb.collection("employees").doc(target.user.id).set({
      employer_unit_id: employer.unitId,
      employer_unit_name: employer.legalName,
      employer_cnpj: employer.cnpj,
      employer_address: employer.address,
      updated_at: new Date().toISOString(),
    }, { merge: true }),
    hrDb.collection("employees").doc(target.user.id).collection("field_values").doc("employee.employer_cnpj").set({
      field_key: "employee.employer_cnpj",
      value_text: employer.cnpj,
      source: "termination_employer_backfill",
      updated_at: new Date().toISOString(),
    }, { merge: true }),
  ]);
}

for (const { process, target } of terminationTargets) {
  await backupRef.collection("terminationProcesses").doc(process.id).set(process.data() ?? {});
  const employer = {
      unitId: target.employer.unitId,
      entityId: target.entityId,
      legalName: target.employer.legalName,
      tradeName: null,
      cnpj: target.employer.cnpj,
      address: target.employer.address,
      capturedAt: new Date().toISOString(),
  };
  await Promise.all([
    process.ref.set({ employer }, { merge: true }),
    db.collection("processProjections").doc(`termination:${process.id}`).set({
      employerEntityId: employer.entityId,
      employerName: employer.legalName,
      employerCnpj: employer.cnpj,
      syncedAt: new Date().toISOString(),
    }, { merge: true }),
    hrDb.collection("onboardingProcesses").doc(process.id).set({
      employerUnitId: employer.unitId,
      employerUnitName: employer.legalName,
      employerLegalName: employer.legalName,
      employerCnpj: employer.cnpj,
      employerAddress: employer.address,
      employerBackfilledAt: new Date().toISOString(),
    }, { merge: true }),
  ]);
}

await backupRef.set({ appliedAt: FieldValue.serverTimestamp(), unresolved }, { merge: true });
console.log(`Backfill aplicado. Backup: ${backupId}. Pendências manuais: ${unresolved.length}.`);
