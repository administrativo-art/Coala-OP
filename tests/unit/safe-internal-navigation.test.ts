import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveSafeReturnPath, safeInternalPath } from "../../src/lib/safe-return-path";

test("safeInternalPath accepts only canonical same-origin paths", () => {
  assert.equal(safeInternalPath(" /dashboard/tasks?scope=mine#today "), "/dashboard/tasks?scope=mine#today");
  assert.equal(safeInternalPath("https://evil.example/path"), null);
  assert.equal(safeInternalPath("javascript:alert(1)"), null);
  assert.equal(safeInternalPath("data:text/html,bad"), null);
  assert.equal(safeInternalPath("//evil.example/path"), null);
  assert.equal(safeInternalPath("/\\evil.example/path"), null);
  assert.equal(safeInternalPath("/%5c%5cevil.example/path"), null);
  assert.equal(safeInternalPath("/%2f%2fevil.example/path"), null);
  assert.equal(safeInternalPath("/dashboard\n/hidden"), null);
  assert.equal(safeInternalPath(`/${"x".repeat(2_048)}`), null);
});

test("resolveSafeReturnPath applies an explicit local fallback", () => {
  assert.equal(resolveSafeReturnPath("/dashboard/stock", "/dashboard"), "/dashboard/stock");
  assert.equal(resolveSafeReturnPath("https://evil.example", "/dashboard/tasks"), "/dashboard/tasks");
  assert.equal(resolveSafeReturnPath(null), "/dashboard");
});

test("client-controlled return and task-link sinks use the shared sanitizer", async () => {
  const sources = await Promise.all([
    readFile("src/features/financial/components/expenses/expense-form.tsx", "utf8"),
    readFile("src/app/dashboard/stock/reposition/page.tsx", "utf8"),
    readFile("src/components/navigation/back-button.tsx", "utf8"),
    readFile("src/components/reposition-management.tsx", "utf8"),
    readFile("src/components/task-list.tsx", "utf8"),
    readFile("src/components/task-detail-modal.tsx", "utf8"),
    readFile("src/features/tasks/lib/server.ts", "utf8"),
  ]);
  for (const source of sources) assert.match(source, /safeInternalPath|resolveSafeReturnPath/);
});

