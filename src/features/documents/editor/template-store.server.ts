import { createHash } from "node:crypto";

import {
  EDITOR_CONTENT_SCHEMA_VERSION,
  collectEditorFieldKeys,
  hashEditorContent,
  parseEditorContent,
  type EditorContent,
} from "./content-schema";
import {
  createEditorDraftInTransaction,
  editorContentVersionRef,
  editorDocumentId,
  editorDocumentRecordFromSnap,
  editorDocumentRef,
  ownedEditorDocument,
  prepareEditorDraft,
} from "./document-store.server";
import {
  EDITOR_TEMPLATE_RECORD_ID_PATTERN,
  EDITOR_TEMPLATE_STATUSES,
  EditorStoreError,
  EditorTemplateError,
  parseEditorOrigin,
  type EditorDocumentRecord,
  type EditorTemplateAuditEventType,
  type EditorTemplateListPage,
  type EditorTemplateRecord,
  type EditorTemplateStatus,
  type EditorTemplateStoreDeps,
  type EditorTemplateVersionRecord,
  type StoreQuery,
  type StoreSnap,
} from "./document-store.types";

export {
  EDITOR_TEMPLATES_COLLECTION,
  EditorTemplateError,
  type EditorTemplateListPage,
  type EditorTemplateRecord,
  type EditorTemplateStoreDeps,
  type EditorTemplateVersionRecord,
} from "./document-store.types";

const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;
export const EDITOR_TEMPLATE_LIST_MAX = 25;
const BLANK_CONTENT: EditorContent = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * Persistência dos modelos do editor (sem rotas/UI). Modelo NÃO tem titular nem dado de pessoa; todo
 * `*By`/`actorId` é ATOR (main.users). Não usa a coleção legada de documentos gerados. Autorização por
 * papel pertence à rota; aqui só se isola por `workspaceId` (vale para todas as unidades do workspace).
 *
 * Custo por operação (leituras + escritas; sem listener, polling ou varredura):
 *  - criar: 1 leitura (+2 com fromDocument) + 3 escritas; salvar: 1 + 3; publicar: 2 + 2; arquivar: 1 + 2;
 *  - obter: 1; obter versão: 2; listar: no máximo limit+1 (<= 26) leituras, por índice;
 *  - usar: 3 leituras (modelo, versão publicada, documento-alvo) + 4 escritas (documento, sua versão 1,
 *    auditoria do documento, auditoria `used` do modelo), tudo em uma transação.
 * Nada é apagado: arquivar apenas muda o status.
 */
export async function defaultEditorTemplateStoreDeps(): Promise<EditorTemplateStoreDeps> {
  const { dbAdmin } = await import("@/lib/firebase-admin");
  return { db: dbAdmin as unknown as EditorTemplateStoreDeps["db"] };
}

function requireText(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new EditorTemplateError("invalid_input", `Campo inválido: ${field}.`);
  }
  return value.trim();
}
function optionalDescription(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > MAX_DESCRIPTION) throw new EditorTemplateError("invalid_input", "Campo inválido: description.");
  return value.trim();
}
function requireVersion(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new EditorTemplateError("invalid_input", `Campo inválido: ${field}.`);
  }
  return value;
}
function requireTemplateId(value: unknown): string {
  if (typeof value !== "string" || !EDITOR_TEMPLATE_RECORD_ID_PATTERN.test(value)) throw new EditorTemplateError("invalid_input", "Campo inválido: templateId.");
  return value;
}
function validateContent(raw: unknown) {
  const parsed = parseEditorContent(raw);
  if (!parsed.ok) throw new EditorTemplateError("invalid_content", "Conteúdo do modelo inválido.");
  return parsed;
}

// Literais exigidos por scripts/check-person-source-registration.mjs (não aceita constante); o teste
// do store garante que são iguais a EDITOR_TEMPLATES_COLLECTION.
function templateRef(deps: EditorTemplateStoreDeps, templateId: string) {
  return deps.db.collection("editorTemplates").doc(templateId);
}
function versionRef(deps: EditorTemplateStoreDeps, templateId: string, version: number) {
  return templateRef(deps, templateId).collection("versions").doc(String(version));
}
function auditRef(deps: EditorTemplateStoreDeps, templateId: string, event: EditorTemplateAuditEventType, version: number, suffix = "") {
  return templateRef(deps, templateId).collection("audit").doc(`template-${event}-v${version}${suffix}`);
}

/** ID determinístico: o mesmo (workspace, ator, clientRequestId) sempre resolve ao mesmo modelo. */
export function editorTemplateId(workspaceId: string, actorId: string, clientRequestId: string): string {
  return `tpl_${createHash("sha256").update(JSON.stringify([workspaceId, actorId, clientRequestId])).digest("hex").slice(0, 32)}`;
}

function readSource(value: unknown): EditorTemplateRecord["source"] {
  const s = value as { kind?: unknown; documentId?: unknown; version?: unknown } | null | undefined;
  if (s && s.kind === "editor_document" && typeof s.documentId === "string" && typeof s.version === "number") {
    return { kind: "editor_document", documentId: s.documentId, version: s.version };
  }
  return null;
}

function readRecord(id: string, data: Record<string, unknown>): EditorTemplateRecord {
  return {
    id,
    workspaceId: String(data.workspaceId),
    name: String(data.name ?? ""),
    description: String(data.description ?? ""),
    status: String(data.status) as EditorTemplateStatus,
    currentVersion: Number(data.currentVersion),
    publishedVersion: typeof data.publishedVersion === "number" ? data.publishedVersion : null,
    publishedName: typeof data.publishedName === "string" ? data.publishedName : null,
    source: readSource(data.source),
    contentHash: String(data.contentHash),
    contentSchemaVersion: Number(data.contentSchemaVersion),
    contentBytes: Number(data.contentBytes ?? 0),
    fieldKeys: Array.isArray(data.fieldKeys) ? (data.fieldKeys as string[]) : [],
    createdBy: String(data.createdBy),
    updatedBy: String(data.updatedBy),
  };
}

function ownedTemplate(snap: StoreSnap, workspaceId: string, id: string): Record<string, unknown> {
  const data = snap.exists ? snap.data() : undefined;
  // Modelo de outro workspace é indistinguível de inexistente.
  if (!data || data.workspaceId !== workspaceId) throw new EditorTemplateError("not_found", `Modelo ${id} não encontrado.`);
  return data;
}

function versionDoc(templateId: string, version: number, content: EditorContent, contentHash: string, actorId: string, clientRequestId: string, now: Date) {
  return {
    templateId,
    version,
    content,
    contentHash,
    contentSchemaVersion: EDITOR_CONTENT_SCHEMA_VERSION,
    fieldKeys: collectEditorFieldKeys(content),
    savedBy: actorId,
    clientRequestId,
    savedAt: now,
  };
}

/** Auditoria sem conteúdo: só ator, versão e hash (o texto livre pode conter dado pessoal). */
function auditDoc(event: EditorTemplateAuditEventType, version: number, contentHash: string, actorId: string, clientRequestId: string, now: Date, extra: Record<string, unknown> = {}) {
  return { type: `editor_template.${event}`, version, contentHash, actorId, clientRequestId, at: now, ...extra };
}

function hasMeaningfulContent(content: EditorContent): boolean {
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const item = node as { type?: unknown; text?: unknown; content?: unknown };
    if (item.type === "documentField") return true;
    if (item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0) return true;
    return Array.isArray(item.content) && item.content.some(walk);
  };
  return walk(content);
}

function createHashOf(name: string, description: string, source: unknown): string {
  return createHash("sha256").update(JSON.stringify([name, description, source])).digest("hex");
}

export type CreateEditorTemplateInput = {
  workspaceId: string;
  actorId: string;
  clientRequestId: string;
  name: string;
  description?: string;
  /** Conteúdo bruto (validado por parseEditorContent). Mutuamente exclusivo com `fromDocument`. */
  content?: unknown;
  /** Copia uma versão de documento do editor do mesmo workspace. */
  fromDocument?: { documentId: string; version: number };
};

export async function createEditorTemplate(input: CreateEditorTemplateInput, deps: EditorTemplateStoreDeps): Promise<EditorTemplateRecord> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const actorId = requireText(input.actorId, "actorId");
  const clientRequestId = requireText(input.clientRequestId, "clientRequestId");
  const name = requireText(input.name, "name", MAX_NAME);
  const description = optionalDescription(input.description);
  if (input.fromDocument !== undefined && input.content !== undefined) {
    throw new EditorTemplateError("invalid_input", "Informe content ou fromDocument, não ambos.");
  }
  let direct: ReturnType<typeof validateContent> | null = null;
  let from: { documentId: string; version: number } | null = null;
  if (input.fromDocument !== undefined) {
    from = { documentId: requireText(input.fromDocument.documentId, "fromDocument.documentId"), version: requireVersion(input.fromDocument.version, "fromDocument.version") };
  } else {
    direct = validateContent(input.content === undefined ? BLANK_CONTENT : input.content);
  }
  const requestHash = createHashOf(name, description, from ?? hashEditorContent(direct!.content));
  const id = editorTemplateId(workspaceId, actorId, clientRequestId);
  const now = (deps.now ?? (() => new Date()))();
  const ref = templateRef(deps, id);

  return deps.db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      // Replay idempotente: mesmo pedido, mesmo modelo; conteúdo divergente é reuso indevido da chave.
      const data = ownedTemplate(existing, workspaceId, id);
      if (data.createRequestHash !== requestHash) throw new EditorTemplateError("idempotency_mismatch", "clientRequestId já usado com outro conteúdo.");
      return readRecord(id, data);
    }
    let parsed = direct;
    if (from) {
      const docSnap = await tx.get(editorDocumentRef(deps, from.documentId));
      try {
        ownedEditorDocument(docSnap, workspaceId, from.documentId);
      } catch (error) {
        if (error instanceof EditorStoreError) throw new EditorTemplateError("not_found", "Documento de origem não encontrado.");
        throw error;
      }
      if (from.version > Number(docSnap.data()!.contentVersion)) throw new EditorTemplateError("not_found", "Versão de origem não encontrada.");
      const verSnap = await tx.get(editorContentVersionRef(deps, from.documentId, from.version));
      const verData = verSnap.exists ? verSnap.data() : undefined;
      if (!verData) throw new EditorTemplateError("not_found", "Versão de origem não encontrada.");
      parsed = validateContent(verData.content);
    }
    const content = parsed!.content;
    const contentHash = hashEditorContent(content);
    const data: Record<string, unknown> = {
      workspaceId,
      name,
      description,
      status: "draft",
      currentVersion: 1,
      publishedVersion: null,
      publishedName: null,
      source: from ? { kind: "editor_document", documentId: from.documentId, version: from.version } : null,
      contentHash,
      contentSchemaVersion: EDITOR_CONTENT_SCHEMA_VERSION,
      contentBytes: parsed!.stats.bytes,
      fieldKeys: collectEditorFieldKeys(content),
      createRequestHash: requestHash,
      lastClientRequestId: clientRequestId,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      publishedAt: null,
      publishedBy: null,
      archivedAt: null,
      archivedBy: null,
    };
    tx.create(ref, data);
    tx.create(versionRef(deps, id, 1), versionDoc(id, 1, content, contentHash, actorId, clientRequestId, now));
    tx.create(auditRef(deps, id, "created", 1), auditDoc("created", 1, contentHash, actorId, clientRequestId, now, from ? { sourceDocumentId: from.documentId, sourceVersion: from.version } : {}));
    return readRecord(id, data);
  });
}

export type SaveEditorTemplateContentInput = {
  templateId: string;
  workspaceId: string;
  actorId: string;
  clientRequestId: string;
  expectedVersion: number;
  content: unknown;
  name?: string;
};

export async function saveEditorTemplateContent(input: SaveEditorTemplateContentInput, deps: EditorTemplateStoreDeps): Promise<EditorTemplateRecord> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const templateId = requireTemplateId(input.templateId);
  const actorId = requireText(input.actorId, "actorId");
  const clientRequestId = requireText(input.clientRequestId, "clientRequestId");
  const expectedVersion = requireVersion(input.expectedVersion, "expectedVersion");
  const name = input.name === undefined ? undefined : requireText(input.name, "name", MAX_NAME);
  const parsed = validateContent(input.content);
  const contentHash = hashEditorContent(parsed.content);
  const now = (deps.now ?? (() => new Date()))();
  const ref = templateRef(deps, templateId);

  return deps.db.runTransaction(async (tx) => {
    const data = ownedTemplate(await tx.get(ref), workspaceId, templateId);
    const current = Number(data.currentVersion);
    if (data.status === "archived") throw new EditorTemplateError("template_archived", "Modelo arquivado não pode ser editado.");
    if (current !== expectedVersion) {
      // Retry do último salvamento já aplicado (a resposta se perdeu): devolve o resultado sem nova versão.
      if (data.lastClientRequestId === clientRequestId && current === expectedVersion + 1) {
        if (data.contentHash !== contentHash || (name !== undefined && data.name !== name)) throw new EditorTemplateError("idempotency_mismatch", "clientRequestId já usado com outro conteúdo.");
        return readRecord(templateId, data);
      }
      throw new EditorTemplateError("version_conflict", "O modelo foi alterado por outra sessão.", { currentVersion: current });
    }
    const next = current + 1;
    const update: Record<string, unknown> = {
      currentVersion: next,
      contentHash,
      contentSchemaVersion: EDITOR_CONTENT_SCHEMA_VERSION,
      contentBytes: parsed.stats.bytes,
      fieldKeys: collectEditorFieldKeys(parsed.content),
      lastClientRequestId: clientRequestId,
      updatedAt: now,
      updatedBy: actorId,
      ...(name === undefined ? {} : { name }),
    };
    tx.create(versionRef(deps, templateId, next), versionDoc(templateId, next, parsed.content, contentHash, actorId, clientRequestId, now));
    tx.update(ref, update);
    tx.create(auditRef(deps, templateId, "saved", next), auditDoc("saved", next, contentHash, actorId, clientRequestId, now));
    return readRecord(templateId, { ...data, ...update });
  });
}

export type PublishEditorTemplateInput = {
  templateId: string;
  workspaceId: string;
  actorId: string;
  clientRequestId: string;
  expectedVersion: number;
};

/** Só move `publishedVersion` para a versão corrente (conteúdo revalidado; modelo vazio não publica). */
export async function publishEditorTemplate(input: PublishEditorTemplateInput, deps: EditorTemplateStoreDeps): Promise<EditorTemplateRecord> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const templateId = requireTemplateId(input.templateId);
  const actorId = requireText(input.actorId, "actorId");
  const clientRequestId = requireText(input.clientRequestId, "clientRequestId");
  const expectedVersion = requireVersion(input.expectedVersion, "expectedVersion");
  const now = (deps.now ?? (() => new Date()))();
  const ref = templateRef(deps, templateId);

  return deps.db.runTransaction(async (tx) => {
    const data = ownedTemplate(await tx.get(ref), workspaceId, templateId);
    if (data.status === "archived") throw new EditorTemplateError("template_archived", "Modelo arquivado não pode ser publicado.");
    const current = Number(data.currentVersion);
    if (current !== expectedVersion) throw new EditorTemplateError("version_conflict", "O modelo foi alterado por outra sessão.", { currentVersion: current });
    // Já publicada esta versão: idempotente, sem nova escrita.
    if (data.status === "published" && data.publishedVersion === current) return readRecord(templateId, data);
    const verSnap = await tx.get(versionRef(deps, templateId, current));
    const verData = verSnap.exists ? verSnap.data() : undefined;
    if (!verData) throw new EditorTemplateError("not_found", "Versão do modelo não encontrada.");
    const parsed = validateContent(verData.content);
    const contentHash = hashEditorContent(parsed.content);
    if (contentHash !== data.contentHash || contentHash !== verData.contentHash) throw new EditorTemplateError("invalid_content", "Conteúdo salvo inconsistente.");
    if (!hasMeaningfulContent(parsed.content)) throw new EditorTemplateError("invalid_content", "Modelo vazio não pode ser publicado.");
    const update: Record<string, unknown> = {
      status: "published",
      publishedVersion: current,
      publishedName: String(data.name),
      publishedAt: now,
      publishedBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    };
    tx.update(ref, update);
    tx.create(auditRef(deps, templateId, "published", current), auditDoc("published", current, contentHash, actorId, clientRequestId, now));
    return readRecord(templateId, { ...data, ...update });
  });
}

export type ArchiveEditorTemplateInput = PublishEditorTemplateInput;

/** Arquiva (rascunho ou publicado). Mantém modelo, versões e auditoria; nada é apagado. */
export async function archiveEditorTemplate(input: ArchiveEditorTemplateInput, deps: EditorTemplateStoreDeps): Promise<EditorTemplateRecord> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const templateId = requireTemplateId(input.templateId);
  const actorId = requireText(input.actorId, "actorId");
  const clientRequestId = requireText(input.clientRequestId, "clientRequestId");
  const expectedVersion = requireVersion(input.expectedVersion, "expectedVersion");
  const now = (deps.now ?? (() => new Date()))();
  const ref = templateRef(deps, templateId);

  return deps.db.runTransaction(async (tx) => {
    const data = ownedTemplate(await tx.get(ref), workspaceId, templateId);
    if (data.status === "archived") return readRecord(templateId, data); // idempotente
    const current = Number(data.currentVersion);
    if (current !== expectedVersion) throw new EditorTemplateError("version_conflict", "O modelo foi alterado por outra sessão.", { currentVersion: current });
    const update: Record<string, unknown> = { status: "archived", archivedAt: now, archivedBy: actorId, updatedAt: now, updatedBy: actorId };
    tx.update(ref, update);
    tx.create(auditRef(deps, templateId, "archived", current), auditDoc("archived", current, String(data.contentHash), actorId, clientRequestId, now));
    return readRecord(templateId, { ...data, ...update });
  });
}

/** 1 leitura. Modelo de outro workspace é tratado como inexistente. */
export async function getEditorTemplate(templateId: string, workspaceId: string, deps: EditorTemplateStoreDeps): Promise<EditorTemplateRecord> {
  const id = requireTemplateId(templateId);
  const snap = await templateRef(deps, id).get();
  return readRecord(id, ownedTemplate(snap, requireText(workspaceId, "workspaceId"), id));
}

/** 2 leituras. `version` omitido = versão corrente; o chamador pode passar `publishedVersion`. */
export async function getEditorTemplateVersion(
  templateId: string,
  workspaceId: string,
  deps: EditorTemplateStoreDeps,
  version?: number,
): Promise<EditorTemplateVersionRecord> {
  const record = await getEditorTemplate(templateId, workspaceId, deps);
  const wanted = version ?? record.currentVersion;
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > record.currentVersion) throw new EditorTemplateError("not_found", "Versão não encontrada.");
  const snap = await versionRef(deps, record.id, wanted).get();
  const data = snap.exists ? snap.data() : undefined;
  if (!data) throw new EditorTemplateError("not_found", "Versão não encontrada.");
  const parsed = parseEditorContent(data.content); // revalida na leitura
  if (!parsed.ok) throw new EditorTemplateError("invalid_content", "Conteúdo salvo inválido.");
  return {
    templateId: record.id,
    version: wanted,
    content: parsed.content,
    contentHash: String(data.contentHash),
    contentSchemaVersion: Number(data.contentSchemaVersion),
    fieldKeys: Array.isArray(data.fieldKeys) ? (data.fieldKeys as string[]) : [],
    savedBy: String(data.savedBy),
    clientRequestId: String(data.clientRequestId),
  };
}

export type ListEditorTemplatesInput = {
  workspaceId: string;
  status?: EditorTemplateStatus;
  /** 1..25 (acima de 25 é reduzido a 25). Padrão 25. */
  limit?: number;
  cursor?: string;
};

function encodeCursor(ms: number, id: string): string {
  return Buffer.from(JSON.stringify([ms, id]), "utf8").toString("base64url");
}
function decodeCursor(cursor: string): { ms: number; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(parsed) && parsed.length === 2 && Number.isInteger(parsed[0]) && Math.abs(parsed[0] as number) <= 8.64e15 && typeof parsed[1] === "string" && EDITOR_TEMPLATE_RECORD_ID_PATTERN.test(parsed[1])) {
      return { ms: parsed[0] as number, id: parsed[1] };
    }
  } catch {
    // cai no erro fixo abaixo
  }
  throw new EditorTemplateError("invalid_input", "Cursor inválido.");
}
function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") return (value as { toMillis(): number }).toMillis();
  throw new EditorTemplateError("invalid_content", "Modelo com data inválida.");
}

/**
 * Lista por workspace (e status opcional), mais recentes primeiro, com cursor. No máximo limit+1 (<= 26)
 * leituras por chamada, via índice (workspaceId[, status], updatedAt desc). Nunca varre a coleção.
 */
export async function listEditorTemplates(input: ListEditorTemplatesInput, deps: EditorTemplateStoreDeps): Promise<EditorTemplateListPage> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  if (input.status !== undefined && !(EDITOR_TEMPLATE_STATUSES as readonly string[]).includes(input.status)) {
    throw new EditorTemplateError("invalid_input", "Campo inválido: status.");
  }
  const requested = input.limit === undefined ? EDITOR_TEMPLATE_LIST_MAX : input.limit;
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested < 1) throw new EditorTemplateError("invalid_input", "Campo inválido: limit.");
  const limit = Math.min(requested, EDITOR_TEMPLATE_LIST_MAX);
  let query: StoreQuery = deps.db.collection("editorTemplates").where("workspaceId", "==", workspaceId);
  if (input.status !== undefined) query = query.where("status", "==", input.status);
  query = query.orderBy("updatedAt", "desc").orderBy("__name__", "desc");
  if (input.cursor !== undefined) {
    const c = decodeCursor(input.cursor);
    query = query.startAfter(new Date(c.ms), c.id);
  }
  const snap = await query.limit(limit + 1).get();
  const page = snap.docs.slice(0, limit);
  const items = page.map((doc) => readRecord(doc.id, doc.data()));
  const last = page[page.length - 1];
  const nextCursor = snap.docs.length > limit && last ? encodeCursor(toMillis(last.data().updatedAt), last.id) : null;
  return { items, nextCursor };
}

export type UseEditorTemplateInput = {
  workspaceId: string;
  actorId: string;
  templateId: string;
  clientRequestId: string;
  /** Versão publicada que o usuário viu; divergência = conflito. */
  expectedPublishedVersion?: number;
};

/**
 * Cria, em UMA transação, um rascunho do editor (sem titular) a partir da versão publicada do modelo e
 * grava a auditoria `used` no modelo. Não cria modelo implícito. Replay (mesmo clientRequestId) devolve
 * o documento já criado, mesmo se o modelo foi arquivado depois.
 */
export async function useEditorTemplate(input: UseEditorTemplateInput, deps: EditorTemplateStoreDeps): Promise<EditorDocumentRecord> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const actorId = requireText(input.actorId, "actorId");
  const templateId = requireTemplateId(input.templateId);
  const clientRequestId = requireText(input.clientRequestId, "clientRequestId");
  const expectedPublished = input.expectedPublishedVersion === undefined ? undefined : requireVersion(input.expectedPublishedVersion, "expectedPublishedVersion");
  const now = (deps.now ?? (() => new Date()))();
  const tplRef = templateRef(deps, templateId);
  const documentId = editorDocumentId(workspaceId, actorId, clientRequestId);

  return deps.db.runTransaction(async (tx) => {
    // Todas as leituras antes de qualquer escrita.
    const data = ownedTemplate(await tx.get(tplRef), workspaceId, templateId);
    const docSnap = await tx.get(editorDocumentRef(deps, documentId));
    if (docSnap.exists) {
      const existing = ownedEditorDocument(docSnap, workspaceId, documentId);
      const origin = parseEditorOrigin(existing.origin);
      if (origin?.kind !== "editor_template" || origin.templateId !== templateId) {
        throw new EditorTemplateError("idempotency_mismatch", "clientRequestId já usado com outro conteúdo.");
      }
      return editorDocumentRecordFromSnap(docSnap, workspaceId, documentId);
    }
    if (data.status === "archived") throw new EditorTemplateError("template_archived", "Modelo arquivado não pode ser usado.");
    const published = typeof data.publishedVersion === "number" ? data.publishedVersion : null;
    if (data.status !== "published" || published === null) throw new EditorTemplateError("template_not_published", "Modelo não publicado.", { publishedVersion: published });
    if (expectedPublished !== undefined && expectedPublished !== published) {
      throw new EditorTemplateError("published_version_mismatch", "A versão publicada do modelo mudou.", { publishedVersion: published });
    }
    const verSnap = await tx.get(versionRef(deps, templateId, published));
    const verData = verSnap.exists ? verSnap.data() : undefined;
    if (!verData) throw new EditorTemplateError("not_found", "Versão publicada não encontrada.");
    const parsed = validateContent(verData.content);
    const templateContentHash = hashEditorContent(parsed.content);
    if (templateContentHash !== verData.contentHash) throw new EditorTemplateError("invalid_content", "Conteúdo salvo inconsistente.");

    let prepared;
    try {
      prepared = prepareEditorDraft({
        workspaceId,
        actorId,
        clientRequestId,
        title: typeof data.publishedName === "string" && data.publishedName.trim() ? data.publishedName : String(data.name),
        content: parsed.content,
        subject: null,
        origin: { kind: "editor_template", templateId, templateVersion: published, templateContentHash },
      });
    } catch (error) {
      if (error instanceof EditorStoreError) throw new EditorTemplateError(error.code === "invalid_content" ? "invalid_content" : "invalid_input", "Modelo não pode gerar documento.");
      throw error;
    }
    const record = await createEditorDraftInTransaction(tx, prepared, deps, docSnap);
    tx.create(
      auditRef(deps, templateId, "used", published, `-${documentId}`),
      auditDoc("used", published, templateContentHash, actorId, clientRequestId, now, { documentId }),
    );
    return record;
  });
}
