/**
 * Cria ou atualiza, sem mover documentos, o modelo de dossiê dos usuários existentes.
 *
 * Uso:
 *   node --import tsx scripts/backfill-employee-document-folder-profiles.mts
 *   node --import tsx scripts/backfill-employee-document-folder-profiles.mts --apply --production --confirm-folder-backfill
 */
import { FieldPath, Timestamp } from "firebase-admin/firestore";

import { dbAdmin } from "../src/lib/firebase-admin";
import { hrDbAdmin } from "../src/lib/firebase-rh-admin";
import { employeeDossierTemplate } from "../src/lib/hr/employee-document-folder-templates";

const apply = process.argv.includes("--apply");
const production = process.argv.includes("--production");
const confirmed = process.argv.includes("--confirm-folder-backfill");
const expectedProjectId = "smart-converter-752gf";
const projectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || expectedProjectId);
const pageSize = 250;
const maxUsers = 5_000;

if (apply && (!production || !confirmed)) {
  throw new Error("Produção exige --apply --production --confirm-folder-backfill.");
}
if (apply && projectId !== expectedProjectId) {
  throw new Error(`Projeto inesperado: ${projectId}.`);
}

async function readUsers() {
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let lastId: string | null = null;
  while (documents.length <= maxUsers) {
    let query = dbAdmin.collection("users").orderBy(FieldPath.documentId()).limit(pageSize);
    if (lastId) query = query.startAfter(lastId);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.size < pageSize) return documents;
    lastId = snapshot.docs.at(-1)?.id ?? null;
  }
  throw new Error(`A coleção users excedeu o limite de ${maxUsers}.`);
}

const users = await readUsers();
const candidates = users.flatMap((user) => {
  const relationship = user.get("employmentRelationshipType");
  const template = employeeDossierTemplate(relationship);
  if (!template) return [];
  const employeeId = String(user.get("hrEmployeeId") || user.get("registrationIdBizneo") || user.id).trim();
  if (!employeeId) throw new Error(`Usuário ${user.id} sem identificador de dossiê.`);
  return [{ userId: user.id, employeeId, relationship, template }];
});
const duplicates = candidates.filter((entry, index) => candidates.findIndex((candidate) => candidate.employeeId === entry.employeeId) !== index);
if (duplicates.length) throw new Error("Há usuários diferentes apontando para o mesmo cadastro RH; backfill interrompido.");

const profiles = candidates.length
  ? await hrDbAdmin.getAll(...candidates.map((candidate) => hrDbAdmin.collection("employeeDocumentFolderProfiles").doc(candidate.employeeId)))
  : [];
const plan = candidates.map((candidate, index) => {
  const profile = profiles[index];
  const currentTemplateId = profile.exists ? String(profile.get("templateId") || "") : null;
  const currentTemplateVersion = profile.exists ? Number(profile.get("templateVersion") || 0) : null;
  const action = !profile.exists
    ? "create"
    : currentTemplateId === candidate.template.id && currentTemplateVersion === candidate.template.version
      ? "skip-current"
      : currentTemplateId === candidate.template.id && Number(currentTemplateVersion) < candidate.template.version
        ? "upgrade"
      : "review-existing";
  return { ...candidate, action, currentTemplateId, currentTemplateVersion };
});

const counts = plan.reduce<Record<string, number>>((summary, entry) => {
  const key = `${entry.template.id}:${entry.action}`;
  summary[key] = (summary[key] ?? 0) + 1;
  return summary;
}, {});
const unsupported = users.length - candidates.length;
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  projectId,
  usersRead: users.length,
  supportedUsers: candidates.length,
  unsupportedUsers: unsupported,
  counts,
  creates: plan.filter((entry) => entry.action === "create").length,
  current: plan.filter((entry) => entry.action === "skip-current").length,
  reviewExisting: plan.filter((entry) => entry.action === "review-existing").length,
}, null, 2));

if (!apply) process.exit(0);
if (plan.some((entry) => entry.action === "review-existing")) {
  throw new Error("Há modelos existentes divergentes; revise-os separadamente antes de aplicar.");
}

const changes = plan.filter((entry) => entry.action === "create" || entry.action === "upgrade");
const actorId = "migration:employee-document-folder-profiles-v2";
for (let offset = 0; offset < changes.length; offset += 200) {
  const now = Timestamp.now();
  const batch = hrDbAdmin.batch();
  for (const entry of changes.slice(offset, offset + 200)) {
    const ref = hrDbAdmin.collection("employeeDocumentFolderProfiles").doc(entry.employeeId);
    const payload = {
      employeeId: entry.employeeId,
      templateId: entry.template.id,
      templateVersion: entry.template.version,
      templateLabel: entry.template.label,
      folders: entry.template.folders,
      sourceRelationshipType: entry.relationship,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      source: "existing_users_backfill",
    };
    if (entry.action === "create") batch.create(ref, { ...payload, createdAt: now, createdBy: actorId });
    else batch.set(ref, payload, { merge: true });
    batch.create(ref.collection("audit").doc(), {
      action: entry.action === "create" ? "FOLDER_TEMPLATE_CREATED" : "FOLDER_TEMPLATE_RECONCILED",
      templateId: entry.template.id,
      templateVersion: entry.template.version,
      actorId,
      source: "existing_users_backfill",
      at: now,
    });
  }
  await batch.commit();
}

console.log(JSON.stringify({
  created: changes.filter((entry) => entry.action === "create").length,
  upgraded: changes.filter((entry) => entry.action === "upgrade").length,
  unchanged: plan.length - changes.length,
}, null, 2));
