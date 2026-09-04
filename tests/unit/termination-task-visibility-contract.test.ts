import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tarefas de desligamento ficam restritas ao responsável e observadores", async () => {
  const source = await readFile(new URL("../../src/features/hr/termination/server.ts", import.meta.url), "utf8");
  const createHrTask = source.slice(
    source.indexOf("async function createHrTask"),
    source.indexOf("async function closeFutureFinancialProvisions"),
  );

  assert.match(createHrTask, /visibilityScope:\s*["']assignee_and_watchers["']/u);
  assert.doesNotMatch(createHrTask, /visibilityScope:\s*["']project["']/u);
});
