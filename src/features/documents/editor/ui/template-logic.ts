import type { EditorFailure, EditorTemplateStatus, EditorTemplateView } from "./editor-client";
import type { StatusPillVariant } from "@/components/ui/status-pill";

/**
 * Regras puras da interface dos modelos do editor. São só orientação de tela: o servidor reaplica
 * permissão, versão, status e conteúdo. Modelo não tem titular nem dado de pessoa.
 */

export type EditorSurfaceKind = "document" | "template";

export const TEMPLATE_STATUS_LABEL: Record<EditorTemplateStatus, string> = {
  draft: "Rascunho",
  published: "Publicado",
  archived: "Arquivado",
};

export const TEMPLATE_STATUS_VARIANT: Record<EditorTemplateStatus, StatusPillVariant> = {
  draft: "info",
  published: "ok",
  archived: "neutral",
};

export const TEMPLATE_STATUS_FILTERS: ReadonlyArray<{ value: EditorTemplateStatus; label: string }> = [
  { value: "published", label: "Publicados" },
  { value: "draft", label: "Rascunhos" },
  { value: "archived", label: "Arquivados" },
];

/** Filtro inicial da lista: o que pode ser usado agora. Arquivados ficam separados (docs/design/listas.md). */
export const DEFAULT_TEMPLATE_FILTER: EditorTemplateStatus = "published";

export const TEMPLATE_LIST_PAGE_SIZE = 25;

/** Aviso obrigatório antes de transformar um documento em modelo. */
export const SAVE_AS_TEMPLATE_NOTICE =
  "O texto será copiado para o modelo e ficará visível a todos que podem gerar documentos. Revise: modelos não devem ter nomes, CPFs ou outros dados de pessoas.";

export const BLANK_TEMPLATE_NAME = "Modelo sem nome";

/** Para o gate de edição/autosave, "rascunho" significa editável: documento em rascunho ou modelo não arquivado. */
export function editableStatusFor(kind: EditorSurfaceKind, status: string): string {
  if (kind === "document") return status;
  return status === "archived" ? "archived" : "draft";
}

export function isVersionConflictCode(code: string | null): boolean {
  return code === "EDITOR_VERSION_CONFLICT" || code === "EDITOR_TEMPLATE_VERSION_CONFLICT";
}

/** Há versão corrente ainda não publicada (modelo publicado antes e salvo depois, ou nunca publicado). */
export function hasUnpublishedChanges(template: Pick<EditorTemplateView, "status" | "currentVersion" | "publishedVersion">): boolean {
  return template.status !== "archived" && template.publishedVersion !== template.currentVersion;
}

/** Motivo que impede "Usar modelo" na lista, ou `null`. */
export function getUseTemplateBlockReason(
  template: Pick<EditorTemplateView, "status" | "publishedVersion">,
  canGenerate: boolean,
): string | null {
  if (!canGenerate) return "Usar um modelo exige a permissão de gerar documentos.";
  if (template.status === "archived") return "Modelo arquivado não pode ser usado.";
  if (template.status !== "published" || template.publishedVersion === null) return "Publique o modelo antes de usá-lo.";
  return null;
}

/** Motivo que impede publicar uma versão aberta no editor de modelo, ou `null`. */
export function getPublishBlockReason(input: {
  status: string;
  canReview: boolean;
  hasContent: boolean;
  conflict: boolean;
  /** A versão corrente já é a publicada e não há alteração pendente. */
  alreadyPublished: boolean;
}): string | null {
  if (input.status === "archived") return "O modelo está arquivado e não pode ser publicado.";
  if (!input.canReview) return "Publicar exige a permissão de revisão de documentos.";
  if (input.conflict) return "Resolva o conflito de versão antes de publicar.";
  if (!input.hasContent) return "Escreva algum conteúdo antes de publicar.";
  if (input.alreadyPublished) return "A versão atual já está publicada.";
  return null;
}

export function getArchiveBlockReason(input: { status: string; canReview: boolean }): string | null {
  if (input.status === "archived") return "O modelo já está arquivado.";
  if (!input.canReview) return "Arquivar exige a permissão de revisão de documentos.";
  return null;
}

export function getPublishListBlockReason(template: Pick<EditorTemplateView, "status" | "currentVersion" | "publishedVersion">, canReview: boolean): string | null {
  if (template.status === "archived") return "O modelo está arquivado e não pode ser publicado.";
  if (!canReview) return "Publicar exige a permissão de revisão de documentos.";
  if (template.status === "published" && template.publishedVersion === template.currentVersion) return "A versão atual já está publicada.";
  return null;
}

/** Motivo que impede confirmar "Salvar como modelo" a partir de um documento em edição, ou `null`. */
export function getSaveAsTemplateBlockReason(input: {
  status: string;
  hasContent: boolean;
  conflict: boolean;
  name: string;
  acknowledged: boolean;
}): string | null {
  if (input.status !== "draft") return "Só um rascunho pode virar modelo.";
  if (input.conflict) return "Resolva o conflito de versão antes de criar o modelo.";
  if (!input.hasContent) return "Escreva algum conteúdo antes de salvar como modelo.";
  if (input.name.trim().length === 0) return "Informe o nome do modelo.";
  if (!input.acknowledged) return "Confirme que revisou o texto e que ele não contém dados de pessoas.";
  return null;
}

export type AttemptRegistry = {
  /** Identificador estável da tentativa: a mesma chave devolve o mesmo id até `clear`. */
  idFor: (key: string) => string;
  clear: (key: string) => void;
};

/**
 * Registro de identificadores de tentativa (`clientRequestId`). A chave deve embutir tudo que muda o
 * pedido (id do modelo, versão, nome...): repetir a mesma tentativa reaproveita o id e a rota
 * responde de forma idempotente; um pedido diferente recebe outro id e nunca colide com o anterior.
 */
export function createAttemptRegistry(makeId: () => string): AttemptRegistry {
  const ids = new Map<string, string>();
  return {
    idFor(key) {
      let id = ids.get(key);
      if (!id) {
        id = makeId();
        ids.set(key, id);
      }
      return id;
    },
    clear(key) {
      ids.delete(key);
    },
  };
}

export const templateUseAttemptKey = (templateId: string, publishedVersion: number | null) => `use:${templateId}:${publishedVersion ?? ""}`;
export const templatePublishAttemptKey = (templateId: string, version: number) => `publish:${templateId}:${version}`;
export const templateArchiveAttemptKey = (templateId: string, version: number) => `archive:${templateId}:${version}`;
export const templateCreateAttemptKey = (documentId: string, version: number, name: string, description: string) =>
  `create:${documentId}:${version}:${JSON.stringify([name.trim(), description.trim()])}`;

/** Acrescenta uma página à lista sem repetir modelos (a lista pode ter mudado entre as páginas). */
export function appendTemplatePage(current: readonly EditorTemplateView[], page: readonly EditorTemplateView[]): EditorTemplateView[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.filter((item) => !seen.has(item.id))];
}

/** Substitui um item atualizado pelo servidor; se o status deixou de combinar com o filtro, ele sai da lista. */
export function applyTemplateUpdate(
  current: readonly EditorTemplateView[],
  updated: EditorTemplateView,
  filter: EditorTemplateStatus | null,
): EditorTemplateView[] {
  if (filter !== null && updated.status !== filter) return current.filter((item) => item.id !== updated.id);
  return current.map((item) => (item.id === updated.id ? updated : item));
}

const RELOAD_CODES = new Set([
  "EDITOR_TEMPLATE_PUBLISHED_VERSION_CHANGED",
  "EDITOR_TEMPLATE_ARCHIVED",
  "EDITOR_TEMPLATE_NOT_PUBLISHED",
  "EDITOR_TEMPLATE_NOT_FOUND",
  "EDITOR_TEMPLATE_VERSION_CONFLICT",
]);

/** A falha indica que a lista mostrada está desatualizada e deve ser recarregada. */
export function shouldReloadTemplateList(failure: Pick<EditorFailure, "code">): boolean {
  return failure.code !== null && RELOAD_CODES.has(failure.code);
}

/** Limite da descrição do modelo (o servidor valida 0-1000 e a UI espelha para orientar). */
export const TEMPLATE_DESCRIPTION_MAX = 1000;

export type DescriptionCounter = { text: string; over: boolean; nearLimit: boolean };

/** Contador "N/1000" da descrição; `over` quando excede o limite (o salvamento é bloqueado). */
export function describeDescriptionCounter(value: string, max = TEMPLATE_DESCRIPTION_MAX): DescriptionCounter {
  const length = value.length;
  return { text: `${length}/${max}`, over: length > max, nearLimit: length >= Math.floor(max * 0.9) };
}

/** Motivo que impede salvar nome/descrição do modelo, ou `null`. O servidor reaplica as regras. */
export function getTemplateMetaBlockReason(input: { name: string; description: string }): string | null {
  if (input.name.trim().length === 0) return "Informe o nome do modelo.";
  if (input.description.trim().length > TEMPLATE_DESCRIPTION_MAX) {
    return `A descrição deve ter no máximo ${TEMPLATE_DESCRIPTION_MAX} caracteres.`;
  }
  return null;
}

/** Nome e descrição só mudam em modelo não arquivado e fora de operação em andamento. */
export function isTemplateMetaEditable(input: { status: string; locked: boolean }): boolean {
  return input.status !== "archived" && !input.locked;
}

/**
 * Corpo do PUT /content do modelo. A descrição vai sempre (aparada): vazio limpa, e a UI nunca
 * depende de "omitido mantém". O nome é aparado como no servidor.
 */
export function buildTemplateSaveBody(input: {
  expectedVersion: number;
  clientRequestId: string;
  content: unknown;
  name: string;
  description: string;
}) {
  return {
    expectedVersion: input.expectedVersion,
    clientRequestId: input.clientRequestId,
    content: input.content,
    name: input.name.trim(),
    description: input.description.trim(),
  };
}

/** Chave de reaproveitamento da tentativa: muda com conteúdo, nome, descrição e versão esperada. */
export function templateSaveFingerprint(input: { content: unknown; name: string; description: string; version: number }): string {
  return JSON.stringify({ content: input.content, name: input.name.trim(), description: input.description.trim(), version: input.version });
}

/**
 * A versão que vale depois de salvar é a devolvida pelo servidor: salvar só nome/descrição com o
 * mesmo conteúdo não a incrementa. Nunca some 1 por conta própria.
 */
export function versionAfterTemplateSave(previous: number, saved: Pick<EditorTemplateView, "currentVersion">): { version: number; advanced: boolean } {
  return { version: saved.currentVersion, advanced: saved.currentVersion !== previous };
}

/**
 * Data (e hora) ISO no padrão brasileiro `DD/MM/AAAA, HH:mm`, no fuso local (ou `timeZone`, para
 * teste). `null`, vazio ou inválido viram "—". ISO nunca é exibido.
 */
export function formatEditorDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")}`;
}
