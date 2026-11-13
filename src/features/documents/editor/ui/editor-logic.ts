import { getDocumentVariable, type DocumentVariableCatalogEntry } from "@/features/hr/integration/document-variables";

/** Forma mínima do JSON do Tiptap usada pelas regras da interface (a validação real é do servidor). */
export type EditorJsonNode = {
  type?: string;
  text?: string;
  attrs?: { key?: unknown } & Record<string, unknown>;
  content?: EditorJsonNode[];
};

/** Chaves de campos do sistema usadas no documento, sem repetição e em ordem estável. */
export function collectFieldKeys(node: EditorJsonNode | null | undefined): string[] {
  const keys = new Set<string>();
  const walk = (current: EditorJsonNode | undefined) => {
    if (!current) return;
    if (current.type === "documentField" && typeof current.attrs?.key === "string") keys.add(current.attrs.key);
    current.content?.forEach(walk);
  };
  walk(node ?? undefined);
  return [...keys].sort();
}

/** "Tem conteúdo": algum texto não vazio ou algum campo do sistema. Parágrafos vazios não contam. */
export function hasMeaningfulContent(node: EditorJsonNode | null | undefined): boolean {
  if (!node) return false;
  if (node.type === "documentField") return true;
  if (node.type === "text" && typeof node.text === "string" && node.text.trim().length > 0) return true;
  return (node.content ?? []).some(hasMeaningfulContent);
}

export function sensitiveFieldKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => getDocumentVariable(key)?.sensitive === true);
}

export type FinalizeGateInput = {
  status: string;
  canReview: boolean;
  hasContent: boolean;
  fieldKeys: readonly string[];
  conflict: boolean;
  /** Titular escolhido na etapa "Preencher e finalizar" (só estado da tela). */
  subjectEmployeeId?: string | null;
  /** A última prévia com dados reais deste titular e desta versão apontou campos sem valor. */
  subjectHasMissingFields?: boolean;
};

/** Motivo que impede abrir a etapa "Preencher e finalizar" (ou finalizar direto, sem campos), ou `null`. */
export function getFinalizeBaseBlockReason(input: FinalizeGateInput): string | null {
  if (input.status !== "draft") return "O documento já foi finalizado.";
  if (!input.canReview) return "Finalizar exige a permissão de revisão de documentos.";
  if (input.conflict) return "Resolva o conflito de versão antes de finalizar.";
  if (!input.hasContent) return "Escreva algum conteúdo antes de finalizar.";
  return null;
}

/**
 * Motivo pelo qual "Finalizar documento" está bloqueado, ou `null`. É só orientação: o servidor
 * reaplica todas as regras (permissão, titular, versão). Sem campos do sistema finaliza como avulso;
 * com campos exige o titular escolhido e, se a prévia real já apontou campos sem valor, bloqueia.
 */
export function getFinalizeBlockReason(input: FinalizeGateInput): string | null {
  const base = getFinalizeBaseBlockReason(input);
  if (base) return base;
  if (input.fieldKeys.length > 0) {
    if (!input.subjectEmployeeId) return "Escolha o titular para preencher os campos do documento.";
    if (input.subjectHasMissingFields) {
      return "A prévia apontou campos sem valor no cadastro deste titular. Complete o cadastro ou escolha outro titular.";
    }
  }
  return null;
}

export type SubjectOption = { id: string; username: string };

/** Titulares filtrados por nome (sem acento, sem diferenciar caixa), em ordem alfabética pt-BR. */
export function filterSubjectOptions<T extends SubjectOption>(users: readonly T[], query: string): T[] {
  const term = normalize(query.trim());
  const sorted = [...users].sort((a, b) => a.username.localeCompare(b.username, "pt-BR"));
  return term ? sorted.filter((user) => normalize(user.username).includes(term)) : sorted;
}

/** O identificador da tentativa de finalizar muda com a versão do texto e com o titular. */
export function finalizeAttemptKey(version: number, employeeId: string | null): string {
  return `${version}:${employeeId ?? ""}`;
}

/** Texto público de uma falha da prévia/finalização com dados reais; lista os rótulos dos campos sem valor. */
export function describeResolvedPreviewFailure(failure: { code: string | null; missingLabels: string[]; message: string }): string {
  if (failure.code === "EDITOR_MISSING_FIELDS") {
    return failure.missingLabels.length > 0
      ? `${failure.message} Campos sem valor: ${failure.missingLabels.join(", ")}.`
      : failure.message;
  }
  return failure.message;
}

export type FieldSection = { section: string; items: DocumentVariableCatalogEntry[] };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/** Agrupa o catálogo por `section` (ordem de aparição) filtrando por rótulo ou seção. */
export function groupVariablesBySection(
  variables: readonly DocumentVariableCatalogEntry[],
  query: string,
): FieldSection[] {
  const term = normalize(query.trim());
  const sections = new Map<string, DocumentVariableCatalogEntry[]>();
  for (const variable of variables) {
    if (term && !normalize(`${variable.label} ${variable.section}`).includes(term)) continue;
    const list = sections.get(variable.section) ?? [];
    list.push(variable);
    sections.set(variable.section, list);
  }
  return [...sections.entries()].map(([section, items]) => ({ section, items }));
}

export type SaveState = "saved" | "saving" | "dirty" | "error" | "conflict";

export const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: "Salvo",
  saving: "Salvando…",
  dirty: "Alterações não salvas",
  error: "Falha ao salvar",
  conflict: "Conflito de versão",
};

/** Autosave: intervalo mínimo de inatividade antes de salvar sozinho (decisão: ≥ 30 s). */
export const AUTOSAVE_DELAY_MS = 30_000;

export function shouldAutosave(input: { status: string; saveState: SaveState; conflict: boolean; canEdit: boolean }) {
  return input.canEdit && input.status === "draft" && !input.conflict && input.saveState === "dirty";
}

/**
 * Bloqueio de edição: enquanto a prévia ou a finalização estão em andamento o texto não pode mudar
 * (o que fosse digitado durante a chamada seria descartado ao virar somente leitura). A edição só
 * volta se a operação falhar, porque `busy` volta a ser falso e o status segue `draft`.
 */
export function isEditorLocked(input: { status: string; contentError: boolean; previewBusy: boolean; finalizing: boolean }) {
  return input.status !== "draft" || input.contentError || input.previewBusy || input.finalizing;
}

/** Nome do arquivo baixado: ASCII seguro derivado do título (o servidor aplica regra equivalente no cabeçalho). */
export function buildPdfFileName(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "documento"}.pdf`;
}
