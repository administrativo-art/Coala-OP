import assert from "node:assert/strict";
import { test } from "node:test";
import { archivePreviewable, archiveTimestamp, sortArchiveEntries } from "../../src/lib/documents/archive-entry-sort";

test("Acervo ordena datas e bytes reais; pastas primeiro e valores ausentes por último", () => {
  const entries = [
    { id: "a", name: "Aditivo", kind: "file" as const, modifiedAt: 20, sizeBytes: 2048 },
    { id: "z", name: "Contrato", kind: "file" as const, modifiedAt: 10, sizeBytes: 512 },
    { id: "missing", name: "Sem data", kind: "file" as const },
    { id: "folder", name: "Pasta", kind: "folder" as const },
  ];
  const ids = (sort: Parameters<typeof sortArchiveEntries>[1]) => sortArchiveEntries(entries, sort).map(entry => entry.id);
  assert.deepEqual(ids("title-asc"), ["folder", "a", "z", "missing"]);
  assert.deepEqual(ids("title-desc"), ["folder", "missing", "z", "a"]);
  assert.deepEqual(ids("modified-asc"), ["folder", "z", "a", "missing"]);
  assert.deepEqual(ids("modified-desc"), ["folder", "a", "z", "missing"]);
  assert.deepEqual(ids("size-asc"), ["folder", "z", "a", "missing"]);
  assert.deepEqual(ids("size-desc"), ["folder", "a", "z", "missing"]);
  assert.equal(archiveTimestamp("2026-11-03T12:00:00.000Z"), Date.parse("2026-11-03T12:00:00.000Z"));
  assert.equal(archiveTimestamp("sem data"), null);
  assert.equal(archivePreviewable("application/pdf"), true);
  assert.equal(archivePreviewable("application/zip"), false);
});
