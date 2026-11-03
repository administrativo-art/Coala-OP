export type ArchiveSort = "title-asc" | "title-desc" | "modified-asc" | "modified-desc" | "size-asc" | "size-desc";

type SortableEntry = { id: string; name: string; kind: "folder" | "file" | "model"; modifiedAt?: number | null; sizeBytes?: number | null };

export function archiveTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function archivePreviewable(mime?: string | null): boolean {
  return Boolean(mime && (mime.toLowerCase().includes("pdf") || mime.toLowerCase().startsWith("image/")));
}

export function sortArchiveEntries<T extends SortableEntry>(entries: T[], sort: ArchiveSort): T[] {
  const [field, direction] = sort.split("-") as ["title" | "modified" | "size", "asc" | "desc"];
  const sign = direction === "asc" ? 1 : -1;
  return [...entries].sort((left, right) => {
    if ((left.kind === "folder") !== (right.kind === "folder")) return left.kind === "folder" ? -1 : 1;
    if (field !== "title") {
      const a = field === "modified" ? left.modifiedAt : left.sizeBytes;
      const b = field === "modified" ? right.modifiedAt : right.sizeBytes;
      const hasA = typeof a === "number" && Number.isFinite(a);
      const hasB = typeof b === "number" && Number.isFinite(b);
      if (hasA !== hasB) return hasA ? -1 : 1;
      if (hasA && hasB && a !== b) return (a! - b!) * sign;
    }
    const title = left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base", numeric: true });
    return title ? title * (field === "title" ? sign : 1) : left.id.localeCompare(right.id);
  });
}
