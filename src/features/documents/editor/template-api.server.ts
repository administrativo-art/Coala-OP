import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { AppError } from "@/lib/observability/app-error";

import { parseEditorContent } from "./content-schema";
import { getEditorDocument } from "./document-store.server";
import { EditorTemplateError } from "./document-store.types";
import type { EditorTemplateRecord, EditorTemplateStatus, EditorTemplateStoreDeps } from "./document-store.types";
import {
  assertEditorAccess,
  CONVERTER_PUBLIC_ERRORS,
  enforceRateLimit,
  toEditorDocumentView,
  toPublicEditorError,
  type EditorActor,
  type EditorApiDeps,
} from "./editor-api.server";
import { renderEditorHtml } from "./render-html";
import {
  archiveEditorTemplate,
  createEditorTemplate,
  getEditorTemplate,
  getEditorTemplateVersion,
  listEditorTemplates,
  publishEditorTemplate,
  saveEditorTemplateContent,
  useEditorTemplate,
} from "./template-store.server";

/**
 * Camada de serviço dos modelos do editor (M3). Reaproveita ator, limitador, conversor e erros do
 * serviço do documento; só acrescenta a regra de acesso do modelo e o mapeamento de erros públicos.
 * Modelo é "do sistema": sem titular e sem dado de pessoa; todo `actorId` é ATOR. Nenhuma função
 * devolve `error.message`/causa.
 *
 * Custo Firestore (sem listener/polling; ver template-store.server.ts): listar <= 26 leituras por
 * página (limit <= 25, cursor); abrir 3 (modelo 1 + versão 2); criar 1 (+2 com fromDocument, +1 de
 * autorização do documento) + 3 escritas; salvar 1 + 3; publicar 2 + 2; arquivar 1 + 2; usar 3 + 4;
 * prévia de exemplo 3 leituras e nenhuma escrita (o PDF não é persistido).
 */

/** Mesmo `db` serve ao store de documentos e ao de modelos (o tipo de modelos é um superconjunto). */
export type TemplateApiDeps = Omit<EditorApiDeps, "store"> & { store: EditorTemplateStoreDeps & EditorApiDeps["store"] };

export type TemplateAction = "list" | "open" | "create" | "save" | "preview" | "use" | "publish" | "archive";

export async function defaultTemplateApiDeps(): Promise<TemplateApiDeps> {
  const [{ defaultEditorApiDeps }, { defaultEditorTemplateStoreDeps }] = await Promise.all([
    import("./editor-api.server"),
    import("./template-store.server"),
  ]);
  const base = await defaultEditorApiDeps();
  const templateStore = await defaultEditorTemplateStoreDeps();
  return { ...base, store: { ...base.store, ...templateStore } as TemplateApiDeps["store"] };
}

// ---------------------------------------------------------------- autorização (pura)

const forbidden = () =>
  new AppError({ code: "EDITOR_TEMPLATE_FORBIDDEN", kind: "AUTHORIZATION", safeMessage: "Sem permissão para esta operação no modelo." });

/**
 * Regra do DEV: `documents.generate` é pré-requisito de tudo; qualquer detentor lista, abre, cria,
 * salva versão, faz prévia e usa modelo publicado; publicar e arquivar exigem também `documents.review`.
 * O acesso ao modelo é por workspace (isolamento no store), não por autoria.
 */
export function assertTemplateAccess(actor: EditorActor, action: TemplateAction) {
  const can = (key: "documents.generate" | "documents.review") => hasFormalizationPermission(actor.permissions, key, actor.isDefaultAdmin);
  if (!can("documents.generate")) throw forbidden();
  if ((action === "publish" || action === "archive") && !can("documents.review")) throw forbidden();
}

// ---------------------------------------------------------------- erros públicos fixos

const TEMPLATE_ERRORS: Record<EditorTemplateError["code"], () => AppError> = {
  invalid_input: () => new AppError({ code: "EDITOR_TEMPLATE_INPUT_INVALID", kind: "VALIDATION", safeMessage: "Dados do modelo inválidos." }),
  invalid_content: () => new AppError({ code: "EDITOR_TEMPLATE_CONTENT_INVALID", kind: "VALIDATION", safeMessage: "Conteúdo do modelo inválido." }),
  not_found: () => new AppError({ code: "EDITOR_TEMPLATE_NOT_FOUND", kind: "NOT_FOUND", safeMessage: "Modelo não encontrado." }),
  version_conflict: () => new AppError({ code: "EDITOR_TEMPLATE_VERSION_CONFLICT", kind: "CONFLICT", safeMessage: "O modelo foi alterado por outra sessão." }),
  template_archived: () => new AppError({ code: "EDITOR_TEMPLATE_ARCHIVED", kind: "CONFLICT", safeMessage: "O modelo está arquivado." }),
  template_not_published: () => new AppError({ code: "EDITOR_TEMPLATE_NOT_PUBLISHED", kind: "CONFLICT", safeMessage: "O modelo ainda não foi publicado." }),
  published_version_mismatch: () =>
    new AppError({ code: "EDITOR_TEMPLATE_PUBLISHED_VERSION_CHANGED", kind: "CONFLICT", safeMessage: "A versão publicada do modelo mudou." }),
  idempotency_mismatch: () =>
    new AppError({ code: "EDITOR_TEMPLATE_REQUEST_ID_REUSED", kind: "CONFLICT", safeMessage: "Identificador de requisição já usado com outro conteúdo." }),
};

/** Converte falha do store de modelos (ou de documento, em fromDocument) em erro público fixo. */
export function toPublicTemplateError(error: unknown): unknown {
  if (error instanceof EditorTemplateError) return TEMPLATE_ERRORS[error.code]();
  return toPublicEditorError(error);
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toPublicTemplateError(error);
  }
}

// ---------------------------------------------------------------- visões

export type EditorTemplateView = {
  id: string;
  name: string;
  description: string;
  status: EditorTemplateStatus;
  currentVersion: number;
  publishedVersion: number | null;
  contentHash: string;
  contentBytes: number;
  fieldKeys: string[];
  /** ISO da última alteração (sem uid de ator). */
  updatedAt: string | null;
};
export function toEditorTemplateView(record: EditorTemplateRecord): EditorTemplateView {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    status: record.status,
    currentVersion: record.currentVersion,
    publishedVersion: record.publishedVersion,
    contentHash: record.contentHash,
    contentBytes: record.contentBytes,
    fieldKeys: record.fieldKeys,
    updatedAt: record.updatedAt,
  };
}

export type TemplateVersionConflict = { kind: "conflict"; currentVersion: number };
export type TemplatePublishedMismatch = { kind: "published_version_changed"; publishedVersion: number | null };

/** Conflito de versão vira resultado (a rota responde 409 com a versão atual); o resto sobe como erro público. */
async function withConflict<T>(work: () => Promise<T>): Promise<T | TemplateVersionConflict> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof EditorTemplateError && error.code === "version_conflict") {
      return { kind: "conflict", currentVersion: error.details?.currentVersion ?? 0 };
    }
    throw toPublicTemplateError(error);
  }
}

// ---------------------------------------------------------------- operações

export async function listTemplates(
  input: { status?: EditorTemplateStatus; limit?: number; cursor?: string },
  actor: EditorActor,
  deps: TemplateApiDeps,
) {
  const page = await guarded(() => listEditorTemplates({ workspaceId: actor.workspace_id, ...input }, deps.store));
  return { items: page.items.map(toEditorTemplateView), nextCursor: page.nextCursor };
}

export async function openTemplate(templateId: string, actor: EditorActor, deps: TemplateApiDeps) {
  const record = await guarded(() => getEditorTemplate(templateId, actor.workspace_id, deps.store));
  const version = await guarded(() => getEditorTemplateVersion(templateId, actor.workspace_id, deps.store, record.currentVersion));
  return { template: toEditorTemplateView(record), content: version.content, version: version.version };
}

export async function createTemplate(
  input: {
    clientRequestId: string;
    name: string;
    description?: string;
    content?: unknown;
    fromDocument?: { documentId: string; version: number };
  },
  actor: EditorActor,
  deps: TemplateApiDeps,
) {
  enforceRateLimit(deps, "create", actor.decoded.uid);
  if (input.fromDocument) {
    // O ator só copia o que poderia abrir: mesmas regras do documento (generate + autor OU review).
    const source = await guarded(() => getEditorDocument(input.fromDocument!.documentId, actor.workspace_id, deps.store));
    assertEditorAccess(actor, source, "view");
  }
  const record = await guarded(() => createEditorTemplate({ ...input, workspaceId: actor.workspace_id, actorId: actor.decoded.uid }, deps.store));
  return toEditorTemplateView(record);
}

export async function saveTemplateContent(
  input: { templateId: string; clientRequestId: string; expectedVersion: number; content: unknown; name?: string; description?: string },
  actor: EditorActor,
  deps: TemplateApiDeps,
): Promise<{ kind: "saved"; template: EditorTemplateView } | TemplateVersionConflict> {
  const result = await withConflict(() =>
    saveEditorTemplateContent({ ...input, workspaceId: actor.workspace_id, actorId: actor.decoded.uid }, deps.store),
  );
  return "kind" in result ? result : { kind: "saved", template: toEditorTemplateView(result) };
}

export async function publishTemplate(
  input: { templateId: string; clientRequestId: string; expectedVersion: number },
  actor: EditorActor,
  deps: TemplateApiDeps,
): Promise<{ kind: "published"; template: EditorTemplateView } | TemplateVersionConflict> {
  const result = await withConflict(() =>
    publishEditorTemplate({ ...input, workspaceId: actor.workspace_id, actorId: actor.decoded.uid }, deps.store),
  );
  return "kind" in result ? result : { kind: "published", template: toEditorTemplateView(result) };
}

export async function archiveTemplate(
  input: { templateId: string; clientRequestId: string; expectedVersion: number },
  actor: EditorActor,
  deps: TemplateApiDeps,
): Promise<{ kind: "archived"; template: EditorTemplateView } | TemplateVersionConflict> {
  const result = await withConflict(() =>
    archiveEditorTemplate({ ...input, workspaceId: actor.workspace_id, actorId: actor.decoded.uid }, deps.store),
  );
  return "kind" in result ? result : { kind: "archived", template: toEditorTemplateView(result) };
}

export async function useTemplate(
  input: { templateId: string; clientRequestId: string; expectedPublishedVersion?: number },
  actor: EditorActor,
  deps: TemplateApiDeps,
) {
  enforceRateLimit(deps, "create", actor.decoded.uid);
  try {
    const record = await useEditorTemplate({ ...input, workspaceId: actor.workspace_id, actorId: actor.decoded.uid }, deps.store);
    return { kind: "created" as const, document: toEditorDocumentView(record) };
  } catch (error) {
    if (error instanceof EditorTemplateError && error.code === "published_version_mismatch") {
      return { kind: "published_version_changed" as const, publishedVersion: error.details?.publishedVersion ?? null };
    }
    throw toPublicTemplateError(error);
  }
}

/**
 * Prévia de EXEMPLO da versão corrente do modelo: só valores de amostra, sem titular, escopo ou
 * resolvedor, carimbada como amostra. Não persiste o PDF nem grava auditoria.
 */
export async function renderTemplatePreview(templateId: string, actor: EditorActor, deps: TemplateApiDeps): Promise<Buffer> {
  enforceRateLimit(deps, "pdf", actor.decoded.uid);
  const record = await guarded(() => getEditorTemplate(templateId, actor.workspace_id, deps.store));
  const version = await guarded(() => getEditorTemplateVersion(templateId, actor.workspace_id, deps.store, record.currentVersion));
  // Revalida na saída do store: o renderizador só recebe conteúdo aprovado por parseEditorContent.
  const parsed = parseEditorContent(version.content);
  if (!parsed.ok) throw TEMPLATE_ERRORS.invalid_content();
  const rendered = renderEditorHtml(parsed.content, { mode: "sample" });
  const converted = await deps.convertHtmlToPdf(rendered.html);
  if (!converted.ok) throw CONVERTER_PUBLIC_ERRORS[converted.reason]();
  return deps.stampSamplePreview(await deps.applyLetterhead(converted.pdf));
}
