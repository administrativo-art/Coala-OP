import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentDraftLoad,
  isCurrentDraftRevision,
  persistLatestDraft,
  type RevisionedDraft,
} from "../../src/features/financial/cash-closures/latest-draft-save";

test("persistLatestDraft discards a stale response and persists the newest edit", async () => {
  let current: RevisionedDraft<number> | null = { revision: 0, value: 100 };
  const persisted: number[] = [];
  const committed: number[] = [];

  const didCommit = await persistLatestDraft({
    read: () => current,
    persist: async (value) => {
      persisted.push(value);
      if (value === 100) current = { revision: 1, value: 250 };
      return value;
    },
    commit: (value) => committed.push(value),
  });

  assert.equal(didCommit, true);
  assert.deepEqual(persisted, [100, 250]);
  assert.deepEqual(committed, [250]);
});

test("persistLatestDraft does not commit when the editor is no longer available", async () => {
  let current: RevisionedDraft<number> | null = { revision: 0, value: 100 };
  let committed = false;

  const didCommit = await persistLatestDraft({
    read: () => current,
    persist: async (value) => {
      current = null;
      return value;
    },
    commit: () => {
      committed = true;
    },
  });

  assert.equal(didCommit, false);
  assert.equal(committed, false);
});

test("isCurrentDraftRevision rejects remote snapshots started before a local edit", () => {
  assert.equal(isCurrentDraftRevision(4, 4), true);
  assert.equal(isCurrentDraftRevision(4, 5), false);
});

test("isCurrentDraftLoad rejeita resposta de outra data ou requisição anterior", () => {
  const current = { id: 8, targetKey: "unit-1:2035-09-12" };
  assert.equal(isCurrentDraftLoad({ id: 8, targetKey: "unit-1:2035-09-12" }, current), true);
  assert.equal(isCurrentDraftLoad({ id: 7, targetKey: "unit-1:2035-09-12" }, current), false);
  assert.equal(isCurrentDraftLoad({ id: 8, targetKey: "unit-1:2035-09-11" }, current), false);
  assert.equal(isCurrentDraftLoad({ id: 8, targetKey: "unit-2:2035-09-12" }, current), false);
});
