import type { EditorContent } from "./content-schema";

/**
 * Coleção própria (banco `main`) dos documentos do editor. Deliberadamente NÃO é `generatedDocuments`:
 * as rotas legadas (listagem, DELETE/PATCH, download) operam sobre qualquer documento dessa coleção
 * sem filtro de workspace/autor/formato; coleção separada impede que elas enxerguem rascunhos do editor.
 * Subcoleções: `contentVersions` (versões imutáveis) e `audit` (eventos sem conteúdo).
 */
export const EDITOR_DOCUMENTS_COLLECTION = "editorDocuments" as const;
export const EDITOR_TEMPLATE_ID = "system-editor-document" as const;
export const EDITOR_PIPELINE_VERSION = "coala-editor-pipeline-v1" as const;
export const EDITOR_LETTERHEAD_PROFILE_ID = "coala-letterhead-v2" as const;
export const EDITOR_CONTENT_FORMAT = "tiptap-json" as const;
export const EDITOR_SUBJECT_NAMESPACES = ["main.users", "hr.employees", "hr.candidates", "hr.onboardingPersons"] as const;
export type EditorSubjectNamespace = (typeof EDITOR_SUBJECT_NAMESPACES)[number];

/** Titular já confirmado pelo chamador (ID imutável + namespace). Nunca derivado de nome ou CPF. */
export type EditorSubjectRef = { namespace: EditorSubjectNamespace; id: string };

/**
 * Origem imutável do documento. `editor/blank` é o legado (documentos existentes); `editor_template`
 * registra o modelo e a versão usados, com o hash do conteúdo no momento do uso.
 */
export type EditorDocumentOrigin =
  | { kind: "editor"; from: "blank" }
  | { kind: "editor_template"; templateId: string; templateVersion: number; templateContentHash: string };

export const EDITOR_TEMPLATE_RECORD_ID_PATTERN = /^tpl_[0-9a-f]{32}$/;

/** Valida a origem lida/recebida; aceita o formato legado e o de modelo. Qualquer outra forma é nula. */
export function parseEditorOrigin(value: unknown): EditorDocumentOrigin | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (o.kind === "editor") {
    return o.from === "blank" && Object.keys(o).length === 2 ? { kind: "editor", from: "blank" } : null;
  }
  if (o.kind === "editor_template") {
    if (
      Object.keys(o).length === 4 &&
      typeof o.templateId === "string" && EDITOR_TEMPLATE_RECORD_ID_PATTERN.test(o.templateId) &&
      typeof o.templateVersion === "number" && Number.isInteger(o.templateVersion) && o.templateVersion >= 1 &&
      typeof o.templateContentHash === "string" && /^[0-9a-f]{64}$/.test(o.templateContentHash)
    ) {
      return { kind: "editor_template", templateId: o.templateId, templateVersion: o.templateVersion, templateContentHash: o.templateContentHash };
    }
  }
  return null;
}

export type EditorStoreErrorCode =
  | "invalid_input"
  | "invalid_content"
  | "not_found"
  | "version_conflict"
  | "not_draft"
  | "idempotency_mismatch";

export type EditorAuditEventType = "created" | "saved" | "finalized" | "preview_resolved" | "pdf_downloaded";

export class EditorStoreError extends Error {
  constructor(readonly code: EditorStoreErrorCode, message: string, readonly details?: { currentVersion?: number }) {
    super(message);
    this.name = "EditorStoreError";
  }
}

/** Documento principal: NÃO contém o JSON do conteúdo, apenas ponteiro e hash. */
export type EditorDocumentRecord = {
  id: string;
  workspaceId: string;
  title: string;
  status: string;
  contentVersion: number;
  contentHash: string;
  contentSchemaVersion: number;
  contentBytes: number;
  subject: EditorSubjectRef | null;
  subjectKeys: string[];
  generatedBy: string;
  createdBy: string;
  updatedBy: string;
  hasStoragePath: false;
  pdfAvailable: boolean;
  finalizeRequestId: string | null;
};

export type EditorContentVersionRecord = {
  documentId: string;
  version: number;
  content: EditorContent;
  contentHash: string;
  contentSchemaVersion: number;
  savedBy: string;
  clientRequestId: string;
};

export type CreateEditorDraftInput = {
  workspaceId: string;
  actorId: string;
  clientRequestId: string;
  title: string;
  /** Conteúdo bruto; é validado por parseEditorContent. Omitido = documento em branco. */
  content?: unknown;
  subject?: EditorSubjectRef | null;
  /** Omitido = documento em branco (`editor/blank`). */
  origin?: EditorDocumentOrigin;
};

export type SaveEditorContentInput = {
  documentId: string;
  workspaceId: string;
  actorId: string;
  clientRequestId: string;
  expectedContentVersion: number;
  content: unknown;
  title?: string;
};

export type FinalizeEditorInput = {
  documentId: string;
  workspaceId: string;
  actorId: string;
  clientRequestId: string;
  expectedContentVersion: number;
  /** PDF já gravado no Storage (efeito externo ocorre ANTES deste commit). */
  pdfStoragePath: string;
  pdfContentHash: string;
  originalName: string;
  employeeId: string | null;
  subject: EditorSubjectRef | null;
  subjectKeys: string[];
};

/** Prévia `resolved` leu dados pessoais do titular: grava evento de auditoria sem conteúdo. */
export type RecordPreviewResolvedInput = {
  documentId: string;
  workspaceId: string;
  actorId: string;
  /** Versão de conteúdo renderizada. */
  version: number;
  contentHash: string;
  subjectKeys: string[];
};

/** Download do PDF final: auditoria sem conteúdo (ator, versão, hash do PDF). */
export type RecordPdfDownloadedInput = {
  documentId: string;
  workspaceId: string;
  actorId: string;
  version: number;
  contentHash: string;
  pdfContentHash: string;
};

/** Ponteiro interno do PDF final (nunca devolvido ao cliente). */
export type EditorFinalPdfRef = {
  status: string;
  pdfGenerationStatus: string | null;
  pdfStoragePath: string | null;
  pdfContentHash: string | null;
  contentVersion: number;
  contentHash: string;
  title: string;
};

/** Subconjunto mínimo do Firestore Admin usado aqui; permite fake nos testes. */
export type StoreSnap = { exists: boolean; data(): Record<string, unknown> | undefined };
export type StoreRef = { id: string; get(): Promise<StoreSnap>; collection(name: string): { doc(id: string): StoreRef } };
export type StoreTx = {
  get(ref: StoreRef): Promise<StoreSnap>;
  set(ref: StoreRef, data: Record<string, unknown>): unknown;
  /** Falha se o documento já existir (garante imutabilidade de versões e auditoria). */
  create(ref: StoreRef, data: Record<string, unknown>): unknown;
  update(ref: StoreRef, data: Record<string, unknown>): unknown;
};
export type StoreDb = {
  collection(name: string): { doc(id?: string): StoreRef };
  runTransaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
};
export type EditorStoreDeps = { db: StoreDb; now?: () => Date };

// ---------------------------------------------------------------- modelos (editorTemplates)
/**
 * Decisão (2026-11-05): o modelo NÃO tem titular nem dado de pessoa. `createdBy`, `updatedBy`, `savedBy`
 * e `actorId` são ATOR (quem executou), nunca titular. Modelos valem para todas as unidades do
 * workspace e não entram no catálogo (só a entrada genérica `system-editor-document`).
 * A coleção é literal por exigência do check de fonte pessoal; subcoleções: `versions/{n}` (imutável)
 * e `audit` (eventos sem conteúdo).
 */
export const EDITOR_TEMPLATES_COLLECTION = "editorTemplates" as const;
export const EDITOR_TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;
export type EditorTemplateStatus = (typeof EDITOR_TEMPLATE_STATUSES)[number];

export type EditorTemplateErrorCode =
  | "invalid_input"
  | "invalid_content"
  | "not_found"
  | "version_conflict"
  | "template_archived"
  | "template_not_published"
  | "published_version_mismatch"
  | "idempotency_mismatch";

export type EditorTemplateAuditEventType = "created" | "saved" | "published" | "archived" | "used";

export class EditorTemplateError extends Error {
  constructor(readonly code: EditorTemplateErrorCode, message: string, readonly details?: { currentVersion?: number; publishedVersion?: number | null }) {
    super(message);
    this.name = "EditorTemplateError";
  }
}

/** Registro principal: NÃO contém o JSON do conteúdo, apenas ponteiros, hash e `fieldKeys`. */
export type EditorTemplateRecord = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: EditorTemplateStatus;
  currentVersion: number;
  /** Versão disponível para "usar"; null enquanto nunca publicado. */
  publishedVersion: number | null;
  /** Nome do modelo no momento da publicação (título de documentos criados); null se nunca publicado/legado. */
  publishedName: string | null;
  /** Origem opaca quando criado de um documento do editor; null caso contrário/legado. */
  source: { kind: "editor_document"; documentId: string; version: number } | null;
  contentHash: string;
  contentSchemaVersion: number;
  contentBytes: number;
  fieldKeys: string[];
  createdBy: string;
  updatedBy: string;
  /** ISO da última alteração; null se o registro legado não tiver data legível. */
  updatedAt: string | null;
};

export type EditorTemplateVersionRecord = {
  templateId: string;
  version: number;
  content: EditorContent;
  contentHash: string;
  contentSchemaVersion: number;
  fieldKeys: string[];
  savedBy: string;
  clientRequestId: string;
};

export type EditorTemplateAuditRecord = {
  type: EditorTemplateAuditEventType;
  version: number;
  contentHash: string;
  actorId: string;
  clientRequestId: string;
};

// ---------------------------------------------------------------- consulta de modelos
/** Subconjunto de Query do Admin SDK usado na listagem de modelos (permite fake nos testes). */
export type StoreQueryDoc = { id: string; data(): Record<string, unknown> };
export type StoreQuery = {
  where(field: string, op: "==", value: unknown): StoreQuery;
  orderBy(field: string, direction?: "asc" | "desc"): StoreQuery;
  startAfter(...values: unknown[]): StoreQuery;
  limit(n: number): StoreQuery;
  get(): Promise<{ docs: StoreQueryDoc[] }>;
};
export type EditorTemplateStoreDb = Omit<StoreDb, "collection"> & {
  collection(name: string): { doc(id?: string): StoreRef } & Pick<StoreQuery, "where">;
};
export type EditorTemplateStoreDeps = { db: EditorTemplateStoreDb; now?: () => Date };

export type EditorTemplateListPage = { items: EditorTemplateRecord[]; nextCursor: string | null };

// ---------------------------------------------------------------- listagem de documentos do editor
export type EditorDocumentListItem = {
  id: string;
  title: string;
  status: string;
  contentVersion: number;
  /** ISO; null se o registro não tiver data legível. */
  updatedAt: string | null;
  finalizedAt: string | null;
  origin: EditorDocumentOrigin | null;
  /** Autor (ATOR) do documento: uso interno do serviço para calcular `isOwn`; nunca vai ao cliente. */
  generatedBy: string;
};
export type EditorDocumentListPage = { items: EditorDocumentListItem[]; nextCursor: string | null };
export const EDITOR_DOCUMENT_LIST_STATUSES = ["draft", "final"] as const;
export type EditorDocumentListStatus = (typeof EDITOR_DOCUMENT_LIST_STATUSES)[number];
export const EDITOR_DOCUMENT_RECORD_ID_PATTERN = /^ed_[0-9a-f]{32}$/;
/** Deps da listagem: mesmo `db` do store de documentos com consulta (where/orderBy/startAfter/limit). */
export type EditorDocumentListStoreDeps = { db: EditorTemplateStoreDb; now?: () => Date };
