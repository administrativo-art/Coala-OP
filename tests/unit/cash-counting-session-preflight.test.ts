import assert from "node:assert/strict";
import test from "node:test";

import { analyzeCashCountingSessionPreflight } from "../../src/features/financial/cash-counting-sessions/preflight";

test("preflight bloqueia rollout com sessão duplicada, lock ausente ou lock conflitante", () => {
  const result = analyzeCashCountingSessionPreflight({
    workspaceId: "workspace-1",
    openSessions: [
      { id: "session-a", status: "open", kioskIds: ["unit-1"], scopeAggregationVersion: 1 },
      { id: "session-b", status: "open", kioskIds: ["unit-1", "unit-2"], scopeAggregationVersion: 1 },
    ],
    referencedSessions: [
      { id: "session-closed", status: "completed", kioskIds: ["unit-1"] },
    ],
    locks: [
      { id: "workspace-1:unit:unit-1", sessionId: "session-closed", kioskId: "unit-1", lockKind: "unit" },
    ],
    truncated: false,
  });

  assert.equal(result.blocking, true);
  assert.equal(result.duplicateOpenUnits.length, 1);
  assert.equal(result.missingGlobalLocks.length, 3);
  assert.equal(result.conflictingGlobalLocks.length, 1);
  assert.equal(result.staleLocks[0]?.reason, "closed_session");
});

test("preflight libera modelo novo consistente e sinaliza legado separadamente", () => {
  const consistent = analyzeCashCountingSessionPreflight({
    workspaceId: "workspace-1",
    openSessions: [{ id: "session-a", status: "open", kioskIds: ["unit-1"], scopeAggregationVersion: 1 }],
    referencedSessions: [{ id: "session-a", status: "open", kioskIds: ["unit-1"], scopeAggregationVersion: 1 }],
    locks: [{ id: "workspace-1:unit:unit-1", sessionId: "session-a", kioskId: "unit-1", lockKind: "unit" }],
    truncated: false,
  });
  assert.equal(consistent.blocking, false);
  assert.deepEqual(consistent.legacyOpenSessions, []);

  const legacy = analyzeCashCountingSessionPreflight({
    workspaceId: "workspace-1",
    openSessions: [{ id: "session-legacy", status: "open", kioskIds: ["unit-1"] }],
    referencedSessions: [{ id: "session-legacy", status: "open", kioskIds: ["unit-1"] }],
    locks: [{ id: "workspace-1:unit:unit-1", sessionId: "session-legacy", kioskId: "unit-1", lockKind: "unit" }],
    truncated: false,
  });
  assert.equal(legacy.blocking, false);
  assert.deepEqual(legacy.legacyOpenSessions, ["session-legacy"]);
});
