import type { StatusPillVariant } from "@/components/ui/status-pill";

import type { EditorDocumentListItem, EditorDocumentListStatus, EditorFailure } from "./editor-client";

/**
 * Regras puras da listagem "Documentos do editor". São só orientação de tela: o servidor reaplica
 * permissão e escopo (quem só gera vê os próprios; revisor vê os do workspace). Separada de
 * `template-logic.ts` porque trata de outra coleção (documentos), com filtros e itens próprios.
 */

export type DocumentListFilter = "all" | EditorDocumentListStatus;

export const DOCUMENT_LIST_FILTERS: ReadonlyArray<{ value: DocumentListFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "draft", label: "Rascunhos" },
  { value: "final", label: "Finalizados" },
];

export const DEFAULT_DOCUMENT_FILTER: DocumentListFilter = "all";
export const DOCUMENT_LIST_PAGE_SIZE = 25;

/** Parâmetro `status` da consulta; "Todos" não envia filtro. */
export function documentStatusParam(filter: DocumentListFilter): EditorDocumentListStatus | undefined {
  return filter === "all" ? undefined : filter;
}

export const DOCUMENT_EMPTY_TEXT: Record<DocumentListFilter, string> = {
  all: "Nenhum documento do editor ainda. Crie um documento em branco ou use um modelo publicado.",
  draft: "Nenhum documento em rascunho.",
  final: "Nenhum documento finalizado.",
};

export function documentStatusLabel(status: string): string {
  return status === "final" ? "Finalizado" : status === "draft" ? "Rascunho" : "Situação desconhecida";
}

export function documentStatusVariant(status: string): StatusPillVariant {
  return status === "final" ? "ok" : status === "draft" ? "info" : "neutral";
}

/** Origem legível; registro sem origem (anterior ao campo) não inventa uma. */
export function documentOriginLabel(origin: EditorDocumentListItem["origin"]): string {
  if (!origin) return "Origem não informada";
  return origin.kind === "editor_template" ? "Do modelo" : "Em branco";
}

export function documentVersionLabel(item: Pick<EditorDocumentListItem, "contentVersion">): string {
  return `Versão ${item.contentVersion}`;
}

/** Acrescenta uma página sem repetir documentos (a lista pode ter mudado entre as páginas). */
export function appendDocumentPage(current: readonly EditorDocumentListItem[], page: readonly EditorDocumentListItem[]): EditorDocumentListItem[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.filter((item) => !seen.has(item.id))];
}

export type DocumentListFailure = { kind: "forbidden" | "error"; message: string };

/** 401/403 viram "sem permissão"/sessão; o texto é sempre público, nunca a mensagem do servidor. */
export function describeDocumentListFailure(failure: Pick<EditorFailure, "status" | "code" | "message">): DocumentListFailure {
  if (failure.status === 403 || failure.code === "EDITOR_DOCUMENT_FORBIDDEN") {
    return { kind: "forbidden", message: "Você não tem permissão para ver os documentos do editor." };
  }
  if (failure.status === 404) return { kind: "error", message: "Não foi possível encontrar a listagem de documentos." };
  return { kind: "error", message: failure.message };
}
