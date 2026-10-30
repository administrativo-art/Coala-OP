export type AssetCollectionCursor = { at: string; id: string };
export type AssetHistoryRow = { id: string; at: string; type: string; source: string; description: string };

export function mergeHistoryPages(
  pages: Array<{ source: string; rows: AssetHistoryRow[] }>,
  limit: number,
  prior: Record<string, AssetCollectionCursor> = {},
) {
  const items = pages.flatMap(({ rows }) => rows)
    .sort((left, right) => right.at.localeCompare(left.at) || right.source.localeCompare(left.source) || right.id.localeCompare(left.id))
    .slice(0, limit);
  const sources = { ...prior };
  for (const item of items) sources[item.source] = { at: item.at, id: item.id };
  const emittedBySource = new Map<string, number>();
  for (const item of items) emittedBySource.set(item.source, (emittedBySource.get(item.source) ?? 0) + 1);
  const hasMore = pages.some(({ source, rows }) => rows.length > (emittedBySource.get(source) ?? 0));
  return { items, sources, hasMore };
}
