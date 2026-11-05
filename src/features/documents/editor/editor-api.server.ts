import { createHash } from "node:crypto";

import type { ServerUserContext } from "@/lib/auth-server";
import { getDocumentVariable } from "@/features/hr/integration/document-variables";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { AppError } from "@/lib/observability/app-error";
import { createInMemoryRateLimiter } from "@/lib/observability/rate-limit";

import { collectEditorFieldKeys, parseEditorContent, type EditorContent } from "./content-schema";
import {
  createEditorDraft,
  editorDocumentReferencesPdf,
  EditorStoreError,
  finalizeEditorDocument,
  getEditorContentVersion,
  getEditorDocument,
  getEditorFinalPdfRef,
  listEditorDocuments,
  recordEditorPdfDownloaded,
  recordEditorPreviewResolved,
  saveEditorContent,
  type EditorDocumentListStoreDeps,
  type EditorDocumentListStatus,
  type EditorDocumentOrigin,
  type EditorDocumentRecord,
  type EditorStoreDeps,
  type EditorSubjectRef,
} from "./document-store.server";
import type { HtmlPdfFailureReason, HtmlPdfResult } from "./html-pdf-converter.server";
import { PROVISIONAL_PAGE_LAYOUT, renderEditorHtml } from "./render-html";

/**
 * Camada de serviço das rotas do editor. As rotas só autenticam/validam a fronteira e chamam estas
 * funções; tudo que toca Firestore, Storage, conversor e resolvedor entra por `EditorApiDeps`
 * (injetável nos testes). Nenhuma função devolve `error.message`/causa: falhas esperadas viram
 * `AppError` com texto fixo e as inesperadas sobem intactas para a camada central (eventId).
 *
 * Custo Firestore (sem listener, polling ou listagem; todas as leituras são por ID):
 *  - criar: 1 leitura (transação) + 3 escritas;
 *  - abrir: 4 leituras (autorização 1 + versão 2 + documento 1);
 *  - salvar: 2 leituras (autorização 1 + transação 1) + 3 escritas;
 *  - prévia sample: 4 leituras; prévia resolved: 4 + resolvedor existente + confirmação do titular
 *    (leituras de um titular) + 1 leitura/1 escrita de auditoria `editor.preview_resolved`;
 *  - baixar PDF final: autorização 1 + ponteiro 1 + auditoria 1 leitura/1 escrita (`editor.pdf_downloaded`)
 *    + 1 leitura de objeto no Storage;
 *  - finalizar: 5 leituras + resolvedor + 2 escritas (+ 1 objeto no Storage; só na falha do commit:
 *    +1 leitura e 1 remoção no Storage).
 */

export type EditorActor = Pick<ServerUserContext, "decoded" | "userDoc" | "isDefaultAdmin" | "workspace_id" | "permissions">;
export type EditorAction = "create" | "list" | "view" | "download" | "edit" | "preview" | "finalize";

export type EditorApiDeps = {
  store: EditorStoreDeps;
  convertHtmlToPdf: (html: string) => Promise<HtmlPdfResult>;
  applyLetterhead: (pdf: Buffer) => Promise<Buffer>;
  stampSamplePreview: (pdf: Buffer) => Promise<Buffer>;
  stampResolvedPreview: (pdf: Buffer) => Promise<Buffer>;
  assertPersonScopes: (input: { actorAccess: EditorActor; employeeId: string; partyHrIds: string[] }) => Promise<void>;
  /** Valores brutos por chave do catálogo (`rawFlat` do resolvedor existente). */
  resolveRawValues: (input: { employeeId: string; includeSensitive: boolean }) => Promise<Record<string, unknown>>;
  /** Chaves `namespace:id` confirmadas do titular; lança se ambíguo/não confirmado. */
  confirmSubjectKeys: (employeeId: string) => Promise<string[]>;
  savePdf: (storagePath: string, pdf: Buffer) => Promise<void>;
  /** Remove o objeto recém-criado quando o commit falha (ignora inexistente). Nunca deve mascarar a falha original. */
  deletePdf: (storagePath: string) => Promise<void>;
  /** Lê o objeto do PDF final. Lança se ausente/ilegível; o tamanho é conferido pelo chamador. */
  readPdf: (storagePath: string) => Promise<Buffer>;
  /** Limitador por uid das operações que geram PDF/criam documentos (por processo; injetável nos testes). */
  rateLimit?: (scope: "create" | "pdf", uid: string) => { allowed: boolean; retryAfterSeconds: number };
};

/**
 * Limite por usuário, em memória do processo (reutiliza `createInMemoryRateLimiter`): é um freio
 * contra abuso por instância, não um limite global entre instâncias do Cloud Run. Prévias, finalizações
 * (cada uma aciona o Chromium) e criações de rascunho (3 escritas) têm janelas separadas.
 */
export const EDITOR_RATE_LIMITS = {
  create: { limit: 30, windowMs: 60_000 },
  pdf: { limit: 20, windowMs: 60_000 },
} as const;
const rateLimiters = {
  create: createInMemoryRateLimiter(EDITOR_RATE_LIMITS.create),
  pdf: createInMemoryRateLimiter(EDITOR_RATE_LIMITS.pdf),
};
export function resetEditorRateLimitersForTests() {
  rateLimiters.create.reset();
  rateLimiters.pdf.reset();
}
export function enforceRateLimit(deps: Pick<EditorApiDeps, "rateLimit">, scope: "create" | "pdf", uid: string) {
  const result = deps.rateLimit ? deps.rateLimit(scope, uid) : rateLimiters[scope].check(`${scope}:${uid}`);
  if (!result.allowed) {
    throw new AppError({
      code: "EDITOR_RATE_LIMITED",
      kind: "TRANSIENT_EXTERNAL",
      httpStatus: 429,
      retryable: true,
      safeMessage: "Muitas solicitações em pouco tempo. Aguarde um instante e tente novamente.",
      metadata: { retryAfterSeconds: result.retryAfterSeconds },
    });
  }
}

export async function defaultEditorApiDeps(): Promise<EditorApiDeps> {
  const [{ defaultEditorStoreDeps }, converter, letterhead, demo, stamp, access, resolver, lookup, storage, admin, cfg] = await Promise.all([
    import("./document-store.server"),
    import("./html-pdf-converter.server"),
    import("@/features/hr/documents/letterhead-pdf.server"),
    import("@/features/hr/documents/document-template-demo-preview.server"),
    import("./preview-stamp.server"),
    import("@/features/hr/documents/generation-access.server"),
    import("@/features/hr/documents/document-resolver.server"),
    import("@/features/privacy/person-lookup.server"),
    import("firebase-admin/storage"),
    import("@/lib/firebase-admin"),
    import("@/lib/firebase-client-config"),
  ]);
  return {
    store: await defaultEditorStoreDeps(),
    // Mesmo papel e margens da prévia de catálogo e do @page do HTML (sem isso o Gotenberg usaria Letter).
    convertHtmlToPdf: (html) =>
      converter.convertHtmlToPdf(html, {
        paper: { widthPx: PROVISIONAL_PAGE_LAYOUT.widthPx, heightPx: PROVISIONAL_PAGE_LAYOUT.heightPx },
        margins: {
          topPx: PROVISIONAL_PAGE_LAYOUT.marginTopPx,
          bottomPx: PROVISIONAL_PAGE_LAYOUT.marginBottomPx,
          leftPx: PROVISIONAL_PAGE_LAYOUT.marginLeftPx,
          rightPx: PROVISIONAL_PAGE_LAYOUT.marginRightPx,
        },
      }),
    applyLetterhead: (pdf) => letterhead.applyCoalaLetterheadToPdf(pdf).then((out) => Buffer.from(out)),
    stampSamplePreview: demo.stampDocumentTemplateDemoPreview,
    stampResolvedPreview: stamp.stampEditorResolvedPreview,
    assertPersonScopes: (input) => access.assertGenerationPersonScopes(input),
    resolveRawValues: async ({ employeeId, includeSensitive }) =>
      (await resolver.resolveDocumentData({ employeeId, includeSensitive })).rawFlat,
    confirmSubjectKeys: (employeeId) => lookup.confirmedSubjectKeysForDocument(employeeId, null),
    savePdf: async (storagePath, pdf) => {
      await storage.getStorage(admin.adminApp).bucket(cfg.firebaseClientConfig.storageBucket).file(storagePath).save(pdf, {
        resumable: false,
        metadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
      });
    },
    deletePdf: async (storagePath) => {
      await storage.getStorage(admin.adminApp).bucket(cfg.firebaseClientConfig.storageBucket).file(storagePath).delete({ ignoreNotFound: true });
    },
    readPdf: async (storagePath) => {
      const [bytes] = await storage.getStorage(admin.adminApp).bucket(cfg.firebaseClientConfig.storageBucket).file(storagePath).download();
      return bytes;
    },
  };
}

// ---------------------------------------------------------------- autorização (pura)

export function isEditorAuthor(actor: Pick<EditorActor, "decoded">, document: Pick<EditorDocumentRecord, "createdBy">) {
  return document.createdBy === actor.decoded.uid;
}

const forbidden = () =>
  new AppError({ code: "EDITOR_DOCUMENT_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para esta operação no documento." });

/**
 * Regras (decisão do DEV): generate é pré-requisito de tudo; abrir/salvar/prévia exigem ainda ser
 * o autor OU ter `documents.review`; finalizar exige `documents.review` além de generate.
 */
export function assertEditorAccess(actor: EditorActor, document: EditorDocumentRecord | null, action: EditorAction) {
  const can = (key: "documents.generate" | "documents.review") => hasFormalizationPermission(actor.permissions, key, actor.isDefaultAdmin);
  if (!can("documents.generate")) throw forbidden();
  if (action === "create" || action === "list") return;
  if (!document) throw forbidden();
  if (document.workspaceId !== actor.workspace_id) throw forbidden();
  if (action === "finalize") {
    if (!can("documents.review")) throw forbidden();
    return;
  }
  if (!isEditorAuthor(actor, document) && !can("documents.review")) throw forbidden();
}

export function actorCanReadSensitive(actor: EditorActor) {
  return hasFormalizationPermission(actor.permissions, "sensitiveData.view", actor.isDefaultAdmin);
}

// ---------------------------------------------------------------- erros públicos fixos

const STORE_ERRORS: Record<EditorStoreError["code"], () => AppError> = {
  invalid_input: () => new AppError({ code: "EDITOR_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Dados do documento inválidos." }),
  invalid_content: () => new AppError({ code: "EDITOR_CONTENT_INVALID", kind: "VALIDATION", safeMessage: "Conteúdo do documento inválido." }),
  not_found: () => new AppError({ code: "EDITOR_DOCUMENT_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Documento não encontrado." }),
  version_conflict: () => new AppError({ code: "EDITOR_VERSION_CONFLICT", kind: "CONFLICT", safeMessage: "O documento foi alterado por outra sessão." }),
  not_draft: () => new AppError({ code: "EDITOR_DOCUMENT_NOT_DRAFT", kind: "CONFLICT", safeMessage: "O documento já foi finalizado." }),
  idempotency_mismatch: () => new AppError({ code: "EDITOR_REQUEST_ID_REUSED", kind: "CONFLICT", safeMessage: "Identificador de requisição já usado com outro conteúdo." }),
};

/** Converte falha do store em erro público fixo; qualquer outra falha segue intacta (eventId central). */
export function toPublicEditorError(error: unknown): unknown {
  return error instanceof EditorStoreError ? STORE_ERRORS[error.code]() : error;
}

export const CONVERTER_PUBLIC_ERRORS: Record<HtmlPdfFailureReason, () => AppError> = {
  not_configured: () => converterUnavailable("not_configured"),
  auth_failed: () => converterUnavailable("auth_failed"),
  timeout: () => converterUnavailable("timeout"),
  upstream_error: () => converterUnavailable("upstream_error"),
  invalid_response: () => converterUnavailable("invalid_response"),
  upstream_busy: () => converterBusy(),
  too_large: () => tooLarge(),
  invalid_input: () => tooLarge(),
};
function converterUnavailable(reason: HtmlPdfFailureReason) {
  return new AppError({
    code: "EDITOR_PDF_UNAVAILABLE",
    kind: "TRANSIENT_EXTERNAL",
    httpStatus: 503,
    safeMessage: "A geração de PDF está indisponível no momento. O rascunho continua salvo.",
    metadata: { reason },
  });
}
function converterBusy() {
  return new AppError({
    code: "EDITOR_PDF_BUSY",
    kind: "TRANSIENT_EXTERNAL",
    httpStatus: 503,
    retryable: true,
    safeMessage: "Há muitas conversões em andamento. Tente novamente em instantes.",
    metadata: { reason: "upstream_busy" },
  });
}
function tooLarge() {
  return new AppError({ code: "EDITOR_PDF_INPUT_REJECTED", kind: "EXPECTED_BUSINESS", safeMessage: "O documento não pôde ser convertido em PDF." });
}

// ---------------------------------------------------------------- utilidades

export { collectEditorFieldKeys };

export type EditorDocumentView = {
  id: string;
  title: string;
  status: string;
  contentVersion: number;
  contentHash: string;
  subject: EditorSubjectRef | null;
  pdfAvailable: boolean;
};
export function toEditorDocumentView(record: EditorDocumentRecord): EditorDocumentView {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    contentVersion: record.contentVersion,
    contentHash: record.contentHash,
    subject: record.subject,
    pdfAvailable: record.pdfAvailable,
  };
}

/**
 * Visão pública mínima de um item da listagem. Sem uid de ator, titular, chaves de titular, ids de
 * funcionário ou caminho de Storage. `hasFields` é omitido: o registro do documento não guarda
 * `fieldKeys` (só a versão de conteúdo guarda, e ler cada versão violaria o custo da listagem).
 */
export type EditorDocumentListItemView = {
  id: string;
  title: string;
  status: string;
  contentVersion: number;
  updatedAt: string | null;
  finalizedAt?: string;
  origin: { kind: "editor" } | { kind: "editor_template"; templateId: string; templateVersion: number } | null;
  isOwn: boolean;
};
function toListOrigin(origin: EditorDocumentOrigin | null): EditorDocumentListItemView["origin"] {
  if (!origin) return null;
  return origin.kind === "editor_template"
    ? { kind: "editor_template", templateId: origin.templateId, templateVersion: origin.templateVersion }
    : { kind: "editor" };
}

export type ListDocumentsDeps = { store: EditorDocumentListStoreDeps };

/**
 * Listagem do workspace do ator. `documents.generate` é pré-requisito; sem `documents.review` só os
 * documentos do próprio ator (filtro `generatedBy` NA CONSULTA, não em memória). Somente leitura:
 * <= 26 leituras por chamada (limit <= 25 + 1), sem escrita, auditoria, listener ou polling.
 */
export async function listDocuments(
  input: { status?: EditorDocumentListStatus; limit?: number; cursor?: string },
  actor: EditorActor,
  deps: ListDocumentsDeps,
): Promise<{ items: EditorDocumentListItemView[]; nextCursor: string | null }> {
  assertEditorAccess(actor, null, "list");
  const uid = actor.decoded.uid;
  const seeAll = hasFormalizationPermission(actor.permissions, "documents.review", actor.isDefaultAdmin);
  const page = await guarded(() =>
    listEditorDocuments({ workspaceId: actor.workspace_id, ...(seeAll ? {} : { authorId: uid }), ...input }, deps.store),
  );
  return {
    items: page.items.map((item): EditorDocumentListItemView => ({
      id: item.id,
      title: item.title,
      status: item.status,
      contentVersion: item.contentVersion,
      updatedAt: item.updatedAt,
      ...(item.finalizedAt ? { finalizedAt: item.finalizedAt } : {}),
      origin: toListOrigin(item.origin),
      isOwn: item.generatedBy === uid,
    })),
    nextCursor: page.nextCursor,
  };
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toPublicEditorError(error);
  }
}

export type VersionConflict = { kind: "conflict"; currentVersion: number };
export type MissingFields = { kind: "missing_fields"; missingKeys: string[] };

// ---------------------------------------------------------------- operações

export async function createDraft(
  input: { clientRequestId: string; title: string; content?: unknown },
  actor: EditorActor,
  deps: EditorApiDeps,
) {
  enforceRateLimit(deps, "create", actor.decoded.uid);
  const record = await guarded(() =>
    createEditorDraft({ ...input, workspaceId: actor.workspace_id, actorId: actor.decoded.uid }, deps.store),
  );
  return toEditorDocumentView(record);
}

export async function openDocument(documentId: string, actor: EditorActor, deps: EditorApiDeps) {
  const version = await guarded(() => getEditorContentVersion(documentId, actor.workspace_id, deps.store));
  const record = await guarded(() => getEditorDocument(documentId, actor.workspace_id, deps.store));
  return { document: toEditorDocumentView(record), content: version.content, version: version.version };
}

export async function saveContent(
  input: { documentId: string; clientRequestId: string; expectedContentVersion: number; content: unknown; title?: string },
  actor: EditorActor,
  deps: EditorApiDeps,
): Promise<{ kind: "saved"; document: EditorDocumentView } | VersionConflict> {
  try {
    const record = await saveEditorContent({ ...input, workspaceId: actor.workspace_id, actorId: actor.decoded.uid }, deps.store);
    return { kind: "saved", document: toEditorDocumentView(record) };
  } catch (error) {
    if (error instanceof EditorStoreError && error.code === "version_conflict") {
      return { kind: "conflict", currentVersion: error.details?.currentVersion ?? 0 };
    }
    throw toPublicEditorError(error);
  }
}

/**
 * O caminho do PDF é endereçado pelo hash do PDF gerado, e esse PDF não é determinístico (o Chromium e
 * o pdf-lib embutem datas): o MESMO caminho só ocorre se os bytes forem idênticos (ex.: finalização
 * concorrente que gravou o mesmo resultado). Por isso só apaga se a releitura do documento provar que ele NÃO referencia este caminho;
 * se a releitura falhar (commit ambíguo), mantém o objeto (órfão é preferível a perder o PDF final).
 * Qualquer falha aqui é engolida: a falha original do commit é a que sobe.
 */
async function discardOrphanPdf(documentId: string, workspaceId: string, path: string, deps: EditorApiDeps) {
  try {
    if (await editorDocumentReferencesPdf(documentId, workspaceId, path, deps.store)) return;
    await deps.deletePdf(path);
  } catch {
    // Limpeza best-effort; o objeto órfão permanece sob a ACL privada do bucket.
  }
}

async function loadDraftContent(documentId: string, actor: EditorActor, deps: EditorApiDeps) {
  const record = await guarded(() => getEditorDocument(documentId, actor.workspace_id, deps.store));
  if (record.status !== "draft") throw STORE_ERRORS.not_draft();
  const version = await guarded(() => getEditorContentVersion(documentId, actor.workspace_id, deps.store, record.contentVersion));
  // Revalida na saída do store: o renderizador só recebe conteúdo aprovado por parseEditorContent.
  const parsed = parseEditorContent(version.content);
  if (!parsed.ok) throw STORE_ERRORS.invalid_content();
  return { record, content: parsed.content };
}

/** Resolve os valores reais do titular (escopo + dado sensível + resolvedor). Nunca usado no modo sample. */
async function resolveSubjectValues(content: EditorContent, employeeId: string, actor: EditorActor, deps: EditorApiDeps) {
  const keys = collectEditorFieldKeys(content);
  const includeSensitive = actorCanReadSensitive(actor);
  if (!includeSensitive && keys.some((key) => getDocumentVariable(key)?.sensitive)) {
    throw new AppError({ code: "EDITOR_SENSITIVE_FIELD_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para usar campos de dados sensíveis neste documento." });
  }
  await deps.assertPersonScopes({ actorAccess: actor, employeeId, partyHrIds: [] });
  return deps.resolveRawValues({ employeeId, includeSensitive });
}

async function htmlToLetterheadPdf(html: string, deps: EditorApiDeps) {
  const converted = await deps.convertHtmlToPdf(html);
  if (!converted.ok) throw CONVERTER_PUBLIC_ERRORS[converted.reason]();
  return deps.applyLetterhead(converted.pdf);
}

async function confirmSubjectKeysOrThrow(employeeId: string, deps: EditorApiDeps) {
  try {
    return await deps.confirmSubjectKeys(employeeId);
  } catch (cause) {
    throw new AppError({ code: "EDITOR_SUBJECT_UNCONFIRMED", kind: "EXPECTED_BUSINESS", safeMessage: "Não foi possível confirmar o titular do documento.", cause });
  }
}

export async function renderPreview(
  input: { documentId: string; mode: "sample" | "resolved"; employeeId?: string },
  actor: EditorActor,
  deps: EditorApiDeps,
): Promise<{ kind: "pdf"; pdf: Buffer } | MissingFields> {
  enforceRateLimit(deps, "pdf", actor.decoded.uid);
  const { record, content } = await loadDraftContent(input.documentId, actor, deps);
  let rendered;
  if (input.mode === "sample") {
    // Só valores de exemplo: nenhuma consulta a titular, escopo ou resolvedor.
    rendered = renderEditorHtml(content, { mode: "sample" });
  } else {
    if (!input.employeeId) throw STORE_ERRORS.invalid_input();
    const values = await resolveSubjectValues(content, input.employeeId, actor, deps);
    // Dado pessoal foi lido: audita (sem conteúdo) antes de devolver qualquer saída; falha = sem prévia.
    const subjectKeys = await confirmSubjectKeysOrThrow(input.employeeId, deps);
    await guarded(() =>
      recordEditorPreviewResolved(
        { documentId: input.documentId, workspaceId: actor.workspace_id, actorId: actor.decoded.uid, version: record.contentVersion, contentHash: record.contentHash, subjectKeys },
        deps.store,
      ),
    );
    rendered = renderEditorHtml(content, { mode: "resolved", values });
    if (rendered.missingKeys.length) return { kind: "missing_fields", missingKeys: rendered.missingKeys };
  }
  const pdf = await htmlToLetterheadPdf(rendered.html, deps);
  const stamped = input.mode === "sample" ? await deps.stampSamplePreview(pdf) : await deps.stampResolvedPreview(pdf);
  return { kind: "pdf", pdf: stamped };
}

export function safeFileName(title: string) {
  return `${title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "documento"}.pdf`;
}

const EDITOR_PDF_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Download do PDF final. Só `final` + `pdfGenerationStatus: "ready"` + caminho gravado; o caminho
 * nunca sai do servidor. Audita (sem conteúdo) antes de entregar os bytes; falha do Storage = 503 fixo.
 */
export async function downloadFinalPdf(documentId: string, actor: EditorActor, deps: EditorApiDeps): Promise<{ pdf: Buffer; fileName: string }> {
  const ref = await guarded(() => getEditorFinalPdfRef(documentId, actor.workspace_id, deps.store));
  if (ref.status !== "final") {
    throw new AppError({ code: "EDITOR_DOCUMENT_NOT_FINAL", kind: "CONFLICT", safeMessage: "O documento ainda não foi finalizado." });
  }
  if (ref.pdfGenerationStatus !== "ready" || !ref.pdfStoragePath || !ref.pdfContentHash) {
    throw new AppError({ code: "EDITOR_PDF_NOT_AVAILABLE", kind: "NOT_FOUND", safeMessage: "O PDF deste documento não está disponível." });
  }
  const unavailable = (cause?: unknown) =>
    new AppError({
      code: "EDITOR_STORAGE_UNAVAILABLE",
      kind: "TRANSIENT_EXTERNAL",
      httpStatus: 503,
      safeMessage: "Não foi possível obter o PDF agora. Tente novamente em instantes.",
      cause,
    });
  let pdf: Buffer;
  try {
    pdf = await deps.readPdf(ref.pdfStoragePath);
  } catch (cause) {
    throw unavailable(cause);
  }
  if (!Buffer.isBuffer(pdf) || pdf.length === 0 || pdf.length > EDITOR_PDF_MAX_BYTES || pdf.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw unavailable();
  }
  await guarded(() =>
    recordEditorPdfDownloaded(
      { documentId, workspaceId: actor.workspace_id, actorId: actor.decoded.uid, version: ref.contentVersion, contentHash: ref.contentHash, pdfContentHash: ref.pdfContentHash! },
      deps.store,
    ),
  );
  return { pdf, fileName: safeFileName(ref.title) };
}

function subjectRefFromKeys(keys: string[]): EditorSubjectRef | null {
  for (const namespace of ["hr.employees", "main.users"] as const) {
    const hit = keys.find((key) => key.startsWith(`${namespace}:`));
    if (hit) return { namespace, id: hit.slice(namespace.length + 1) };
  }
  return null;
}

export async function finalizeDocument(
  input: { documentId: string; clientRequestId: string; expectedContentVersion: number; employeeId?: string },
  actor: EditorActor,
  deps: EditorApiDeps,
): Promise<{ kind: "final"; document: EditorDocumentView; replayed: boolean } | VersionConflict | MissingFields> {
  enforceRateLimit(deps, "pdf", actor.decoded.uid);
  const current = await guarded(() => getEditorDocument(input.documentId, actor.workspace_id, deps.store));
  if (current.status === "final" && current.finalizeRequestId === input.clientRequestId) {
    return { kind: "final", document: toEditorDocumentView(current), replayed: true };
  }
  if (current.status !== "draft") throw STORE_ERRORS.not_draft();
  if (current.contentVersion !== input.expectedContentVersion) {
    return { kind: "conflict", currentVersion: current.contentVersion };
  }
  const { content } = await loadDraftContent(input.documentId, actor, deps);
  const hasFields = collectEditorFieldKeys(content).length > 0;
  // Regra do 1º corte: documento com campos exige titular; sem campos pode ser avulso.
  if (hasFields && !input.employeeId) {
    throw new AppError({ code: "EDITOR_SUBJECT_REQUIRED", kind: "EXPECTED_BUSINESS", safeMessage: "Informe o titular para finalizar um documento com campos." });
  }

  let values: Record<string, unknown> = {};
  let subjectKeys: string[] = [];
  if (input.employeeId) {
    values = await resolveSubjectValues(content, input.employeeId, actor, deps);
    subjectKeys = await confirmSubjectKeysOrThrow(input.employeeId, deps);
  }
  const rendered = renderEditorHtml(content, { mode: "resolved", values });
  if (rendered.missingKeys.length) return { kind: "missing_fields", missingKeys: rendered.missingKeys };

  const pdf = await htmlToLetterheadPdf(rendered.html, deps);
  const pdfContentHash = createHash("sha256").update(pdf).digest("hex");
  const pdfStoragePath = `generated-documents/${input.employeeId ?? "standalone"}/${input.documentId}/${pdfContentHash}.pdf`;
  try {
    await deps.savePdf(pdfStoragePath, pdf);
  } catch (cause) {
    // Efeito externo falhou: nada é marcado como final (o rascunho segue com pdfGenerationStatus "unavailable").
    throw new AppError({
      code: "EDITOR_STORAGE_UNAVAILABLE",
      kind: "TRANSIENT_EXTERNAL",
      httpStatus: 503,
      safeMessage: "Não foi possível guardar o PDF agora. O documento continua como rascunho.",
      cause,
    });
  }
  try {
    const result = await finalizeEditorDocument(
      {
        documentId: input.documentId,
        workspaceId: actor.workspace_id,
        actorId: actor.decoded.uid,
        clientRequestId: input.clientRequestId,
        expectedContentVersion: input.expectedContentVersion,
        pdfStoragePath,
        pdfContentHash,
        originalName: safeFileName(current.title),
        employeeId: input.employeeId ?? null,
        subject: subjectRefFromKeys(subjectKeys),
        subjectKeys,
      },
      deps.store,
    );
    return { kind: "final", document: toEditorDocumentView(result.record), replayed: result.replayed };
  } catch (error) {
    // Commit falhou depois do upload: tenta remover o objeto novo, sem mascarar a falha original.
    await discardOrphanPdf(input.documentId, actor.workspace_id, pdfStoragePath, deps);
    if (error instanceof EditorStoreError && error.code === "version_conflict") {
      return { kind: "conflict", currentVersion: error.details?.currentVersion ?? 0 };
    }
    throw toPublicEditorError(error);
  }
}
