import fs from "node:fs";
import { cert, deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const apply = process.argv.includes("--apply");
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!serviceAccountPath) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH não configurado.");
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
const app = getApps().find((item) => item.name === "onboarding-v2-migration") ?? initializeApp({ credential: cert(serviceAccount) }, "onboarding-v2-migration");
const db = getFirestore(app, "coala-rh");
const now = new Date().toISOString();

function safeId(value) { return String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 400); }
function stages(value) {
  const source = Array.isArray(value) && value.length ? value : [{ id: "integration", label: "Integração", order: 0, required: true }];
  return source.map((stage, order) => ({ id: safeId(stage.id || `stage_${order}`), label: String(stage.label || stage.id || `Etapa ${order + 1}`), order, required: stage.required !== false, skippable: false, dueDays: Number.isFinite(Number(stage.dueDays)) ? Number(stage.dueDays) : null, dueDateSource: stage.id === "probation" ? "admission" : "stage_entry" }));
}
function blocks(stageList, documents) {
  const documentStage = stageList.find((stage) => stage.id === "documents")?.id ?? stageList[0].id;
  const result = (Array.isArray(documents) ? documents : []).map((document, order) => ({ id: `upload_${safeId(document.id || order)}`, stageId: documentStage, order, type: "upload", label: String(document.label || `Documento ${order + 1}`), ...(document.description ? { description: String(document.description) } : {}), required: document.required !== false, readOnly: false, active: true, writePolicy: "process_only", hiddenAnswerPolicy: "exclude", config: { accept: ".pdf,.jpg,.jpeg,.png", approvalRequired: true, legacyDocumentTypeCode: document.documentTypeCode || null } }));
  const probationStage = stageList.find((stage) => stage.id === "probation");
  if (probationStage) result.push({ id: "probation_schedule", stageId: probationStage.id, order: result.filter((block) => block.stageId === probationStage.id).length, type: "probation", label: "Período de experiência", required: true, readOnly: true, active: true, writePolicy: "process_only", hiddenAnswerPolicy: "exclude", config: {} });
  return result;
}
function content(role, fn) {
  const stageList = stages(fn?.onboardingStages?.length ? fn.onboardingStages : role.onboardingStages);
  const documents = fn?.onboardingDocuments?.length ? fn.onboardingDocuments : role.onboardingDocuments;
  return { stages: stageList, blocks: blocks(stageList, documents), rules: [], probation: { firstPeriodDays: 45, secondPeriodDays: 45, evaluationWindowDays: 10, alertsBeforeDays: [10, 5, 1], extensionTermRequired: false, evaluator: { strategy: "direct_manager", fallback: "hr_pool" }, effectivenessRule: "manual" }, completionRules: [] };
}

const [rolesSnapshot, functionsSnapshot, existingSnapshot] = await Promise.all([db.collection("jobRoles").get(), db.collection("jobFunctions").get(), db.collection("onboardingTemplates").get()]);
const existingKeys = new Set(existingSnapshot.docs.map((document) => document.get("legacyMigrationKey")).filter(Boolean));
const candidates = [];
for (const roleDocument of rolesSnapshot.docs) {
  const role = { id: roleDocument.id, ...roleDocument.data() };
  candidates.push({ key: `role:${role.id}`, id: `legacy_role_${safeId(role.id)}`, role, fn: null, name: `Integração · ${role.name || role.publicTitle || role.id}` });
  for (const functionDocument of functionsSnapshot.docs) {
    const fn = { id: functionDocument.id, ...functionDocument.data() };
    if (!Array.isArray(fn.compatibleRoleIds) || !fn.compatibleRoleIds.includes(role.id)) continue;
    if (!fn.onboardingStages?.length && !fn.onboardingDocuments?.length) continue;
    candidates.push({ key: `role:${role.id}:function:${fn.id}`, id: `legacy_role_${safeId(role.id)}_function_${safeId(fn.id)}`, role, fn, name: `Integração · ${role.name || role.id} · ${fn.name || fn.id}` });
  }
}
const pending = candidates.filter((item) => !existingKeys.has(item.key));
console.log(JSON.stringify({ apply, existing: existingSnapshot.size, candidates: candidates.length, pending: pending.map((item) => ({ id: item.id, key: item.key, name: item.name, roleId: item.role.id, functionId: item.fn?.id ?? null })) }, null, 2));

if (apply) for (const item of pending) {
  const templateRef = db.collection("onboardingTemplates").doc(item.id); const versionRef = templateRef.collection("versions").doc("v000001");
  const modelContent = content(item.role, item.fn); const version = { schemaVersion: "coala-integration-v1", templateId: item.id, version: 1, name: item.name, description: "Modelo migrado automaticamente da configuração legada de cargo/função.", roleId: item.role.id, functionId: item.fn?.id ?? null, ...modelContent, createdAt: now, createdBy: "system:migration:onboarding-v2", publishedAt: now };
  await db.runTransaction(async (transaction) => { const exists = await transaction.get(templateRef); if (exists.exists) return; transaction.create(templateRef, { name: item.name, description: version.description, roleId: item.role.id, functionId: item.fn?.id ?? null, isDefault: true, status: "published", currentVersion: 1, hasDraft: false, legacyMigrationKey: item.key, createdAt: now, createdBy: "system:migration:onboarding-v2", createdByName: "Migração Integração V2", updatedAt: now, updatedBy: "system:migration:onboarding-v2", updatedByName: "Migração Integração V2", publishedAt: now, archivedAt: null }); transaction.create(versionRef, version); });
}
console.log(apply ? `${pending.length} modelo(s) processado(s).` : "Simulação concluída. Revise e execute novamente com --apply.");
await deleteApp(app);
