import { createHash, randomUUID } from "node:crypto";

import { SYSTEM_DOCUMENT_TEMPLATES } from "@/features/hr/documents/system-template-catalog";
import { retentionFields } from "@/features/hr/documents/document-retention";

import {
  EDITOR_CONTENT_SCHEMA_VERSION,
  hashEditorContent,
  parseEditorContent,
  type EditorContent,
} from "./content-schema";
import {
  EDITOR_CONTENT_FORMAT,
  EDITOR_LETTERHEAD_PROFILE_ID,
  EDITOR_PIPELINE_VERSION,
  EDITOR_SUBJECT_NAMESPACES,
  EDITOR_TEMPLATE_ID,
  EditorStoreError,
  type CreateEditorDraftInput,
  type EditorAuditEventType,
  type EditorContentVersionRecord,
  type EditorDocumentRecord,
  type EditorDocumentListPage,
  type EditorDocumentListStatus,
  type EditorDocumentListStoreDeps,
  EDITOR_DOCUMENT_LIST_STATUSES,
  EDITOR_DOCUMENT_RECORD_ID_PATTERN,
  type StoreQuery,
  parseEditorOrigin,
  type EditorDocumentOrigin,
  type EditorStoreDeps,
  type FinalizeEditorInput,
  type EditorFinalPdfRef,
  type RecordPdfDownloadedInput,
  type RecordPreviewResolvedInput,
  type SaveEditorContentInput,
  type StoreSnap,
  type StoreTx,
} from "./document-store.types";

export * from "./document-store.types";

const MAX_TITLE = 200;
const BLANK_CONTENT: EditorContent = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * Persistência do documento do editor (sem rotas/UI). Custo: salvar = 1 leitura + 3 escritas
 * (versão imutável, ponteiro no principal, evento de auditoria; todos na mesma transação);
 * abrir = 2 leituras. Sem listener, sem polling, sem consulta de listagem.
 * Autorização por papel pertence à rota; aqui só se isola por `workspaceId` e se grava o ator.
 */
export async function defaultEditorStoreDeps(): Promise<EditorStoreDeps> {
  const { dbAdmin } = await import("@/lib/firebase-admin");
  return { db: dbAdmin as unknown as EditorStoreDeps["db"] };
}

function requireText(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new EditorStoreError("invalid_input", `Campo inválido: ${field}.`);
  }
  return value.trim();
}

function validateContent(raw: unknown) {
  const parsed = parseEditorContent(raw);
  if (!parsed.ok) throw new EditorStoreError("invalid_content", "Conteúdo do documento inválido.");
  return parsed;
}

function documentRef(deps: EditorStoreDeps, documentId: string) {
  // Literal exigido por scripts/check-person-source-registration.mjs (não aceita constante); o teste do
  // store garante que é igual a EDITOR_DOCUMENTS_COLLECTION.
  return deps.db.collection("editorDocuments").doc(documentId);
}
function contentVersionRef(deps: EditorStoreDeps, documentId: string, version: number) {
  return documentRef(deps, documentId).collection("contentVersions").doc(String(version));
}
function auditRef(deps: EditorStoreDeps, documentId: string, event: EditorAuditEventType, version: number, suffix = "") {
  return documentRef(deps, documentId).collection("audit").doc(`editor-${event}-v${version}${suffix}`);
}

function retentionPolicyId(): string {
  const template = SYSTEM_DOCUMENT_TEMPLATES.find((item) => item.id === EDITOR_TEMPLATE_ID);
  if (!template) throw new EditorStoreError("invalid_input", "Modelo do editor ausente do catálogo.");
  return template.retentionPolicyId;
}

/** ID determinístico: o mesmo (workspace, ator, clientRequestId) sempre resolve ao mesmo documento. */
export function editorDocumentId(workspaceId: string, actorId: string, clientRequestId: string): string {
  return `ed_${createHash("sha256").update(JSON.stringify([workspaceId, actorId, clientRequestId])).digest("hex").slice(0, 32)}`;
}

function readRecord(id: string, data: Record<string, unknown>): EditorDocumentRecord {
  return {
    id,
    workspaceId: String(data.workspaceId),
    title: String(data.title ?? ""),
    status: String(data.status),
    contentVersion: Number(data.contentVersion),
    contentHash: String(data.contentHash),
    contentSchemaVersion: Number(data.contentSchemaVersion),
    contentBytes: Number(data.contentBytes ?? 0),
    subject: (data.subject as EditorDocumentRecord["subject"]) ?? null,
    subjectKeys: Array.isArray(data.subjectKeys) ? (data.subjectKeys as string[]) : [],
    generatedBy: String(data.generatedBy),
    createdBy: String(data.createdBy),
    updatedBy: String(data.updatedBy),
    hasStoragePath: false,
    pdfAvailable: typeof data.pdfStoragePath === "string" && data.pdfStoragePath.length > 0,
    finalizeRequestId: typeof data.finalizeRequestId === "string" ? data.finalizeRequestId : null,
  };
}

function ownedEditorDoc(snap: StoreSnap, workspaceId: string, id: string): Record<string, unknown> {
  const data = snap.exists ? snap.data() : undefined;
  // Documento de outro workspace ou que não é do editor é indistinguível de inexistente.
  if (!data || data.workspaceId !== workspaceId || data.contentFormat !== EDITOR_CONTENT_FORMAT) {
    throw new EditorStoreError("not_found", `Documento ${id} não encontrado.`);
  }
  return data;
}

/** Entrada já validada de um rascunho; produzida de forma síncrona e consumida dentro de uma transação. */
export type PreparedEditorDraft = {
  workspaceId: string;
  actorId: string;
  clientRequestId: string;
  title: string;
  subject: EditorDocumentRecord["subject"];
  origin: EditorDocumentOrigin;
  content: EditorContent;
  contentBytes: number;
  contentHash: string;
  id: string;
};

export function prepareEditorDraft(input: CreateEditorDraftInput): PreparedEditorDraft {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const actorId = requireText(input.actorId, "actorId");
  const clientRequestId = requireText(input.clientRequestId, "clientRequestId");
  const title = requireText(input.title, "title", MAX_TITLE);
  let subject: EditorDocumentRecord["subject"] = null;
  if (input.subject) {
    if (!(EDITOR_SUBJECT_NAMESPACES as readonly string[]).includes(input.subject.namespace)) {
      throw new EditorStoreError("invalid_input", "Namespace de titular inválido.");
    }
    subject = { namespace: input.subject.namespace, id: requireText(input.subject.id, "subject.id") };
  }
  const origin: EditorDocumentOrigin = input.origin === undefined ? { kind: "editor", from: "blank" } : (parseEditorOrigin(input.origin) ?? invalidOrigin());
  const parsed = validateContent(input.content === undefined ? BLANK_CONTENT : input.content);
  const contentHash = hashEditorContent(parsed.content);
  const id = editorDocumentId(workspaceId, actorId, clientRequestId);
  return { workspaceId, actorId, clientRequestId, title, subject, origin, content: parsed.content, contentBytes: parsed.stats.bytes, contentHash, id };
}

/**
 * Corpo transacional de `createEditorDraft`, reutilizável dentro de uma transação externa (ex.: usar
 * modelo). Faz 1 leitura (omitida se `existing` já foi lida na mesma transação) e 3 escritas.
 * As leituras da transação externa devem preceder qualquer escrita.
 */
export async function createEditorDraftInTransaction(
  tx: StoreTx,
  prepared: PreparedEditorDraft,
  deps: EditorStoreDeps,
  existing?: StoreSnap,
): Promise<EditorDocumentRecord> {
  const { workspaceId, actorId, clientRequestId, title, subject, origin, contentHash, id } = prepared;
  const now = (deps.now ?? (() => new Date()))();
  const ref = documentRef(deps, id);
  const snap = existing ?? (await tx.get(ref));
  if (snap.exists) {
    // Replay idempotente: mesmo pedido, mesmo documento; conteúdo divergente é reuso indevido da chave.
    const data = ownedEditorDoc(snap, workspaceId, id);
    if (data.createRequestHash !== requestHash(title, contentHash, subject, origin)) {
      throw new EditorStoreError("idempotency_mismatch", "clientRequestId já usado com outro conteúdo.");
    }
    return readRecord(id, data);
  }
  const data: Record<string, unknown> = {
    templateId: EDITOR_TEMPLATE_ID,
    templateVersion: 1,
    title,
    workspaceId,
    origin,
    status: "draft",
    contentFormat: EDITOR_CONTENT_FORMAT,
    contentSchemaVersion: EDITOR_CONTENT_SCHEMA_VERSION,
    contentVersion: 1,
    contentHash,
    contentBytes: prepared.contentBytes,
    subject,
    subjectKeys: subject ? [`${subject.namespace}:${subject.id}`] : [],
    pipelineVersion: EDITOR_PIPELINE_VERSION,
    letterheadProfileId: EDITOR_LETTERHEAD_PROFILE_ID,
    ...retentionFields({ policyId: retentionPolicyId(), generatedAt: now.toISOString() }),
    legalHold: false,
    pdfGenerationStatus: "unavailable",
    createRequestHash: requestHash(title, contentHash, subject, origin),
    lastClientRequestId: clientRequestId,
    generatedAt: now,
    generatedBy: actorId,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
    finalizedAt: null,
    finalizedBy: null,
  };
  tx.create(ref, data);
  tx.create(contentVersionRef(deps, id, 1), versionDoc(id, 1, prepared.content, contentHash, actorId, clientRequestId, now));
  tx.create(auditRef(deps, id, "created", 1), auditDoc("created", 1, contentHash, actorId, clientRequestId, now));
  return readRecord(id, data);
}

export async function createEditorDraft(input: CreateEditorDraftInput, deps: EditorStoreDeps): Promise<EditorDocumentRecord> {
  const prepared = prepareEditorDraft(input);
  return deps.db.runTransaction((tx) => createEditorDraftInTransaction(tx, prepared, deps));
}

/** Referência do documento (exportada para o store de modelos; literal exigido pelo check de fonte pessoal). */
export function editorDocumentRef(deps: EditorStoreDeps, documentId: string) {
  return documentRef(deps, documentId);
}
export function editorContentVersionRef(deps: EditorStoreDeps, documentId: string, version: number) {
  return contentVersionRef(deps, documentId, version);
}
/** Registro público do documento a partir de um snapshot já lido (ownership do workspace validado). */
export function editorDocumentRecordFromSnap(snap: StoreSnap, workspaceId: string, id: string): EditorDocumentRecord {
  return readRecord(id, ownedEditorDoc(snap, workspaceId, id));
}
/** Documento do editor do workspace, ou `not_found` (outro workspace é indistinguível de inexistente). */
export function ownedEditorDocument(snap: StoreSnap, workspaceId: string, id: string): Record<string, unknown> {
  return ownedEditorDoc(snap, workspaceId, id);
}

function invalidOrigin(): never {
  throw new EditorStoreError("invalid_input", "Campo inválido: origin.");
}

/** Documento em branco mantém o hash legado (3 campos); com modelo, inclui templateId/versão/hash. */
function requestHash(title: string, contentHash: string, subject: unknown, origin?: EditorDocumentOrigin): string {
  const parts: unknown[] = [title, contentHash, subject];
  if (origin?.kind === "editor_template") parts.push(origin.templateId, origin.templateVersion, origin.templateContentHash);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function versionDoc(documentId: string, version: number, content: EditorContent, contentHash: string, actorId: string, clientRequestId: string, now: Date) {
  return {
    documentId,
    version,
    content,
    contentHash,
    contentSchemaVersion: EDITOR_CONTENT_SCHEMA_VERSION,
    savedBy: actorId,
    clientRequestId,
    savedAt: now,
  };
}

/** Auditoria sem conteúdo: só ator, versão e hash (o texto livre pode conter dado pessoal). */
function auditDoc(
  event: EditorAuditEventType,
  version: number,
  contentHash: string,
  actorId: string,
  clientRequestId: string | null,
  now: Date,
  extra: Record<string, unknown> = {},
) {
  return { type: `editor.${event}`, version, contentHash, actorId, clientRequestId, at: now, ...extra };
}

export async function saveEditorContent(input: SaveEditorContentInput, deps: EditorStoreDeps): Promise<EditorDocumentRecord> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const documentId = requireText(input.documentId, "documentId");
  const actorId = requireText(input.actorId, "actorId");
  const clientRequestId = requireText(input.clientRequestId, "clientRequestId");
  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 1) {
    throw new EditorStoreError("invalid_input", "expectedContentVersion inválido.");
  }
  const title = input.title === undefined ? undefined : requireText(input.title, "title", MAX_TITLE);
  const parsed = validateContent(input.content);
  const contentHash = hashEditorContent(parsed.content);
  const now = (deps.now ?? (() => new Date()))();
  const ref = documentRef(deps, documentId);

  return deps.db.runTransaction(async (tx) => {
    const data = ownedEditorDoc(await tx.get(ref), workspaceId, documentId);
    const current = Number(data.contentVersion);
    if (data.status !== "draft") throw new EditorStoreError("not_draft", "Somente rascunho pode ser editado.");
    if (current !== input.expectedContentVersion) {
      // Retry do último salvamento já aplicado (a resposta se perdeu): devolve o resultado sem nova versão.
      if (data.lastClientRequestId === clientRequestId && current === input.expectedContentVersion + 1) {
        if (data.contentHash !== contentHash) {
          throw new EditorStoreError("idempotency_mismatch", "clientRequestId já usado com outro conteúdo.");
        }
        return readRecord(documentId, data);
      }
      throw new EditorStoreError("version_conflict", "O documento foi alterado por outra sessão.", { currentVersion: current });
    }
    const next = current + 1;
    const update: Record<string, unknown> = {
      contentVersion: next,
      contentHash,
      contentSchemaVersion: EDITOR_CONTENT_SCHEMA_VERSION,
      contentBytes: parsed.stats.bytes,
      lastClientRequestId: clientRequestId,
      updatedAt: now,
      updatedBy: actorId,
      ...(title === undefined ? {} : { title }),
    };
    tx.create(contentVersionRef(deps, documentId, next), versionDoc(documentId, next, parsed.content, contentHash, actorId, clientRequestId, now));
    tx.update(ref, update);
    tx.create(auditRef(deps, documentId, "saved", next), auditDoc("saved", next, contentHash, actorId, clientRequestId, now));
    return readRecord(documentId, { ...data, ...update });
  });
}

/** 1 leitura. Documento de outro workspace é tratado como inexistente. */
export async function getEditorDocument(documentId: string, workspaceId: string, deps: EditorStoreDeps): Promise<EditorDocumentRecord> {
  const snap = await documentRef(deps, requireText(documentId, "documentId")).get();
  return readRecord(documentId, ownedEditorDoc(snap, requireText(workspaceId, "workspaceId"), documentId));
}

/** 2 leituras (principal para validar workspace + versão). `version` omitido = versão corrente do ponteiro. */
export async function getEditorContentVersion(
  documentId: string,
  workspaceId: string,
  deps: EditorStoreDeps,
  version?: number,
): Promise<EditorContentVersionRecord> {
  const doc = await getEditorDocument(documentId, workspaceId, deps);
  const wanted = version ?? doc.contentVersion;
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > doc.contentVersion) {
    throw new EditorStoreError("not_found", "Versão não encontrada.");
  }
  const snap = await contentVersionRef(deps, documentId, wanted).get();
  const data = snap.exists ? snap.data() : undefined;
  if (!data) throw new EditorStoreError("not_found", "Versão não encontrada.");
  // Revalida na leitura: não confia no que está gravado.
  const parsed = parseEditorContent(data.content);
  if (!parsed.ok) throw new EditorStoreError("invalid_content", "Conteúdo salvo inválido.");
  return {
    documentId,
    version: wanted,
    content: parsed.content,
    contentHash: String(data.contentHash),
    contentSchemaVersion: Number(data.contentSchemaVersion),
    savedBy: String(data.savedBy),
    clientRequestId: String(data.clientRequestId),
  };
}

/**
 * Marca o rascunho como final depois que o PDF já está no Storage (efeito externo antes do commit).
 * 1 leitura + 2 escritas na mesma transação (principal e auditoria; sem nova versão de conteúdo).
 * Repetição com o mesmo `clientRequestId` devolve o resultado já gravado (`replayed`), sem nova escrita.
 */
export async function finalizeEditorDocument(
  input: FinalizeEditorInput,
  deps: EditorStoreDeps,
): Promise<{ record: EditorDocumentRecord; replayed: boolean }> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const documentId = requireText(input.documentId, "documentId");
  const actorId = requireText(input.actorId, "actorId");
  const clientRequestId = requireText(input.clientRequestId, "clientRequestId");
  const pdfStoragePath = requireText(input.pdfStoragePath, "pdfStoragePath", 600);
  const pdfContentHash = requireText(input.pdfContentHash, "pdfContentHash", 128);
  const originalName = requireText(input.originalName, "originalName");
  if (!Number.isInteger(input.expectedContentVersion) || input.expectedContentVersion < 1) {
    throw new EditorStoreError("invalid_input", "expectedContentVersion inválido.");
  }
  const now = (deps.now ?? (() => new Date()))();
  const ref = documentRef(deps, documentId);

  return deps.db.runTransaction(async (tx) => {
    const data = ownedEditorDoc(await tx.get(ref), workspaceId, documentId);
    if (data.status === "final" && data.finalizeRequestId === clientRequestId) {
      return { record: readRecord(documentId, data), replayed: true };
    }
    if (data.status !== "draft") throw new EditorStoreError("not_draft", "Somente rascunho pode ser finalizado.");
    const current = Number(data.contentVersion);
    if (current !== input.expectedContentVersion) {
      throw new EditorStoreError("version_conflict", "O documento foi alterado por outra sessão.", { currentVersion: current });
    }
    const update: Record<string, unknown> = {
      status: "final",
      pdfStoragePath,
      pdfContentHash,
      pdfGenerationStatus: "ready",
      pdfGeneratedAt: now,
      originalName,
      employeeId: input.employeeId,
      subject: input.subject,
      subjectKeys: input.subjectKeys,
      protocol: null,
      finalizeRequestId: clientRequestId,
      // A retenção ancora na data de geração oficial (finalização), não na criação do rascunho.
      ...retentionFields({ policyId: retentionPolicyId(), generatedAt: now.toISOString() }),
      finalizedAt: now,
      finalizedBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    };
    tx.update(ref, update);
    tx.create(auditRef(deps, documentId, "finalized", current), auditDoc("finalized", current, String(data.contentHash), actorId, clientRequestId, now, {
        subjectKeys: input.subjectKeys,
        pdfContentHash,
      }));
    return { record: readRecord(documentId, { ...data, ...update }), replayed: false };
  });
}

/**
 * Auditoria da prévia `resolved` (leu dados pessoais do titular): ator, versão, hash e subjectKeys,
 * SEM conteúdo nem valores. 1 leitura + 1 escrita (id único por evento: cada prévia é um acesso).
 */
export async function recordEditorPreviewResolved(input: RecordPreviewResolvedInput, deps: EditorStoreDeps): Promise<void> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const documentId = requireText(input.documentId, "documentId");
  const actorId = requireText(input.actorId, "actorId");
  const contentHash = requireText(input.contentHash, "contentHash", 128);
  if (!Number.isInteger(input.version) || input.version < 1) throw new EditorStoreError("invalid_input", "version inválida.");
  if (!Array.isArray(input.subjectKeys) || input.subjectKeys.length === 0) {
    throw new EditorStoreError("invalid_input", "subjectKeys obrigatório para auditar a prévia.");
  }
  const now = (deps.now ?? (() => new Date()))();
  const ref = documentRef(deps, documentId);
  await deps.db.runTransaction(async (tx) => {
    ownedEditorDoc(await tx.get(ref), workspaceId, documentId);
    tx.create(
      auditRef(deps, documentId, "preview_resolved", input.version, `-${randomUUID()}`),
      auditDoc("preview_resolved", input.version, contentHash, actorId, null, now, { subjectKeys: input.subjectKeys }),
    );
  });
}

/**
 * 1 leitura. Confere se o documento (do workspace) já referencia este objeto de PDF; usado antes de
 * apagar um objeto órfão para nunca remover o PDF que uma finalização concorrente efetivou.
 */
export async function editorDocumentReferencesPdf(
  documentId: string,
  workspaceId: string,
  pdfStoragePath: string,
  deps: EditorStoreDeps,
): Promise<boolean> {
  const snap = await documentRef(deps, requireText(documentId, "documentId")).get();
  const data = ownedEditorDoc(snap, requireText(workspaceId, "workspaceId"), documentId);
  return data.pdfStoragePath === pdfStoragePath;
}

/** 1 leitura. Ponteiro do PDF final para o download; documento de outro workspace é inexistente. */
export async function getEditorFinalPdfRef(documentId: string, workspaceId: string, deps: EditorStoreDeps): Promise<EditorFinalPdfRef> {
  const snap = await documentRef(deps, requireText(documentId, "documentId")).get();
  const data = ownedEditorDoc(snap, requireText(workspaceId, "workspaceId"), documentId);
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);
  return {
    status: String(data.status),
    pdfGenerationStatus: text(data.pdfGenerationStatus),
    pdfStoragePath: text(data.pdfStoragePath),
    pdfContentHash: text(data.pdfContentHash),
    contentVersion: Number(data.contentVersion),
    contentHash: String(data.contentHash),
    title: String(data.title ?? ""),
  };
}

/**
 * Auditoria do download do PDF final (ator, versão, hash; sem conteúdo nem caminho). 1 leitura + 1
 * escrita; id único por evento (cada download é um acesso ao documento pessoal).
 */
export async function recordEditorPdfDownloaded(input: RecordPdfDownloadedInput, deps: EditorStoreDeps): Promise<void> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const documentId = requireText(input.documentId, "documentId");
  const actorId = requireText(input.actorId, "actorId");
  const contentHash = requireText(input.contentHash, "contentHash", 128);
  const pdfContentHash = requireText(input.pdfContentHash, "pdfContentHash", 128);
  if (!Number.isInteger(input.version) || input.version < 1) throw new EditorStoreError("invalid_input", "version inválida.");
  const now = (deps.now ?? (() => new Date()))();
  const ref = documentRef(deps, documentId);
  await deps.db.runTransaction(async (tx) => {
    ownedEditorDoc(await tx.get(ref), workspaceId, documentId);
    tx.create(
      auditRef(deps, documentId, "pdf_downloaded", input.version, `-${randomUUID()}`),
      auditDoc("pdf_downloaded", input.version, contentHash, actorId, null, now, { pdfContentHash }),
    );
  });
}

// ---------------------------------------------------------------- listagem (somente leitura)

export const EDITOR_DOCUMENT_LIST_MAX = 25;

export async function defaultEditorDocumentListDeps(): Promise<EditorDocumentListStoreDeps> {
  const { dbAdmin } = await import("@/lib/firebase-admin");
  return { db: dbAdmin as unknown as EditorDocumentListStoreDeps["db"] };
}

export type ListEditorDocumentsInput = {
  workspaceId: string;
  /** Quando informado, restringe a documentos cujo autor (`generatedBy`, ATOR) é este uid. */
  authorId?: string;
  status?: EditorDocumentListStatus;
  /** 1..25 (acima de 25 é reduzido a 25). Padrão 25. */
  limit?: number;
  cursor?: string;
};

function encodeListCursor(ms: number, id: string): string {
  return Buffer.from(JSON.stringify([ms, id]), "utf8").toString("base64url");
}
function decodeListCursor(cursor: string): { ms: number; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(parsed) && parsed.length === 2 && Number.isInteger(parsed[0]) && Math.abs(parsed[0] as number) <= 8.64e15 &&
      typeof parsed[1] === "string" && EDITOR_DOCUMENT_RECORD_ID_PATTERN.test(parsed[1])
    ) {
      return { ms: parsed[0] as number, id: parsed[1] };
    }
  } catch {
    // cai no erro fixo abaixo
  }
  throw new EditorStoreError("invalid_input", "Cursor inválido.");
}
function millisOrNull(value: unknown): number | null {
  try {
    const ms = value instanceof Date ? value.getTime() : value && typeof (value as { toMillis?: unknown }).toMillis === "function" ? (value as { toMillis(): number }).toMillis() : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}
function isoOrNull(value: unknown): string | null {
  const ms = millisOrNull(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * Lista documentos do editor do workspace (opcionalmente só de um autor e/ou status), mais recentes
 * primeiro, com cursor. Somente leitura: no máximo limit+1 (<= 26) leituras por chamada, sempre por
 * índice (workspaceId[, generatedBy][, status], updatedAt desc); nunca varre a coleção. Não devolve
 * titular, chaves de titular nem caminhos de Storage (o item só carrega o necessário à visão pública).
 */
export async function listEditorDocuments(input: ListEditorDocumentsInput, deps: EditorDocumentListStoreDeps): Promise<EditorDocumentListPage> {
  const workspaceId = requireText(input.workspaceId, "workspaceId");
  const authorId = input.authorId === undefined ? undefined : requireText(input.authorId, "authorId");
  if (input.status !== undefined && !(EDITOR_DOCUMENT_LIST_STATUSES as readonly string[]).includes(input.status)) {
    throw new EditorStoreError("invalid_input", "Campo inválido: status.");
  }
  const requested = input.limit === undefined ? EDITOR_DOCUMENT_LIST_MAX : input.limit;
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested < 1) throw new EditorStoreError("invalid_input", "Campo inválido: limit.");
  const limit = Math.min(requested, EDITOR_DOCUMENT_LIST_MAX);
  // Literal exigido por scripts/check-person-source-registration.mjs (igual a EDITOR_DOCUMENTS_COLLECTION).
  let query: StoreQuery = deps.db.collection("editorDocuments").where("workspaceId", "==", workspaceId);
  if (authorId !== undefined) query = query.where("generatedBy", "==", authorId);
  if (input.status !== undefined) query = query.where("status", "==", input.status);
  query = query.orderBy("updatedAt", "desc").orderBy("__name__", "desc");
  if (input.cursor !== undefined) {
    const c = decodeListCursor(input.cursor);
    query = query.startAfter(new Date(c.ms), c.id);
  }
  const snap = await query.limit(limit + 1).get();
  const page = snap.docs.slice(0, limit);
  const items = page.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: String(data.title ?? ""),
      status: String(data.status),
      contentVersion: Number(data.contentVersion),
      updatedAt: isoOrNull(data.updatedAt),
      finalizedAt: isoOrNull(data.finalizedAt),
      origin: parseEditorOrigin(data.origin),
      generatedBy: String(data.generatedBy),
    };
  });
  const last = page[page.length - 1];
  const lastMs = last ? millisOrNull(last.data().updatedAt) : null;
  // Sem data legível não há cursor confiável: encerra a paginação em vez de repetir ou pular itens.
  const nextCursor = snap.docs.length > limit && last && lastMs !== null ? encodeListCursor(lastMs, last.id) : null;
  return { items, nextCursor };
}
