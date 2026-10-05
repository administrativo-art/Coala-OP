import { createHash } from "node:crypto";

import { folderNameKey } from "./media-folders";

export type LegacyMediaDoc = {
  id: string;
  workspaceId: string;
  /** Texto do campo `folder` antigo; ausente equivale a "Uploads". */
  folder: unknown;
  hasFolderId: boolean;
};

export type MediaFolderMigrationPlan = {
  folders: Array<{ id: string; workspaceId: string; name: string }>;
  assignments: Array<{ mediaId: string; folderId: string }>;
  alreadyMigrated: number;
};

export function legacyFolderName(value: unknown) {
  const text = typeof value === "string" ? value : "";
  const cleaned = text.normalize("NFC").replace(/[/\\\u0000-\u001f]+/g, " ").trim().slice(0, 80).trim();
  return cleaned || "Uploads";
}

/** UUID determinístico: repetir a migração gera sempre a mesma pasta para o mesmo nome. */
export function legacyFolderId(workspaceId: string, name: string) {
  const bytes = createHash("sha1").update(`instagram-media-folder|${workspaceId}|${folderNameKey(name)}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function planMediaFolderMigration(docs: readonly LegacyMediaDoc[]): MediaFolderMigrationPlan {
  const folders = new Map<string, { id: string; workspaceId: string; name: string }>();
  const assignments: MediaFolderMigrationPlan["assignments"] = [];
  let alreadyMigrated = 0;
  for (const doc of docs) {
    if (doc.hasFolderId) {
      alreadyMigrated += 1;
      continue;
    }
    const name = legacyFolderName(doc.folder);
    const id = legacyFolderId(doc.workspaceId, name);
    if (!folders.has(id)) folders.set(id, { id, workspaceId: doc.workspaceId, name });
    assignments.push({ mediaId: doc.id, folderId: id });
  }
  return { folders: [...folders.values()], assignments, alreadyMigrated };
}
