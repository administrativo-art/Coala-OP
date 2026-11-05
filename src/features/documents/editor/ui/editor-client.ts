import type { AuthenticatedApiRequestInit } from "@/lib/authenticated-api-client";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { getDocumentVariable } from "@/features/hr/integration/document-variables";

/** Assinatura do cliente autenticado compartilhado (`useAuthenticatedApi`). */
export type EditorRequest = <T = unknown>(input: RequestInfo | URL, init?: AuthenticatedApiRequestInit) => Promise<T>;

export type EditorDocumentView = {
  id: string;
  title: string;
  status: string;
  contentVersion: number;
  contentHash: string;
  pdfAvailable: boolean;
};

export type OpenedEditorDocument = { document: EditorDocumentView; content: unknown; version: number };

export type EditorTemplateStatus = "draft" | "published" | "archived";

/** Visão pública do modelo (espelha `EditorTemplateView` do servidor). Modelo não tem titular nem dado de pessoa. */
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
};

export type OpenedEditorTemplate = { template: EditorTemplateView; content: unknown; version: number };
export type EditorTemplatePage = { items: EditorTemplateView[]; nextCursor: string | null };

const BASE = "/api/documents/editor";
const TEMPLATES = `${BASE}/templates`;
const idPath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
const templatePath = (id: string) => `${TEMPLATES}/${encodeURIComponent(id)}`;

export function createBlankEditorDocument(request: EditorRequest, input: { clientRequestId: string; title: string }) {
  return request<{ document: EditorDocumentView }>(BASE, {
    method: "POST",
    json: input,
    fallbackError: "Falha ao criar o documento.",
  });
}

export function openEditorDocument(request: EditorRequest, id: string) {
  return request<OpenedEditorDocument>(idPath(id), { method: "GET", fallbackError: "Falha ao abrir o documento." });
}

export function saveEditorDocument(
  request: EditorRequest,
  id: string,
  input: { expectedContentVersion: number; clientRequestId: string; content: unknown; title: string },
) {
  return request<{ document: EditorDocumentView }>(`${idPath(id)}/content`, {
    method: "PUT",
    json: input,
    fallbackError: "Falha ao salvar o documento.",
  });
}

/** Prévia com valores de exemplo (`sample`): nenhum titular, nenhum dado pessoal. Devolve o PDF. */
export function previewSampleEditorDocument(request: EditorRequest, id: string) {
  return request<Blob>(`${idPath(id)}/preview`, {
    method: "POST",
    json: { mode: "sample" },
    responseType: "blob",
    fallbackError: "Falha ao gerar a prévia.",
  });
}

/** Prévia com dados reais do titular escolhido (`resolved`). O servidor confirma o titular e audita a prévia. */
export function previewResolvedEditorDocument(request: EditorRequest, id: string, subject: { employeeId: string }) {
  return request<Blob>(`${idPath(id)}/preview`, {
    method: "POST",
    json: { mode: "resolved", subject: { employeeId: subject.employeeId } },
    responseType: "blob",
    fallbackError: "Falha ao gerar a prévia com os dados do titular.",
  });
}

export function finalizeEditorDocument(
  request: EditorRequest,
  id: string,
  input: { clientRequestId: string; expectedContentVersion: number; subject?: { employeeId: string } },
) {
  return request<{ document: EditorDocumentView; replayed: boolean }>(`${idPath(id)}/finalize`, {
    method: "POST",
    json: input,
    fallbackError: "Falha ao finalizar o documento.",
  });
}

/** PDF final guardado (só documento `final` com PDF pronto). Devolve o blob; o servidor audita o download. */
export function downloadFinalEditorPdf(request: EditorRequest, id: string) {
  return request<Blob>(`${idPath(id)}/file`, {
    method: "GET",
    responseType: "blob",
    fallbackError: "Falha ao baixar o PDF final.",
  });
}

export function listEditorTemplates(
  request: EditorRequest,
  query: { status?: EditorTemplateStatus; limit?: number; cursor?: string | null } = {},
) {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  const qs = params.toString();
  return request<EditorTemplatePage>(qs ? `${TEMPLATES}?${qs}` : TEMPLATES, {
    method: "GET",
    fallbackError: "Falha ao listar os modelos.",
  });
}

/** Cria um modelo em branco, com conteúdo avulso ou copiando uma versão de um documento do editor. */
export function createEditorTemplate(
  request: EditorRequest,
  input: {
    clientRequestId: string;
    name: string;
    description?: string;
    content?: unknown;
    fromDocument?: { documentId: string; version: number };
  },
) {
  return request<{ template: EditorTemplateView }>(TEMPLATES, {
    method: "POST",
    json: input,
    fallbackError: "Falha ao criar o modelo.",
  });
}

export function openEditorTemplate(request: EditorRequest, id: string) {
  return request<OpenedEditorTemplate>(templatePath(id), { method: "GET", fallbackError: "Falha ao abrir o modelo." });
}

export function saveEditorTemplate(
  request: EditorRequest,
  id: string,
  input: { expectedVersion: number; clientRequestId: string; content: unknown; name?: string },
) {
  return request<{ template: EditorTemplateView }>(`${templatePath(id)}/content`, {
    method: "PUT",
    json: input,
    fallbackError: "Falha ao salvar o modelo.",
  });
}

/** Prévia de exemplo da versão corrente do modelo (valores de amostra, sem titular). Devolve o PDF. */
export function previewEditorTemplate(request: EditorRequest, id: string) {
  return request<Blob>(`${templatePath(id)}/preview`, {
    method: "POST",
    responseType: "blob",
    fallbackError: "Falha ao gerar a prévia do modelo.",
  });
}

export function publishEditorTemplate(request: EditorRequest, id: string, input: { clientRequestId: string; expectedVersion: number }) {
  return request<{ template: EditorTemplateView }>(`${templatePath(id)}/publish`, {
    method: "POST",
    json: input,
    fallbackError: "Falha ao publicar o modelo.",
  });
}

export function archiveEditorTemplate(request: EditorRequest, id: string, input: { clientRequestId: string; expectedVersion: number }) {
  return request<{ template: EditorTemplateView }>(`${templatePath(id)}/archive`, {
    method: "POST",
    json: input,
    fallbackError: "Falha ao arquivar o modelo.",
  });
}

/** Cria um rascunho (sem titular) a partir da versão publicada; `expectedPublishedVersion` é a versão que o usuário viu. */
export function createDocumentFromTemplate(
  request: EditorRequest,
  id: string,
  input: { clientRequestId: string; expectedPublishedVersion?: number },
) {
  return request<{ document: EditorDocumentView }>(`${templatePath(id)}/use`, {
    method: "POST",
    json: input,
    fallbackError: "Falha ao criar o documento a partir do modelo.",
  });
}

export type EditorFailure = {
  code: string | null;
  status: number | null;
  /** Texto público escolhido pela interface; a mensagem bruta do servidor nunca é exibida. */
  message: string;
  currentVersion: number | null;
  /** Versão publicada atual informada pelo servidor em `EDITOR_TEMPLATE_PUBLISHED_VERSION_CHANGED`. */
  publishedVersion: number | null;
  missingLabels: string[];
};

const MESSAGES: Record<string, string> = {
  EDITOR_VERSION_CONFLICT: "Outra sessão alterou este documento. Seu texto continua aqui, sem perdas.",
  EDITOR_PDF_UNAVAILABLE: "A geração de PDF está indisponível no momento. O rascunho continua salvo; tente novamente mais tarde.",
  EDITOR_PDF_BUSY: "Há muitas conversões em andamento. Aguarde alguns instantes e tente novamente.",
  EDITOR_PDF_INPUT_REJECTED: "O documento não pôde ser convertido em PDF. Reduza o tamanho ou simplifique o conteúdo.",
  EDITOR_RATE_LIMITED: "Muitas solicitações em pouco tempo. Aguarde um instante e tente novamente.",
  EDITOR_CONTENT_INVALID: "O conteúdo contém uma estrutura que o editor não aceita ou excede o tamanho permitido.",
  EDITOR_INPUT_INVALID: "Os dados enviados são inválidos. Revise o título e o conteúdo.",
  EDITOR_DOCUMENT_NOT_FOUND: "Documento não encontrado.",
  EDITOR_DOCUMENT_FORBIDDEN: "Você não tem permissão para esta operação neste documento.",
  EDITOR_DOCUMENT_NOT_DRAFT: "O documento já foi finalizado e não pode mais ser alterado.",
  EDITOR_SUBJECT_REQUIRED: "Documento com campos do sistema precisa de um titular.",
  EDITOR_SUBJECT_UNCONFIRMED: "Não foi possível confirmar o titular do documento.",
  EDITOR_SENSITIVE_FIELD_FORBIDDEN: "Você não tem permissão para usar campos de dados sensíveis.",
  EDITOR_MISSING_FIELDS: "Há campos sem valor no cadastro do titular.",
  EDITOR_STORAGE_UNAVAILABLE: "O armazenamento do PDF está indisponível no momento. Nada foi perdido; tente novamente em instantes.",
  EDITOR_DOCUMENT_NOT_FINAL: "O documento ainda não foi finalizado, por isso não há PDF final para baixar.",
  EDITOR_PDF_NOT_AVAILABLE: "O PDF final deste documento não está disponível.",
  EDITOR_REQUEST_ID_REUSED: "Esta solicitação já foi usada com outro conteúdo. Tente novamente.",
  EDITOR_TEMPLATE_FORBIDDEN: "Você não tem permissão para esta operação no modelo.",
  EDITOR_TEMPLATE_NOT_FOUND: "Modelo não encontrado.",
  EDITOR_TEMPLATE_INPUT_INVALID: "Os dados do modelo são inválidos. Revise o nome e a descrição.",
  EDITOR_TEMPLATE_CONTENT_INVALID:
    "O conteúdo do modelo está vazio, contém uma estrutura que o editor não aceita ou excede o tamanho permitido.",
  EDITOR_TEMPLATE_ARCHIVED: "O modelo está arquivado: não pode mais ser alterado, publicado nem usado.",
  EDITOR_TEMPLATE_NOT_PUBLISHED: "O modelo ainda não foi publicado. Peça a quem revisa documentos para publicá-lo antes de usar.",
  EDITOR_TEMPLATE_REQUEST_ID_REUSED: "Esta solicitação já foi usada com outro conteúdo. Tente novamente.",
  EDITOR_TEMPLATE_VERSION_CONFLICT: "Outra sessão alterou este modelo. Seu texto continua aqui, sem perdas.",
  EDITOR_TEMPLATE_PUBLISHED_VERSION_CHANGED:
    "A versão publicada deste modelo mudou desde que você abriu a lista. A lista foi atualizada; confira e tente novamente.",
};

function messageForStatus(status: number | null): string {
  if (status === 401) return "Sessão expirada. Entre novamente.";
  if (status === 403) return "Você não tem permissão para esta operação.";
  if (status === 404) return "Documento não encontrado.";
  if (status === 429) return MESSAGES.EDITOR_RATE_LIMITED!;
  if (status === 413) return "O conteúdo é grande demais para ser enviado.";
  return "Não foi possível concluir a operação. Tente novamente.";
}

/** Normaliza qualquer falha em texto público. Nunca repassa `error.message` nem o corpo do servidor. */
export function toEditorFailure(error: unknown): EditorFailure {
  if (error instanceof AuthenticatedApiError) {
    const payload = error.payload && typeof error.payload === "object" ? (error.payload as Record<string, unknown>) : {};
    const nested = payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : {};
    const code = typeof nested.code === "string" ? nested.code : null;
    const currentVersion = typeof payload.currentVersion === "number" ? payload.currentVersion : null;
    const publishedVersion = typeof payload.publishedVersion === "number" ? payload.publishedVersion : null;
    const missingKeys = Array.isArray(payload.missingKeys) ? payload.missingKeys.filter((key): key is string => typeof key === "string") : [];
    return {
      code,
      status: error.status,
      message: (code && MESSAGES[code]) || messageForStatus(error.status),
      currentVersion,
      publishedVersion,
      missingLabels: missingKeys.map((key) => getDocumentVariable(key)?.label ?? "Campo desconhecido"),
    };
  }
  return {
    code: null,
    status: null,
    message: "Não foi possível falar com o servidor. Verifique a conexão e tente novamente.",
    currentVersion: null,
    publishedVersion: null,
    missingLabels: [],
  };
}
