import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const MAIN_DATABASE = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const CHECKLIST_DATABASE = "coala-checklist";
const SOURCE_UNIT_ID = "LQ9G80oYTwMaDBMdkdXl";
const TARGET_UNIT_ID = "bBIkV8wIXfEz4CuO1F2e";
const SOURCE_ORGANIZATION_ID = "5xkZiRitLzQ4qWnhfUfn";
const USER_ID = "fvrLOh1JOIOtU5QhZQZydN3UBf22";
const SHIFT_DEFINITION_ID = "K8IVPQGVG271NIyzV8gV";
const BACKUP_ID = "admin-cta-into-matrix-v1-20260719";
const EXPECTED_CNPJ = "14276603000397";
const EXPECTED_ADDRESS = "Edifício Adriana - Av. Cel. Colares Moreira, 01, Qda. 121, 1º andar - mesmo prédio da Pharmapele, Renascença, São Luís - MA, CEP 65075-440";
const EXPECTED_TAXON_ID = 16109583;

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId: PROJECT_ID });
const db = getFirestore(app, MAIN_DATABASE);
const checklistDb = getFirestore(app, CHECKLIST_DATABASE);

const [source, target, organization, user, definition, schedules, goals, backup, backupDocuments, projects] = await Promise.all([
  db.collection("dp_units").doc(SOURCE_UNIT_ID).get(),
  db.collection("dp_units").doc(TARGET_UNIT_ID).get(),
  db.collection("dp_unitOrganizations").doc(SOURCE_ORGANIZATION_ID).get(),
  db.collection("users").doc(USER_ID).get(),
  db.collection("dp_shiftDefinitions").doc(SHIFT_DEFINITION_ID).get(),
  db.collection("dp_schedules").where("unitId", "==", SOURCE_UNIT_ID).get(),
  db.collection("employeeGoals").where("employeeId", "==", USER_ID).get(),
  db.collection("system_migration_backups").doc(BACKUP_ID).get(),
  db.collection("system_migration_backups").doc(BACKUP_ID).collection("documents").get(),
  checklistDb.collection("form_projects").where("unit_id", "in", [SOURCE_UNIT_ID, TARGET_UNIT_ID]).get(),
]);

assert.equal(source.exists, true, "Unidade histórica de origem ausente");
assert.equal(source.get("isArchived"), true, "Origem não está arquivada");
assert.equal(source.get("is_active"), false, "Origem ainda está ativa");
assert.equal(source.get("mergedIntoUnitId"), TARGET_UNIT_ID, "Destino da incorporação incorreto");
assert.equal(target.exists, true, "Unidade Matriz ausente");
assert.equal(target.get("isArchived"), undefined, "Matriz foi arquivada indevidamente");
assert.equal(target.get("externalSource"), "kiosk", "Fonte operacional da Matriz mudou");
assert.equal(target.get("externalId"), "matriz", "Quiosque da Matriz mudou");
assert.equal(target.get("cnpj"), EXPECTED_CNPJ, "CNPJ da Matriz divergiu");
assert.equal(target.get("address"), EXPECTED_ADDRESS, "Endereço da Matriz divergiu");
assert.equal(Number(target.get("bizneoTaxonId")), EXPECTED_TAXON_ID, "Taxon Bizneo da Matriz divergiu");
assert.equal(organization.get("isArchived"), true, "Organização Administrativa continua ativa");

assert.equal(user.get("unitIds").includes(SOURCE_UNIT_ID), false, "Usuário ainda vinculado à origem");
assert.equal(user.get("unitIds").includes(TARGET_UNIT_ID), true, "Usuário não vinculado à Matriz");
assert.deepEqual(user.get("assignedKioskIds"), ["joao-paulo", "matriz", "tirirical"], "Quiosques atribuídos mudaram");
assert.deepEqual(user.get("responsibleUnitIds"), ["WRyOCQrPPQIn4wJJTXaQ", "pvLHa7BtW826JmhMkTJA"], "Responsabilidades mudaram");

assert.equal(definition.get("unitId"), TARGET_UNIT_ID, "Definição de turno ainda aponta para a origem");
assert.equal(definition.get("unitIds").includes(SOURCE_UNIT_ID), false, "Definição contém a origem");
assert.equal(definition.get("unitIds").includes(TARGET_UNIT_ID), true, "Definição não contém a Matriz");

assert.equal(schedules.size, 3, "Quantidade de escalas históricas divergiu");
let shiftCount = 0;
for (const schedule of schedules.docs) {
  const shifts = await schedule.ref.collection("shifts").get();
  assert.equal(shifts.docs.every((shift) => shift.get("unitId") === SOURCE_UNIT_ID), true, `Turno histórico reatribuído em ${schedule.id}`);
  shiftCount += shifts.size;
}
assert.equal(shiftCount, 20, "Quantidade de turnos históricos divergiu");
assert.equal(goals.size, 10, "Quantidade de metas protegidas divergiu");

const sourceProject = projects.docs.find((doc) => doc.get("unit_id") === SOURCE_UNIT_ID);
const targetProject = projects.docs.find((doc) => doc.get("unit_id") === TARGET_UNIT_ID);
assert.ok(sourceProject, "Projeto de formulários da origem ausente");
assert.ok(targetProject, "Projeto de formulários da Matriz ausente");
assert.equal(sourceProject.get("is_active"), false, "Projeto da origem continua ativo");
assert.equal(sourceProject.get("merged_into_unit_id"), TARGET_UNIT_ID, "Projeto da origem sem destino correto");
assert.notEqual(targetProject.get("is_active"), false, "Projeto da Matriz está inativo");

assert.equal(backup.exists, true, "Backup da migração ausente");
assert.equal(backup.get("status"), "applied", "Backup não registra aplicação concluída");
assert.equal(backupDocuments.size, Number(backup.get("recordCount")), "Backup incompleto");

console.log(JSON.stringify({
  status: "ok",
  sourceArchived: true,
  target: { id: TARGET_UNIT_ID, cnpj: EXPECTED_CNPJ, taxonId: EXPECTED_TAXON_ID },
  currentLinks: { users: 1, shiftDefinitions: 1 },
  preservedHistory: { schedules: schedules.size, shifts: shiftCount, goals: goals.size },
  forms: { sourceInactive: true, targetActive: true },
  backup: { id: BACKUP_ID, documents: backupDocuments.size, status: backup.get("status") },
}, null, 2));
