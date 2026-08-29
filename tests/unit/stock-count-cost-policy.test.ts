import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OWN_OPEN_STOCK_COUNT_SESSION_LIMIT,
  STOCK_COUNT_SESSION_PAGE_SIZE,
} from "../../src/features/stock-count/lib/visibility";
import { stockCountSessionListQuerySchema } from "../../src/features/stock-count/session-list";

test("mantém o listener global de contagens filtrado e limitado", async () => {
  const providerSource = await readFile(
    new URL("../../src/components/stock-audit-provider.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(OWN_OPEN_STOCK_COUNT_SESSION_LIMIT, 25);
  assert.match(providerSource, /where\("status", "==", "pending_review"\)/);
  assert.match(providerSource, /where\("auditedBy\.userId", "==", firebaseUser\.uid\)/);
  assert.match(providerSource, /limit\(OWN_OPEN_STOCK_COUNT_SESSION_LIMIT \+ 1\)/);
  assert.doesNotMatch(
    providerSource,
    /query\(collection\(db, ["']stockAuditSessions["']\)\)/,
  );
});

test("carrega histórico somente na tela que o utiliza e por API paginada", async () => {
  const [dashboardSource, repositorySource] = await Promise.all([
    readFile(new URL("../../src/components/audit-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/stock-count/session-list.server.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(STOCK_COUNT_SESSION_PAGE_SIZE, 100);
  assert.match(dashboardSource, /\/api\/stock\/count-sessions/);
  assert.doesNotMatch(dashboardSource, /useStockAudit/);
  assert.match(repositorySource, /\.limit\(params\.pageSize \+ 1\)/);
  assert.match(repositorySource, /where\("kioskId", "in", unitIds\)/);
  assert.match(repositorySource, /where\("startedAt", ">=", params\.fromIso\)/);
});

test("histórico exige período limitado e cursor completo", () => {
  assert.equal(stockCountSessionListQuerySchema.safeParse({
    view: "history",
    from: "2026-08-01",
    to: "2026-08-29",
  }).success, true);
  assert.equal(stockCountSessionListQuerySchema.safeParse({
    view: "history",
    from: "2025-01-01",
    to: "2026-08-29",
  }).success, false);
  assert.equal(stockCountSessionListQuerySchema.safeParse({
    view: "open",
    cursorStartedAt: "2026-08-29T12:00:00.000Z",
  }).success, false);
});
