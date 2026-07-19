import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const MAIN_DATABASE = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const CHECKLIST_DATABASE = "coala-checklist";
const SOURCE_UNIT_ID = "LQ9G80oYTwMaDBMdkdXl";
const TARGET_UNIT_ID = "bBIkV8wIXfEz4CuO1F2e";
const SOURCE_ORGANIZATION_ID = "5xkZiRitLzQ4qWnhfUfn";
const BACKUP_ID = "admin-cta-into-matrix-v1-20260719";
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

if (APPLY && ROLLBACK) throw new Error("Use apenas --apply ou --rollback.");

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) return cert(JSON.parse(readFileSync(path, "utf8")));
  return applicationDefault();
}

function replaceValue(values, from, to) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => value === from ? to : value)));
}

function stableValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value?.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

async function fetchBizneoTaxon(taxonId) {
  const token = process.env.BIZNEO_TOKEN;
  if (!token) return { verified: false, reason: "BIZNEO_TOKEN não configurado" };
  let page = 1;
  while (page <= 100) {
    const response = await fetch(`https://coala.bizneohr.com/api/v1/taxons?token=${encodeURIComponent(token)}&page_size=100&page=${page}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Falha ao validar taxon no Bizneo: HTTP ${response.status}.`);
    const payload = await response.json();
    const taxons = Array.isArray(payload.taxons) ? payload.taxons : [];
    const match = taxons.find((taxon) => Number(taxon.id) === Number(taxonId));
    if (match) return { verified: true, taxon: match };
    const totalPages = Number(payload.pagination?.total_pages ?? page);
    if (taxons.length === 0 || page >= totalPages) break;
    page += 1;
  }
  return { verified: false, reason: `Taxon ${taxonId} não encontrado no Bizneo` };
}

const app = getApps()[0] ?? initializeApp({ credential: credential(), projectId: PROJECT_ID });
const mainDb = getFirestore(app, MAIN_DATABASE);
const checklistDb = getFirestore(app, CHECKLIST_DATABASE);
const backupRef = mainDb.collection("system_migration_backups").doc(BACKUP_ID);

async function readContext() {
  const [source, target, organization, users, definitions, schedules, goals, checklistProjects] = await Promise.all([
    mainDb.collection("dp_units").doc(SOURCE_UNIT_ID).get(),
    mainDb.collection("dp_units").doc(TARGET_UNIT_ID).get(),
    mainDb.collection("dp_unitOrganizations").doc(SOURCE_ORGANIZATION_ID).get(),
    mainDb.collection("users").where("unitIds", "array-contains", SOURCE_UNIT_ID).get(),
    mainDb.collection("dp_shiftDefinitions").where("unitIds", "array-contains", SOURCE_UNIT_ID).get(),
    mainDb.collection("dp_schedules").where("unitId", "==", SOURCE_UNIT_ID).get(),
    mainDb.collection("employeeGoals").get(),
    checklistDb.collection("form_projects").where("unit_id", "in", [SOURCE_UNIT_ID, TARGET_UNIT_ID]).get(),
  ]);

  if (!source.exists || source.get("name") !== "Administrativo/CTA") throw new Error("Unidade de origem não confere.");
  if (!target.exists || target.get("externalId") !== "matriz") throw new Error("Unidade Matriz/CD não confere.");
  if (!organization.exists || organization.get("name") !== "Administrativo") throw new Error("Organização administrativa não confere.");
  if (users.size !== 1) throw new Error(`Esperava 1 colaborador vinculado; encontrei ${users.size}.`);
  if (definitions.size !== 1) throw new Error(`Esperava 1 definição de turno; encontrei ${definitions.size}.`);
  if (schedules.size !== 3) throw new Error(`Esperava 3 escalas históricas; encontrei ${schedules.size}.`);

  const shifts = [];
  for (const schedule of schedules.docs) {
    const snapshot = await schedule.ref.collection("shifts").get();
    for (const shift of snapshot.docs) shifts.push(shift);
  }
  if (shifts.length !== 20) throw new Error(`Esperava 20 jornadas históricas; encontrei ${shifts.length}.`);

  const impactedUserIds = new Set(users.docs.map((doc) => doc.id));
  const impactedGoals = goals.docs.filter((doc) => impactedUserIds.has(doc.get("employeeId")));
  if (impactedGoals.length !== 10) throw new Error(`Esperava 10 metas protegidas; encontrei ${impactedGoals.length}.`);

  const sourceProject = checklistProjects.docs.find((doc) => doc.get("unit_id") === SOURCE_UNIT_ID);
  const targetProject = checklistProjects.docs.find((doc) => doc.get("unit_id") === TARGET_UNIT_ID);
  if (!sourceProject || !targetProject) throw new Error("Projetos de formulários das duas unidades não foram encontrados.");

  return { source, target, organization, users, definitions, schedules, shifts, impactedGoals, sourceProject, targetProject };
}

async function createBackup(context) {
  if ((await backupRef.get()).exists) throw new Error(`Backup ${BACKUP_ID} já existe; aplicação duplicada bloqueada.`);
  const records = [
    { database: MAIN_DATABASE, path: context.source.ref.path, data: context.source.data() },
    { database: MAIN_DATABASE, path: context.target.ref.path, data: context.target.data() },
    { database: MAIN_DATABASE, path: context.organization.ref.path, data: context.organization.data() },
    ...context.users.docs.map((doc) => ({ database: MAIN_DATABASE, path: doc.ref.path, data: doc.data() })),
    ...context.definitions.docs.map((doc) => ({ database: MAIN_DATABASE, path: doc.ref.path, data: doc.data() })),
    { database: CHECKLIST_DATABASE, path: context.sourceProject.ref.path, data: context.sourceProject.data() },
    { database: CHECKLIST_DATABASE, path: context.targetProject.ref.path, data: context.targetProject.data() },
  ];

  const batch = mainDb.batch();
  batch.create(backupRef, {
    status: "prepared",
    sourceUnitId: SOURCE_UNIT_ID,
    targetUnitId: TARGET_UNIT_ID,
    createdAt: FieldValue.serverTimestamp(),
    recordCount: records.length,
  });
  for (const record of records) {
    const id = createHash("sha1").update(`${record.database}:${record.path}`).digest("hex");
    batch.create(backupRef.collection("documents").doc(id), record);
  }
  await batch.commit();
}

async function restoreBackup(status = "rolled_back") {
  const backup = await backupRef.get();
  if (!backup.exists) throw new Error(`Backup ${BACKUP_ID} não encontrado.`);
  const records = await backupRef.collection("documents").get();
  const byDatabase = new Map();
  for (const record of records.docs) {
    const data = record.data();
    const list = byDatabase.get(data.database) ?? [];
    list.push(data);
    byDatabase.set(data.database, list);
  }
  for (const [database, entries] of byDatabase) {
    const db = database === CHECKLIST_DATABASE ? checklistDb : mainDb;
    const batch = db.batch();
    for (const entry of entries) batch.set(db.doc(entry.path), entry.data, { merge: false });
    await batch.commit();
  }
  await backupRef.set({ status, restoredAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function verify(context, beforeFingerprints) {
  const [sourceDoc, targetDoc, organizationDoc, userDocs, definitionDocs, scheduleDocs, shiftDocs, goalDocs, sourceProjectDoc, targetProjectDoc] = await Promise.all([
    context.source.ref.get(),
    context.target.ref.get(),
    context.organization.ref.get(),
    Promise.all(context.users.docs.map((doc) => doc.ref.get())),
    Promise.all(context.definitions.docs.map((doc) => doc.ref.get())),
    Promise.all(context.schedules.docs.map((doc) => doc.ref.get())),
    Promise.all(context.shifts.map((doc) => doc.ref.get())),
    Promise.all(context.impactedGoals.map((doc) => doc.ref.get())),
    context.sourceProject.ref.get(),
    context.targetProject.ref.get(),
  ]);
  const source = sourceDoc.data();
  const target = targetDoc.data();
  if (source.isArchived !== true || source.mergedIntoUnitId !== TARGET_UNIT_ID || source.is_active !== false) {
    throw new Error("Unidade administrativa não ficou arquivada corretamente.");
  }
  if (organizationDoc.get("isArchived") !== true) throw new Error("Organização administrativa não ficou arquivada.");
  if (target.externalId !== "matriz" || target.externalSource !== "kiosk") throw new Error("Vínculo operacional da Matriz foi alterado.");
  if (target.cnpj !== context.target.get("cnpj") || target.address !== context.target.get("address")) {
    throw new Error("CNPJ ou endereço da Matriz foi alterado.");
  }
  for (const user of userDocs) {
    if (user.get("unitIds")?.includes(SOURCE_UNIT_ID) || !user.get("unitIds")?.includes(TARGET_UNIT_ID)) {
      throw new Error("Vínculo atual do colaborador não foi migrado.");
    }
    const original = context.users.docs.find((doc) => doc.id === user.id);
    if (fingerprint(user.get("assignedKioskIds")) !== fingerprint(original?.get("assignedKioskIds"))) {
      throw new Error("assignedKioskIds foi alterado indevidamente.");
    }
  }
  for (const definition of definitionDocs) {
    if (definition.get("unitIds")?.includes(SOURCE_UNIT_ID) || !definition.get("unitIds")?.includes(TARGET_UNIT_ID)) {
      throw new Error("Definição de turno não foi migrada.");
    }
  }
  if (scheduleDocs.some((doc) => doc.get("unitId") !== SOURCE_UNIT_ID)) throw new Error("Escala histórica foi reatribuída.");
  if (shiftDocs.some((doc) => doc.get("unitId") !== SOURCE_UNIT_ID)) throw new Error("Jornada histórica foi reatribuída.");
  for (const goal of goalDocs) {
    if (fingerprint(goal.data()) !== beforeFingerprints.goals.get(goal.id)) throw new Error(`Meta ${goal.id} foi alterada.`);
  }
  if (sourceProjectDoc.get("is_active") !== false || sourceProjectDoc.get("merged_into_unit_id") !== TARGET_UNIT_ID) {
    throw new Error("Projeto de formulários administrativo não foi desativado.");
  }
  if (targetProjectDoc.get("is_active") === false) throw new Error("Projeto de formulários da Matriz foi desativado.");
}

if (ROLLBACK) {
  await restoreBackup();
  console.log(`Rollback concluído a partir de ${BACKUP_ID}.`);
  process.exit(0);
}

const context = await readContext();
const beforeFingerprints = {
  goals: new Map(context.impactedGoals.map((doc) => [doc.id, fingerprint(doc.data())])),
};
const taxonId = context.source.get("bizneoTaxonId");
const taxonValidation = taxonId ? await fetchBizneoTaxon(taxonId) : { verified: false, reason: "Origem sem taxon" };

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  source: { id: context.source.id, name: context.source.get("name"), taxonId },
  target: { id: context.target.id, name: context.target.get("name"), externalId: context.target.get("externalId") },
  affected: {
    users: context.users.size,
    shiftDefinitions: context.definitions.size,
    historicalSchedulesPreserved: context.schedules.size,
    historicalShiftsPreserved: context.shifts.length,
    protectedGoals: context.impactedGoals.length,
    checklistProjects: 2,
  },
  bizneoTaxon: taxonValidation,
}, null, 2));

if (!APPLY) {
  console.log("Dry-run concluído. Nenhum dado foi alterado.");
  process.exit(0);
}

if (!taxonValidation.verified) throw new Error(`Aplicação bloqueada: ${taxonValidation.reason}.`);

await createBackup(context);
try {
  const mainBatch = mainDb.batch();
  mainBatch.update(context.source.ref, {
    isArchived: true,
    is_active: false,
    mergedIntoUnitId: TARGET_UNIT_ID,
    mergedIntoUnitName: context.target.get("name"),
    archivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  mainBatch.update(context.target.ref, {
    bizneoTaxonId: taxonId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  mainBatch.update(context.organization.ref, {
    isArchived: true,
    archivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  for (const user of context.users.docs) {
    mainBatch.update(user.ref, {
      unitIds: replaceValue(user.get("unitIds"), SOURCE_UNIT_ID, TARGET_UNIT_ID),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const definition of context.definitions.docs) {
    mainBatch.update(definition.ref, {
      unitId: definition.get("unitId") === SOURCE_UNIT_ID ? TARGET_UNIT_ID : definition.get("unitId"),
      unitIds: replaceValue(definition.get("unitIds"), SOURCE_UNIT_ID, TARGET_UNIT_ID),
      unitName: definition.get("unitName") === context.source.get("name") ? context.target.get("name") : definition.get("unitName"),
      unitNames: replaceValue(definition.get("unitNames"), context.source.get("name"), context.target.get("name")),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await mainBatch.commit();

  const checklistBatch = checklistDb.batch();
  checklistBatch.update(context.sourceProject.ref, {
    is_active: false,
    merged_into_unit_id: TARGET_UNIT_ID,
    merged_into_project_id: context.targetProject.id,
    archived_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  checklistBatch.update(context.targetProject.ref, {
    is_active: true,
    updated_at: FieldValue.serverTimestamp(),
  });
  await checklistBatch.commit();

  await verify(context, beforeFingerprints);
  await backupRef.set({ status: "applied", appliedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`Migração aplicada e verificada. Backup: ${BACKUP_ID}.`);
} catch (error) {
  await restoreBackup("auto_rolled_back");
  throw new Error(`Migração falhou e foi revertida automaticamente: ${error instanceof Error ? error.message : String(error)}`);
}
