import { normalizeFieldVisibility, type FieldVisibility, type NormalizedFieldVisibility } from "@/types/rh";

/** Ordem de exibição dos níveis, do mais aberto ao mais fechado. */
export const FIELD_VISIBILITY_LEVELS: readonly NormalizedFieldVisibility[] = [
  "public",
  "restricted_partial",
  "restricted_total",
  "confidential",
];

export type VisibilityCounts = Record<NormalizedFieldVisibility, number>;

export type VisibilitySummary = {
  /** Nível comum a todos os campos; `null` quando o bloco é misto ou está vazio. */
  level: NormalizedFieldVisibility | null;
  mixed: boolean;
  total: number;
  counts: VisibilityCounts;
};

/** Mudanças pendentes por chave de campo, sempre com o nível já normalizado. */
export type FieldVisibilityChanges = Record<string, NormalizedFieldVisibility>;

export function emptyVisibilityCounts(): VisibilityCounts {
  return { public: 0, restricted_partial: 0, restricted_total: 0, confidential: 0 };
}

/**
 * O nível de um bloco nunca é gravado: é calculado a partir dos campos. Todos iguais → esse nível;
 * qualquer diferença → misto.
 */
export function summarizeVisibility(levels: Iterable<FieldVisibility | string | null | undefined>): VisibilitySummary {
  const counts = emptyVisibilityCounts();
  let total = 0;
  for (const raw of levels) {
    counts[normalizeFieldVisibility(raw)] += 1;
    total += 1;
  }
  const present = FIELD_VISIBILITY_LEVELS.filter((level) => counts[level] > 0);
  const level = present.length === 1 ? present[0] : null;
  return { level, mixed: present.length > 1, total, counts };
}

/** Chaves de campo cujo nível atual é diferente de `target`: as exceções que "aplicar a todos" sobrescreveria. */
export function keysOverriddenBy(
  entries: ReadonlyArray<{ key: string; visibility: FieldVisibility | string | null | undefined }>,
  target: NormalizedFieldVisibility,
): string[] {
  return entries.filter((entry) => normalizeFieldVisibility(entry.visibility) !== target).map((entry) => entry.key);
}

/** Mantém só o que realmente difere da base carregada do servidor. */
export function diffVisibility(
  base: Record<string, FieldVisibility | string | null | undefined>,
  draft: Record<string, FieldVisibility | string | null | undefined>,
): FieldVisibilityChanges {
  const changes: FieldVisibilityChanges = {};
  for (const [key, raw] of Object.entries(draft)) {
    if (!(key in base)) continue;
    const next = normalizeFieldVisibility(raw);
    if (next !== normalizeFieldVisibility(base[key])) changes[key] = next;
  }
  return changes;
}

type PermissionHolder = {
  isDefaultAdmin?: boolean;
  permissions?: { dp?: { settings?: { manageFieldVisibility?: boolean } } } | null;
};

/**
 * Permissão para decidir quem enxerga cada campo do perfil. Administrador padrão sempre pode;
 * os demais precisam da chave `dp.settings.manageFieldVisibility` no perfil de acesso.
 * Este é o único ponto de decisão: servidor e tela chamam esta função.
 */
export function canConfigureFieldVisibility(holder: PermissionHolder | null | undefined): boolean {
  if (!holder) return false;
  return holder.isDefaultAdmin === true || holder.permissions?.dp?.settings?.manageFieldVisibility === true;
}
