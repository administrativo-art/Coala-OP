import type { Source } from "./person-inventory";

/**
 * Fontes em subcoleção são lidas por collection group. Nomes como `audit` e `versions`
 * podem existir em outros módulos, então todo resultado só é aceito se o caminho for
 * exatamente `<parentCollection>/{id}/<collection>/{id}` na raiz do banco.
 */
export function isPersonSourceGroup(source: Source): source is Source & { parentCollection: string } {
  return typeof source.parentCollection === "string" && source.parentCollection.length > 0;
}

type RefLike = { id: string; path: string; parent: { id: string; parent: RefLike | null } | null };

/** Referência do documento pai quando o caminho pertence à fonte; caso contrário, null. */
export function ownedGroupParent<T extends RefLike>(source: Source, ref: RefLike & { parent: { id: string; parent: T | null } | null }): T | null {
  if (!isPersonSourceGroup(source)) return null;
  const subcollection = ref.parent;
  const parent = subcollection?.parent ?? null;
  const root = (parent?.parent ?? null) as ({ id: string; parent: unknown } | null);
  if (!subcollection || subcollection.id !== source.collection || !parent || !root) return null;
  if (root.id !== source.parentCollection || root.parent !== null) return null;
  return parent;
}

/** Posição de continuação de collection group: caminho completo, sem "/" para o cursor genérico. */
export function encodeGroupPosition(path: string) { return `g1.${Buffer.from(path, "utf8").toString("base64url")}`; }
export function decodeGroupPosition(source: Source, position: string): string | null {
  if (!isPersonSourceGroup(source) || !position.startsWith("g1.")) return null;
  const path = Buffer.from(position.slice(3), "base64url").toString("utf8");
  const parts = path.split("/");
  // Opaque server-side resume point: it may be an intruder or nested row read earlier (the exposure filter is
  // ownedGroupParent, unchanged). Any document path whose collection segment is the source subcollection is valid.
  return parts.length >= 4 && parts.length % 2 === 0 && parts.every(Boolean) && parts[parts.length - 2] === source.collection ? path : null;
}
