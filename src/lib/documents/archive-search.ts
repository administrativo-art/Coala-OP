/**
 * Busca por termos do Acervo: sem diferença de acento ou maiúscula, cada termo
 * precisa aparecer em algum campo (ordem livre) e "aspas" mantêm uma frase junta.
 * Ex.: `atestado agosto` acha "13/08/2026 — Atestado" na pasta Afastamentos › 2026 › Agosto.
 */
export function normalizeArchiveText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

export function parseArchiveSearch(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = normalizeArchiveText(match[1] ?? match[2] ?? "");
    if (term) terms.push(term);
  }
  return [...new Set(terms)];
}

export function matchesArchiveSearch(terms: readonly string[], fields: ReadonlyArray<string | null | undefined>): boolean {
  if (!terms.length) return true;
  const haystack = normalizeArchiveText(fields.filter(Boolean).join(" \u0001 "));
  return terms.every((term) => haystack.includes(term));
}

/** Caminho legível para mostrar onde um resultado está. */
export function archiveLocationLabel(path: readonly string[]): string {
  return path.join(" › ");
}

/** Pastas (caminhos completos) cujo nome bate com todos os termos, sem repetir o mesmo caminho. */
export function matchingArchiveFolders(paths: ReadonlyArray<readonly string[]>, terms: readonly string[]): string[][] {
  if (!terms.length) return [];
  const found = new Map<string, string[]>();
  for (const path of paths) {
    for (let length = 1; length <= path.length; length++) {
      const folder = path.slice(0, length);
      const key = JSON.stringify(folder);
      if (found.has(key)) continue;
      // O nome da pasta precisa bater com pelo menos um termo e o caminho todo com todos.
      if (terms.some((term) => normalizeArchiveText(folder[folder.length - 1]).includes(term)) && matchesArchiveSearch(terms, folder)) found.set(key, folder);
    }
  }
  return [...found.values()].sort((left, right) => left.join("/").localeCompare(right.join("/"), "pt-BR"));
}
