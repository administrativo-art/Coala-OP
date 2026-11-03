export type TitleSortDirection = "asc" | "desc";

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Default for lists identified by a title/name; preserves the input and tied rows. */
export function sortByTitle<T>(items: readonly T[], title: (item: T) => string, direction: TitleSortDirection = "asc"): T[] {
  return items.map((item, index) => ({ item, index })).sort((a, b) =>
    (direction === "asc" ? 1 : -1) * collator.compare(title(a.item).trim(), title(b.item).trim()) || a.index - b.index,
  ).map(({ item }) => item);
}
