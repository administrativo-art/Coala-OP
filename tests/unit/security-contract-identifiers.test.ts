import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// Mesmo formato exigido por `defineSecurityContract`; identificador fora dele só estoura no build,
// quando o Next carrega a rota para coletar os dados da página.
const IDENTIFIER = /^[a-z][a-z0-9.-]{2,119}$/;

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /^route\.tsx?$/.test(entry.name) ? [full] : [];
  }));
  return nested.flat();
}

test("contratos de segurança: ação e estratégia em minúsculas, no formato aceito no build", async () => {
  const invalid: string[] = [];
  for (const file of await routeFiles("src/app/api")) {
    const source = await readFile(file, "utf8");
    if (!source.includes("defineSecurityContract(")) continue;
    for (const match of source.matchAll(/kind: ["'](?:permission|custom)["'], (?:action|strategy): ["']([^"']+)["']/g)) {
      if (!IDENTIFIER.test(match[1]!)) invalid.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(invalid, []);
});
