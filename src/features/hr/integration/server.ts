import { hrDbAdmin } from "@/lib/firebase-rh-admin";

import {
  INTEGRATION_TEMPLATE_SCHEMA_VERSION,
  integrationTemplateContentSchema,
  integrationTemplateVersionSchema,
  type IntegrationTemplateVersion,
} from "./schemas";
import { validateIntegrationTemplate } from "./engine";

const COLLECTION = "onboardingTemplates";
const DRAFT_DOC = "current";

export type IntegrationTemplateStatus = "draft" | "published" | "archived";

export type IntegrationTemplateMetadata = {
  id: string;
  name: string;
  description?: string;
  roleId: string;
  functionId: string | null;
  isDefault: boolean;
  status: IntegrationTemplateStatus;
  currentVersion: number;
  hasDraft: boolean;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  updatedAt: string;
  updatedBy: string;
  updatedByName: string;
  publishedAt: string | null;
  archivedAt: string | null;
};

type Actor = { userId: string; name: string };

export type IntegrationTemplateCreateInput = {
  name: string;
  description?: string;
  roleId: string;
  functionId?: string | null;
  isDefault?: boolean;
  cloneFromTemplateId?: string;
  cloneFromVersion?: number;
};

export type IntegrationTemplateUpdateInput = {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  content?: unknown;
};

function templateRef(templateId: string) {
  return hrDbAdmin.collection(COLLECTION).doc(templateId);
}

function versionDocId(version: number) {
  return `v${String(version).padStart(6, "0")}`;
}

function versionRef(templateId: string, version: number) {
  return templateRef(templateId).collection("versions").doc(versionDocId(version));
}

function draftRef(templateId: string) {
  return templateRef(templateId).collection("draft").doc(DRAFT_DOC);
}

export function blankIntegrationTemplateContent() {
  return integrationTemplateContentSchema.parse({
    stages: [
      {
        id: "integration",
        label: "Integração",
        order: 0,
        required: true,
        skippable: false,
        dueDays: null,
        dueDateSource: "stage_entry",
      },
    ],
    blocks: [],
    rules: [],
    completionRules: [],
  });
}

async function readCloneContent(input: IntegrationTemplateCreateInput) {
  if (!input.cloneFromTemplateId) return blankIntegrationTemplateContent();
  const sourceMeta = await templateRef(input.cloneFromTemplateId).get();
  if (!sourceMeta.exists) throw new Error("Modelo de origem não encontrado.");
  const sourceVersion = input.cloneFromVersion ?? Number(sourceMeta.get("currentVersion") ?? 0);
  if (sourceVersion < 1) throw new Error("O modelo de origem ainda não possui versão publicada.");
  const source = await versionRef(input.cloneFromTemplateId, sourceVersion).get();
  if (!source.exists) throw new Error("Versão de origem não encontrada.");
  const data = source.data() ?? {};
  return integrationTemplateContentSchema.parse({
    stages: data.stages,
    blocks: data.blocks,
    rules: data.rules,
    communications: data.communications,
    probation: data.probation,
    completionRules: data.completionRules,
  });
}

function metadataFromDoc(id: string, data: Record<string, unknown>): IntegrationTemplateMetadata {
  return {
    id,
    name: String(data.name ?? ""),
    ...(data.description ? { description: String(data.description) } : {}),
    roleId: String(data.roleId ?? ""),
    functionId: typeof data.functionId === "string" && data.functionId ? data.functionId : null,
    isDefault: data.isDefault === true,
    status: data.status === "published" || data.status === "archived" ? data.status : "draft",
    currentVersion: Number(data.currentVersion ?? 0),
    hasDraft: data.hasDraft === true,
    createdAt: String(data.createdAt ?? ""),
    createdBy: String(data.createdBy ?? ""),
    createdByName: String(data.createdByName ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
    updatedBy: String(data.updatedBy ?? ""),
    updatedByName: String(data.updatedByName ?? ""),
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : null,
    archivedAt: typeof data.archivedAt === "string" ? data.archivedAt : null,
  };
}

export async function listIntegrationTemplates(params: {
  roleId?: string;
  functionId?: string | null;
  status?: IntegrationTemplateStatus;
  compatibleOnly?: boolean;
}) {
  let query: FirebaseFirestore.Query = hrDbAdmin.collection(COLLECTION);
  if (params.roleId) query = query.where("roleId", "==", params.roleId);
  const snapshot = await query.get();
  const templates = snapshot.docs
    .map((doc) => metadataFromDoc(doc.id, doc.data()))
    .filter((template) => !params.status || template.status === params.status)
    .filter((template) => {
      if (!params.compatibleOnly) {
        return params.functionId === undefined || template.functionId === params.functionId;
      }
      if (template.status !== "published") return false;
      return template.functionId === null || template.functionId === (params.functionId ?? null);
    });

  return templates.sort((left, right) => {
    const functionId = params.functionId ?? null;
    const leftExact = left.functionId === functionId ? 1 : 0;
    const rightExact = right.functionId === functionId ? 1 : 0;
    return rightExact - leftExact || Number(right.isDefault) - Number(left.isDefault) || right.updatedAt.localeCompare(left.updatedAt);
  });
}

export async function createIntegrationTemplate(input: IntegrationTemplateCreateInput, actor: Actor) {
  const content = await readCloneContent(input);
  const ref = hrDbAdmin.collection(COLLECTION).doc();
  const now = new Date().toISOString();
  const functionId = input.functionId ?? null;
  const metadata = {
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    roleId: input.roleId,
    functionId,
    isDefault: input.isDefault === true,
    status: "draft" as const,
    currentVersion: 0,
    hasDraft: true,
    createdAt: now,
    createdBy: actor.userId,
    createdByName: actor.name,
    updatedAt: now,
    updatedBy: actor.userId,
    updatedByName: actor.name,
    publishedAt: null,
    archivedAt: null,
  };
  const draft: IntegrationTemplateVersion = integrationTemplateVersionSchema.parse({
    schemaVersion: INTEGRATION_TEMPLATE_SCHEMA_VERSION,
    templateId: ref.id,
    version: 1,
    name: input.name,
    description: input.description,
    roleId: input.roleId,
    functionId,
    ...content,
    createdAt: now,
    createdBy: actor.userId,
    publishedAt: null,
  });

  await hrDbAdmin.runTransaction(async (transaction) => {
    if (metadata.isDefault) {
      const peers = await transaction.get(hrDbAdmin.collection(COLLECTION).where("roleId", "==", input.roleId));
      peers.docs
        .filter((doc) => (doc.get("functionId") ?? null) === functionId && doc.get("isDefault") === true)
        .forEach((doc) => transaction.update(doc.ref, { isDefault: false, updatedAt: now }));
    }
    transaction.create(ref, metadata);
    transaction.create(draftRef(ref.id), draft);
  });

  return { metadata: metadataFromDoc(ref.id, metadata), draft };
}

export async function getIntegrationTemplate(templateId: string) {
  const metaSnap = await templateRef(templateId).get();
  if (!metaSnap.exists) return null;
  const metadata = metadataFromDoc(metaSnap.id, metaSnap.data() ?? {});
  const [draftSnap, versionSnap] = await Promise.all([
    draftRef(templateId).get(),
    metadata.currentVersion > 0 ? versionRef(templateId, metadata.currentVersion).get() : Promise.resolve(null),
  ]);
  return {
    metadata,
    draft: draftSnap.exists ? integrationTemplateVersionSchema.parse(draftSnap.data()) : null,
    currentVersion: versionSnap?.exists ? integrationTemplateVersionSchema.parse(versionSnap.data()) : null,
  };
}

export async function updateIntegrationTemplate(templateId: string, input: IntegrationTemplateUpdateInput, actor: Actor) {
  const now = new Date().toISOString();
  await hrDbAdmin.runTransaction(async (transaction) => {
    const ref = templateRef(templateId);
    const metaSnap = await transaction.get(ref);
    if (!metaSnap.exists) throw new Error("Modelo de integração não encontrado.");
    const currentMeta = metadataFromDoc(metaSnap.id, metaSnap.data() ?? {});
    if (currentMeta.status === "archived") throw new Error("Um modelo arquivado não pode ser editado.");

    const currentDraftRef = draftRef(templateId);
    const draftSnap = await transaction.get(currentDraftRef);
    const publishedSnap = !draftSnap.exists && currentMeta.currentVersion > 0
      ? await transaction.get(versionRef(templateId, currentMeta.currentVersion))
      : null;

    const nextName = input.name ?? currentMeta.name;
    const nextDescription = input.description === null ? undefined : input.description ?? currentMeta.description;
    const nextDefault = input.isDefault ?? currentMeta.isDefault;
    let peerDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (nextDefault && !currentMeta.isDefault) {
      const peers = await transaction.get(hrDbAdmin.collection(COLLECTION).where("roleId", "==", currentMeta.roleId));
      peerDocs = peers.docs.filter((doc) => doc.id !== templateId && (doc.get("functionId") ?? null) === currentMeta.functionId && doc.get("isDefault") === true);
    }

    const base = draftSnap.exists
      ? draftSnap.data()
      : publishedSnap?.exists
        ? publishedSnap.data()
        : blankIntegrationTemplateContent();
    const content = input.content
      ? integrationTemplateContentSchema.parse(input.content)
      : integrationTemplateContentSchema.parse(base);
    const draft = integrationTemplateVersionSchema.parse({
      schemaVersion: INTEGRATION_TEMPLATE_SCHEMA_VERSION,
      templateId,
      version: currentMeta.currentVersion + 1,
      name: nextName,
      description: nextDescription,
      roleId: currentMeta.roleId,
      functionId: currentMeta.functionId,
      ...content,
      createdAt: draftSnap.get("createdAt") ?? now,
      createdBy: draftSnap.get("createdBy") ?? actor.userId,
      publishedAt: null,
    });

    peerDocs.forEach((doc) => transaction.update(doc.ref, { isDefault: false, updatedAt: now }));
    transaction.set(currentDraftRef, draft);
    transaction.update(ref, {
      name: nextName,
      description: nextDescription ?? null,
      isDefault: nextDefault,
      hasDraft: true,
      updatedAt: now,
      updatedBy: actor.userId,
      updatedByName: actor.name,
    });
  });
  return getIntegrationTemplate(templateId);
}

export async function publishIntegrationTemplate(templateId: string, actor: Actor) {
  const now = new Date().toISOString();
  let published: IntegrationTemplateVersion | null = null;
  await hrDbAdmin.runTransaction(async (transaction) => {
    const ref = templateRef(templateId);
    const [metaSnap, draftSnap] = await Promise.all([
      transaction.get(ref),
      transaction.get(draftRef(templateId)),
    ]);
    if (!metaSnap.exists) throw new Error("Modelo de integração não encontrado.");
    if (!draftSnap.exists) throw new Error("O modelo não possui alterações em rascunho para publicar.");
    const metadata = metadataFromDoc(metaSnap.id, metaSnap.data() ?? {});
    if (metadata.status === "archived") throw new Error("Um modelo arquivado não pode ser publicado.");
    const draft = integrationTemplateVersionSchema.parse(draftSnap.data());
    const validationErrors = validateIntegrationTemplate(draft).filter((issue) => issue.severity === "error");
    if (validationErrors.length > 0) {
      throw new Error(`O modelo não pode ser publicado: ${validationErrors[0].message}`);
    }
    const nextVersion = metadata.currentVersion + 1;
    if (draft.version !== nextVersion) throw new Error("A versão do rascunho está desatualizada.");
    const targetRef = versionRef(templateId, nextVersion);
    const targetSnap = await transaction.get(targetRef);
    if (targetSnap.exists) throw new Error("Esta versão já foi publicada.");

    published = integrationTemplateVersionSchema.parse({
      ...draft,
      publishedAt: now,
    });
    transaction.create(targetRef, published);
    transaction.delete(draftRef(templateId));
    transaction.update(ref, {
      status: "published",
      currentVersion: nextVersion,
      hasDraft: false,
      publishedAt: now,
      updatedAt: now,
      updatedBy: actor.userId,
      updatedByName: actor.name,
    });
  });
  return published;
}

export async function archiveIntegrationTemplate(templateId: string, actor: Actor) {
  const ref = templateRef(templateId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Modelo de integração não encontrado.");
  const now = new Date().toISOString();
  await ref.update({
    status: "archived",
    isDefault: false,
    archivedAt: now,
    updatedAt: now,
    updatedBy: actor.userId,
    updatedByName: actor.name,
  });
}

export async function getIntegrationTemplateVersion(templateId: string, version: number) {
  const snap = await versionRef(templateId, version).get();
  return snap.exists ? integrationTemplateVersionSchema.parse(snap.data()) : null;
}
