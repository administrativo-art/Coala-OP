/**
 * Modos de visualização do Acervo (decisão do DEV de 05/11/2026, docs/design/decisoes/0007-modos-do-acervo.md).
 * Lógica pura: escolha do modo salvo, pilha de colunas do modo cascata e agrupamento da ficha do colaborador.
 */

export const ARCHIVE_VIEW_MODES = ["panel", "classic", "cascade"] as const;
export type ArchiveViewMode = (typeof ARCHIVE_VIEW_MODES)[number];
export const DEFAULT_ARCHIVE_VIEW_MODE: ArchiveViewMode = "panel";
export const ARCHIVE_VIEW_MODE_STORAGE_KEY = "coala.acervo.modo";
export const ARCHIVE_VIEW_MODE_LABELS: Record<ArchiveViewMode, string> = {
  panel: "Painel lateral",
  classic: "Clássico",
  cascade: "Cascata",
};

export function parseArchiveViewMode(value: unknown): ArchiveViewMode {
  return typeof value === "string" && (ARCHIVE_VIEW_MODES as readonly string[]).includes(value)
    ? (value as ArchiveViewMode)
    : DEFAULT_ARCHIVE_VIEW_MODE;
}

/** Uma coluna do modo cascata: as entradas de uma pasta já visitada e a pasta aberta a partir dela. */
export type CascadeColumn<E> = { scope: string; entries: E[]; activeId: string };

/**
 * Atualiza a pilha de colunas quando a pasta exibida muda.
 * - Abrir uma pasta da coluna atual empilha a coluna atual (com a pasta aberta marcada).
 * - Abrir uma pasta de uma coluna anterior corta a pilha naquela coluna e a marca de novo.
 * - Voltar para uma pasta que já está na pilha corta a pilha até ela.
 * - Qualquer outro salto (link direto, trilha, busca) recomeça a cascata na pasta atual.
 */
export function nextCascadeStack<E>(
  stack: CascadeColumn<E>[],
  change:
    | { type: "open-from-current"; scope: string; entries: E[]; activeId: string; nextScope: string }
    | { type: "open-from-column"; columnIndex: number; activeId: string; nextScope: string }
    | { type: "arrived"; scope: string },
): CascadeColumn<E>[] {
  if (change.type === "open-from-current") {
    if (change.scope === change.nextScope) return stack;
    return [...stack.filter((column) => column.scope !== change.scope), { scope: change.scope, entries: change.entries, activeId: change.activeId }];
  }
  if (change.type === "open-from-column") {
    const column = stack[change.columnIndex];
    if (!column) return [];
    return [...stack.slice(0, change.columnIndex), { ...column, activeId: change.activeId }];
  }
  const index = stack.findIndex((column) => column.scope === change.scope);
  return index >= 0 ? stack.slice(0, index) : stack;
}

/** Pasta de primeiro nível (aba) e subpasta (chip) de um documento na ficha do colaborador. */
export type FichaPlacement = { tab: string; group: string | null; rest: string[] };

export function fichaPlacement(path: readonly string[]): FichaPlacement {
  const [tab = "Outros documentos", group = null, ...rest] = path;
  return { tab, group, rest };
}

export type FichaTab = { name: string; count: number };

/** Abas da ficha em ordem alfabética (pt-BR, números naturais), com a quantidade de documentos de cada uma. */
export function fichaTabs(paths: readonly (readonly string[])[]): FichaTab[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const { tab } = fichaPlacement(path);
    counts.set(tab, (counts.get(tab) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base", numeric: true }));
}

/** Subpastas (chips) de uma aba, em ordem decrescente: anos e períodos mais recentes primeiro. */
export function fichaGroups(paths: readonly (readonly string[])[], tab: string): FichaTab[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const placement = fichaPlacement(path);
    if (placement.tab !== tab || !placement.group) continue;
    counts.set(placement.group, (counts.get(placement.group) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.name.localeCompare(left.name, "pt-BR", { sensitivity: "base", numeric: true }));
}

/** Escolhe a aba aberta: a pedida (se existir) ou a primeira. */
export function resolveFichaTab(tabs: readonly FichaTab[], requested: string | null | undefined): string | null {
  if (requested && tabs.some((tab) => tab.name === requested)) return requested;
  return tabs[0]?.name ?? null;
}

/** Ícone neutro pelo tipo, deduzido do MIME ou da extensão do nome. */
export type ArchiveFileKind = "pdf" | "image" | "sheet" | "text" | "other";

export function archiveFileKind(name: string, mime?: string | null): ArchiveFileKind {
  const type = (mime ?? "").toLowerCase();
  const extension = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? "";
  if (type.includes("pdf") || extension === "pdf") return "pdf";
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(extension)) return "image";
  if (type.includes("sheet") || type.includes("excel") || ["xls", "xlsx", "csv", "ods"].includes(extension)) return "sheet";
  if (type.includes("word") || type.startsWith("text/") || ["doc", "docx", "txt", "odt", "rtf"].includes(extension)) return "text";
  return "other";
}
