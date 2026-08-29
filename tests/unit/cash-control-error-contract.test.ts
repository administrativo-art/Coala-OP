import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const routeRoots = [
  "src/app/api/financial/cash-closures",
  "src/app/api/financial/cash-counting-sessions",
  "src/app/api/financial/cash-deposits",
  "src/app/api/jobs/cash-closures",
];

async function routeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return routeFiles(target);
    return entry.name === "route.ts" ? [target] : [];
  }));
  return nested.flat();
}

test("rotas da contagem e do depósito usam envelope seguro sem mensagem interna", async () => {
  const files = (await Promise.all(routeRoots.map(routeFiles))).flat();
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /NextResponse\.json\(\{\s*error\s*:/, file);
    assert.doesNotMatch(source, /safeMessage\s*:\s*(?:message|error\.message|cause\.message)/, file);
  }
});
