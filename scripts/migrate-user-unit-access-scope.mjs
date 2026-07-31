import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "smart-converter-752gf";
const DATABASE_ID = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || "coala";
const BACKUP_ID = "user-unit-access-scope-v1-20260731";
const APPLY = process.argv.includes("--apply");
const VALID_SCOPES = new Set(["linked", "selected", "all"]);

function credential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  }
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && existsSync(path)) {
    return cert(JSON.parse(readFileSync(path, "utf8")));
  }
  return applicationDefault();
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function isIsabela(user) {
  const haystack = normalize([user.username, user.name, user.email].filter(Boolean).join(" "));
  return haystack.includes("isabela");
}

function buildTarget(user) {
  if (isIsabela(user)) {
    return { unitAccessScope: "all", unitAccessUnitIds: [] };
  }

  const currentScope = VALID_SCOPES.has(user.unitAccessScope)
    ? user.unitAccessScope
    : "linked";
  const selectedIds = currentScope === "selected"
    ? stringArray(user.unitAccessUnitIds)
    : [];

  if (currentScope === "selected" && selectedIds.length === 0) {
    return { unitAccessScope: "linked", unitAccessUnitIds: [] };
  }

  return {
    unitAccessScope: currentScope,
    unitAccessUnitIds: selectedIds,
  };
}

const app = getApps().find((item) => item.name === "unit-access-scope-migration")
  ?? initializeApp({ credential: credential(), projectId: PROJECT_ID }, "unit-access-scope-migration");
const db = getFirestore(app, DATABASE_ID);

const usersSnap = await db.collection("users").get();
const users = usersSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() ?? {}) }));
const isabelas = users.filter(isIsabela);

if (isabelas.length !== 1) {
  throw new Error(`A migração exige exatamente uma Isabela; foram encontradas ${isabelas.length}.`);
}

const changes = users.map((user) => {
  const target = buildTarget(user);
  const currentIds = stringArray(user.unitAccessUnitIds);
  const changed =
    user.unitAccessScope !== target.unitAccessScope ||
    JSON.stringify(currentIds) !== JSON.stringify(target.unitAccessUnitIds);
  return { user, target, changed };
});

console.table(changes.map(({ user, target, changed }) => ({
  id: user.id,
  usuario: user.username ?? user.name ?? user.email ?? "—",
  lotacao: stringArray(user.unitIds).concat(stringArray(user.assignedKioskIds)).join(", ") || "—",
  escopoAtual: user.unitAccessScope ?? "legado (linked)",
  escopoDestino: target.unitAccessScope,
  unidadesSelecionadas: target.unitAccessUnitIds.join(", ") || "—",
  alterar: changed ? "sim" : "não",
})));

if (!APPLY) {
  console.log(`DRY-RUN: ${changes.filter((item) => item.changed).length} usuário(s) seriam atualizados. Use --apply para gravar.`);
  process.exit(0);
}

const backupRef = db.collection("system_migration_backups").doc(BACKUP_ID);
if ((await backupRef.get()).exists) {
  throw new Error(`Backup ${BACKUP_ID} já existe; aplicação duplicada bloqueada.`);
}

const batch = db.batch();
batch.create(backupRef, {
  migration: "user-unit-access-scope-v1",
  createdAt: FieldValue.serverTimestamp(),
  records: users.map((user) => ({
    id: user.id,
    unitAccessScope: user.unitAccessScope ?? null,
    unitAccessUnitIds: stringArray(user.unitAccessUnitIds),
  })),
});

for (const { user, target, changed } of changes) {
  if (!changed) continue;
  batch.set(db.collection("users").doc(user.id), {
    ...target,
    unitAccessUpdatedAt: FieldValue.serverTimestamp(),
    unitAccessUpdatedBy: "migration:user-unit-access-scope-v1",
  }, { merge: true });
}

await batch.commit();
console.log(`APLICADO: ${changes.filter((item) => item.changed).length} usuário(s) atualizados; backup ${BACKUP_ID} criado.`);
