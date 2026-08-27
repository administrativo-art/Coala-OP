import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACTIVE_TASK_LIMIT,
  ACTIVE_TASK_STATUSES,
  TASK_HISTORY_LIMIT,
  resolveTaskBootstrapPolicy,
  taskBootstrapScopeForPathname,
} from "../../src/features/tasks/lib/query-policy";

test("usa escopo ativo fora da central e histórico limitado dentro dela", () => {
  assert.equal(taskBootstrapScopeForPathname("/dashboard"), "active");
  assert.equal(taskBootstrapScopeForPathname("/dashboard/tasks"), "history");
  assert.equal(taskBootstrapScopeForPathname("/dashboard/operations"), "history");

  assert.deepEqual(resolveTaskBootstrapPolicy("active"), {
    scope: "active",
    limit: ACTIVE_TASK_LIMIT,
    statuses: ACTIVE_TASK_STATUSES,
  });
  assert.deepEqual(resolveTaskBootstrapPolicy("history"), {
    scope: "history",
    limit: TASK_HISTORY_LIMIT,
    statuses: undefined,
  });
});

test("protege contra a volta do polling completo e de escritas no GET de tarefas", async () => {
  const providerSource = await readFile(
    new URL("../../src/components/task-provider.tsx", import.meta.url),
    "utf8"
  );
  const routeSource = await readFile(
    new URL("../../src/app/api/tasks/route.ts", import.meta.url),
    "utf8"
  );
  const serverSource = await readFile(
    new URL("../../src/features/tasks/lib/server.ts", import.meta.url),
    "utf8"
  );
  const getHandler = routeSource.slice(
    routeSource.indexOf("export async function GET"),
    routeSource.indexOf("export async function POST")
  );

  assert.doesNotMatch(providerSource, /setInterval\s*\(/);
  assert.doesNotMatch(getHandler, /ensureDefaultTaskProject/);
  assert.match(getHandler, /resolveTaskBootstrapPolicy/);
  assert.match(serverSource, /options\.limit \?\? 100/);
  assert.match(serverSource, /query = query\.limit\(limit\)/);
});
