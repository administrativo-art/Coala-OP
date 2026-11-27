export type AssetCollectionCursor = { at: string; id: string };

export type AssetHistoryMaintenance = {
  status: string | null;
  assigneeLabel: string | null;
  registeredByLabel: string | null;
  completedByLabel?: string | null;
  performedOn: string | null;
  completedAt: string | null;
  dueDate: string | null;
  result: string | null;
  components: string[];
  order: { documentId: string; protocol: string | null; href: string } | null;
};

export type AssetHistoryRow = {
  id: string;
  at: string;
  type: string;
  source: string;
  description: string;
  maintenance?: AssetHistoryMaintenance;
};

type HistoryPageRow = AssetHistoryRow & { hidden?: boolean };
type HistoryPage = { source: string; rows: HistoryPageRow[]; hasMore?: boolean };

function newestFirst(left: HistoryPageRow, right: HistoryPageRow) {
  return right.at.localeCompare(left.at) || right.source.localeCompare(left.source)
    || (right.id > left.id ? 1 : right.id < left.id ? -1 : 0);
}

export function mergeHistoryPages(
  pages: HistoryPage[],
  limit: number,
  prior: Record<string, AssetCollectionCursor> = {},
) {
  const sorted = pages.flatMap(({ rows }) => rows).sort(newestFirst);
  // A fonte truncada pode ter eventos mais recentes que o fim das outras fontes.
  const frontier = pages.flatMap(({ rows, hasMore }) => hasMore && rows.length ? [rows[rows.length - 1]] : [])
    .sort(newestFirst)[0];
  const items: AssetHistoryRow[] = [];
  const sources = { ...prior };
  let consumed = 0;
  for (const row of sorted) {
    if (frontier && newestFirst(row, frontier) > 0) break;
    const { hidden, ...item } = row;
    if (!hidden && items.length >= limit) break;
    sources[item.source] = { at: item.at, id: item.id };
    consumed += 1;
    if (!hidden) items.push(item);
  }
  return { items, sources, hasMore: consumed < sorted.length || pages.some((page) => page.hasMore) };
}
