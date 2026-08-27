import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const APP_DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const HR_DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_RH_DATABASE_ID || "coala-rh";
const MIGRATION_ID = "standard-person-links-v1-20260731";
const APPLY = process.argv.includes("--apply");

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return string(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function email(value) {
  return string(value).toLowerCase();
}

function strings(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(string).filter(Boolean)))
    : [];
}

function personRecordType(user) {
  const name = normalize(user.username);
  const role = normalize(user.jobRoleName);
  if (name === "luis abelardo") return "test";
  if (name === "isabela dominici silva") return "pj";
  if (role.includes("diretor") || role.includes("presidente") || role.includes("vice-presidente")) return "director";
  if (user.employmentRelationshipType === "pj") return "pj";
  if (user.employmentRelationshipType === "internship") return "internship";
  return "employee";
}

function previous(record, fields) {
  return Object.fromEntries(fields.map((field) => [field, record[field] ?? null]));
}

const app = getApps().find((item) => item.name === "standard-person-links-migration")
  ?? initializeApp({ credential: credential(), projectId: PROJECT_ID }, "standard-person-links-migration");
const db = getFirestore(app, APP_DATABASE_ID);
const hrDb = getFirestore(app, HR_DATABASE_ID);

const [usersSnap, employeesSnap, fieldMapSnap] = await Promise.all([
  db.collection("users").get(),
  hrDb.collection("employees").get(),
  hrDb.collection("schema").doc("field_map").get(),
]);
const users = usersSnap.docs
  .map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }))
  .filter((user) => user.isActive !== false);
const employees = employeesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }));
const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
const employeesByAuth = new Map();
const employeesByEmail = new Map();
for (const employee of employees) {
  for (const authId of [string(employee.auth_uid), string(employee.source_user_id)].filter(Boolean)) {
    const values = employeesByAuth.get(authId) ?? [];
    if (!values.some((item) => item.id === employee.id)) values.push(employee);
    employeesByAuth.set(authId, values);
  }
  const normalizedEmail = email(employee.email);
  if (normalizedEmail) {
    const values = employeesByEmail.get(normalizedEmail) ?? [];
    values.push(employee);
    employeesByEmail.set(normalizedEmail, values);
  }
}

const targets = users.map((user) => {
  const candidates = new Map();
  for (const employee of [
    employeeById.get(string(user.hrEmployeeId)),
    employeeById.get(user.id),
    employeeById.get(string(user.registrationIdBizneo)),
    ...(employeesByAuth.get(user.id) ?? []),
    ...(employeesByEmail.get(email(user.email)) ?? []),
  ]) {
    if (employee) candidates.set(employee.id, employee);
  }
  if (candidates.size > 1) {
    throw new Error(`Vínculo ambíguo para ${user.username ?? user.id}: ${[...candidates.keys()].join(", ")}.`);
  }
  const currentEmployee = candidates.size === 1 ? [...candidates.values()][0] : null;
  const hrEmployeeId = currentEmployee?.id ?? user.id;
  const type = personRecordType(user);
  const unitIds = strings(user.unitIds).length ? strings(user.unitIds) : strings(user.assignedKioskIds);
  return { user, currentEmployee, hrEmployeeId, type, unitIds, createEmployee: !currentEmployee };
});

console.table(targets.map(({ user, currentEmployee, hrEmployeeId, type, createEmployee }) => ({
  usuario: user.username ?? user.email ?? user.id,
  emailAcesso: email(user.email),
  cadastroRhAtual: currentEmployee?.id ?? "—",
  cadastroRhDestino: hrEmployeeId,
  tipo: type,
  acao: createEmployee ? "criar e vincular" : "padronizar vínculo",
})));

if (!APPLY) {
  console.log(`DRY-RUN: ${targets.length} conta(s); ${targets.filter((item) => item.createEmployee).length} cadastro(s) RH seriam criados.`);
  process.exit(0);
}

const appBackupRef = db.collection("system_migration_backups").doc(MIGRATION_ID);
const hrBackupRef = hrDb.collection("system_migration_backups").doc(MIGRATION_ID);
const [appBackup, hrBackup] = await Promise.all([appBackupRef.get(), hrBackupRef.get()]);
if (appBackup.exists || hrBackup.exists) throw new Error(`Migração ${MIGRATION_ID} já aplicada ou iniciada.`);

const now = Timestamp.now();
const userFields = ["hrEmployeeId", "personRecordType", "emailSource", "personLinkVersion"];
const employeeFields = ["auth_uid", "source_user_id", "email", "access_email", "person_record_type", "source", "status", "job_role_id", "unit_id", "profile_completion", "updated_at"];

const appBackupBatch = db.batch();
appBackupBatch.create(appBackupRef, {
  migration: MIGRATION_ID,
  createdAt: now,
  records: targets.map(({ user }) => ({ id: user.id, previous: previous(user, userFields) })),
});
await appBackupBatch.commit();

const hrBackupBatch = hrDb.batch();
hrBackupBatch.create(hrBackupRef, {
  migration: MIGRATION_ID,
  createdAt: now,
  records: targets.map(({ hrEmployeeId, currentEmployee, createEmployee }) => ({
    id: hrEmployeeId,
    createdByMigration: createEmployee,
    previous: currentEmployee ? previous(currentEmployee, employeeFields) : null,
  })),
  fieldMapPrevious: fieldMapSnap.exists
    ? (fieldMapSnap.data()?.fields?.["employee.personal_email"] ?? null)
    : null,
});
await hrBackupBatch.commit();

const hrBatch = hrDb.batch();
for (const { user, currentEmployee, hrEmployeeId, type, unitIds } of targets) {
  const employeeRef = hrDb.collection("employees").doc(hrEmployeeId);
  hrBatch.set(employeeRef, {
    bizneo_employee_id: string(currentEmployee?.bizneo_employee_id) || hrEmployeeId,
    auth_uid: user.id,
    source_user_id: user.id,
    source: string(currentEmployee?.source) || "user_link_standardization",
    name: string(user.username) || string(currentEmployee?.name) || user.id,
    email: email(user.email),
    access_email: email(user.email),
    person_record_type: type,
    status: user.isActive === false ? "inactive" : "active",
    job_role_id: string(user.jobRoleId) || string(currentEmployee?.job_role_id) || string(user.profileId) || "sem-cargo",
    unit_id: unitIds[0] || string(currentEmployee?.unit_id) || "sem-unidade",
    profile_completion: Number.isFinite(currentEmployee?.profile_completion) ? currentEmployee.profile_completion : 0,
    synced_at: currentEmployee?.synced_at ?? now,
    created_at: currentEmployee?.created_at ?? now,
    updated_at: now,
    person_link_version: 1,
  }, { merge: true });
}

const existingFields = fieldMapSnap.exists && fieldMapSnap.data()?.fields && typeof fieldMapSnap.data().fields === "object"
  ? fieldMapSnap.data().fields
  : {};
const existingEmailField = existingFields["employee.personal_email"] && typeof existingFields["employee.personal_email"] === "object"
  ? existingFields["employee.personal_email"]
  : {};
hrBatch.set(hrDb.collection("schema").doc("field_map"), {
  fields: {
    ...existingFields,
    "employee.personal_email": {
      ...existingEmailField,
      label: "E-mail de acesso",
      required: true,
      employee_visible: true,
      employee_editable: false,
      help_text: "Mesmo e-mail utilizado para entrar no Coala One. Não existe um segundo e-mail pessoal.",
    },
  },
  updated_at: now,
  updated_by: `migration:${MIGRATION_ID}`,
}, { merge: true });
await hrBatch.commit();

const userBatch = db.batch();
for (const { user, hrEmployeeId, type } of targets) {
  userBatch.set(db.collection("users").doc(user.id), {
    hrEmployeeId,
    personRecordType: type,
    ...(type === "pj" ? { employmentRelationshipType: "pj" } : {}),
    emailSource: "firebase_auth",
    personLinkVersion: 1,
    personLinkUpdatedAt: FieldValue.serverTimestamp(),
    personLinkUpdatedBy: `migration:${MIGRATION_ID}`,
  }, { merge: true });
}
await userBatch.commit();

console.log(`APLICADO: ${targets.length} conta(s) padronizadas; ${targets.filter((item) => item.createEmployee).length} cadastro(s) RH criados.`);
