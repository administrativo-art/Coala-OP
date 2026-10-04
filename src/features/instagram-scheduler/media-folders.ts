import type { InstagramMediaFolder } from "./contracts";

/** Profundidade da pasta na raiz é 1; subpasta direta é 2. */
export const INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH = 10;
export const INSTAGRAM_MEDIA_FOLDER_MAX_COUNT = 500;
export const INSTAGRAM_MEDIA_MOVE_MAX_ITEMS = 50;

export type InstagramMediaFolderPolicyError =
  | "FOLDER_NOT_FOUND"
  | "PARENT_NOT_FOUND"
  | "MOVE_INTO_ITSELF"
  | "MAX_DEPTH"
  | "DUPLICATE_NAME"
  | "MAX_COUNT";

export function folderNameKey(name: string) {
  return name.normalize("NFC").trim().toLocaleLowerCase("pt-BR");
}

function byId(folders: readonly InstagramMediaFolder[]) {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

/** Quantidade de níveis da raiz até a pasta (inclusive). `null` quando a cadeia está quebrada ou cíclica. */
export function folderDepth(folders: readonly InstagramMediaFolder[], id: string | null): number | null {
  if (id === null) return 0;
  const index = byId(folders);
  let depth = 0;
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const folder = index.get(cursor);
    if (!folder) return null;
    depth += 1;
    cursor = folder.parentId;
  }
  return depth;
}

/** Altura do galho: 1 para uma pasta sem filhas. */
export function folderSubtreeHeight(folders: readonly InstagramMediaFolder[], id: string): number {
  const children = new Map<string | null, InstagramMediaFolder[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const visit = (current: string, seen: Set<string>): number => {
    if (seen.has(current)) return 0;
    seen.add(current);
    const below = (children.get(current) ?? []).map((child) => visit(child.id, seen));
    return 1 + (below.length ? Math.max(...below) : 0);
  };
  return visit(id, new Set());
}

export function isFolderDescendant(
  folders: readonly InstagramMediaFolder[],
  ancestorId: string,
  candidateId: string | null,
) {
  const index = byId(folders);
  const seen = new Set<string>();
  let cursor = candidateId;
  while (cursor !== null) {
    if (cursor === ancestorId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    cursor = index.get(cursor)?.parentId ?? null;
  }
  return false;
}

export function hasSiblingWithName(
  folders: readonly InstagramMediaFolder[],
  parentId: string | null,
  name: string,
  ignoreId?: string,
) {
  const key = folderNameKey(name);
  return folders.some(
    (folder) => folder.parentId === parentId && folder.id !== ignoreId && folderNameKey(folder.name) === key,
  );
}

export function checkCreateFolder(
  folders: readonly InstagramMediaFolder[],
  input: { name: string; parentId: string | null },
): InstagramMediaFolderPolicyError | null {
  if (folders.length >= INSTAGRAM_MEDIA_FOLDER_MAX_COUNT) return "MAX_COUNT";
  const parentDepth = folderDepth(folders, input.parentId);
  if (parentDepth === null) return "PARENT_NOT_FOUND";
  if (parentDepth + 1 > INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH) return "MAX_DEPTH";
  if (hasSiblingWithName(folders, input.parentId, input.name)) return "DUPLICATE_NAME";
  return null;
}

export function checkRenameOrMoveFolder(
  folders: readonly InstagramMediaFolder[],
  input: { id: string; name: string; parentId: string | null },
): InstagramMediaFolderPolicyError | null {
  if (!folders.some((folder) => folder.id === input.id)) return "FOLDER_NOT_FOUND";
  if (input.parentId === input.id || isFolderDescendant(folders, input.id, input.parentId)) {
    return "MOVE_INTO_ITSELF";
  }
  const parentDepth = folderDepth(folders, input.parentId);
  if (parentDepth === null) return "PARENT_NOT_FOUND";
  if (parentDepth + folderSubtreeHeight(folders, input.id) > INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH) {
    return "MAX_DEPTH";
  }
  if (hasSiblingWithName(folders, input.parentId, input.name, input.id)) return "DUPLICATE_NAME";
  return null;
}

/** Nome livre entre irmãs: "Fotos", "Fotos (2)", "Fotos (3)"… */
export function uniqueFolderName(
  folders: readonly InstagramMediaFolder[],
  parentId: string | null,
  name: string,
  ignoreId?: string,
) {
  if (!hasSiblingWithName(folders, parentId, name, ignoreId)) return name;
  for (let attempt = 2; attempt < 1_000; attempt += 1) {
    const suffix = ` (${attempt})`;
    const candidate = `${name.slice(0, 80 - suffix.length)}${suffix}`;
    if (!hasSiblingWithName(folders, parentId, candidate, ignoreId)) return candidate;
  }
  return `${name.slice(0, 60)} (${Date.now()})`;
}

export type InstagramMediaFolderNode = InstagramMediaFolder & {
  depth: number;
  children: InstagramMediaFolderNode[];
};

export function buildFolderTree(folders: readonly InstagramMediaFolder[]): InstagramMediaFolderNode[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const children = new Map<string | null, InstagramMediaFolder[]>();
  for (const folder of folders) {
    // Pasta com pai inexistente aparece na raiz em vez de sumir.
    const parent = folder.parentId !== null && ids.has(folder.parentId) ? folder.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(folder);
    children.set(parent, list);
  }
  const build = (parent: string | null, depth: number, seen: Set<string>): InstagramMediaFolderNode[] =>
    (children.get(parent) ?? [])
      .filter((folder) => !seen.has(folder.id))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }))
      .map((folder) => {
        const nextSeen = new Set(seen).add(folder.id);
        return { ...folder, depth, children: build(folder.id, depth + 1, nextSeen) };
      });
  return build(null, 1, new Set());
}

export function folderPath(folders: readonly InstagramMediaFolder[], id: string | null): InstagramMediaFolder[] {
  const index = byId(folders);
  const path: InstagramMediaFolder[] = [];
  const seen = new Set<string>();
  let cursor = id;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const folder = index.get(cursor);
    if (!folder) break;
    path.unshift(folder);
    cursor = folder.parentId;
  }
  return path;
}

export const instagramMediaFolderErrorMessages: Record<InstagramMediaFolderPolicyError, string> = {
  FOLDER_NOT_FOUND: "Pasta não encontrada.",
  PARENT_NOT_FOUND: "A pasta de destino não existe mais.",
  MOVE_INTO_ITSELF: "Não é possível mover uma pasta para dentro dela mesma.",
  MAX_DEPTH: `As pastas aceitam até ${INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH} níveis.`,
  DUPLICATE_NAME: "Já existe uma pasta com esse nome neste local.",
  MAX_COUNT: `O limite é de ${INSTAGRAM_MEDIA_FOLDER_MAX_COUNT} pastas.`,
};
