import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptPaths = [
  "../../scripts/migrate-cash-closure-permissions.mts",
  "../../scripts/migrate-cash-deposit-inter-fields.mts",
];

test("migrações de caixa paginam leituras e interrompem acima do teto", async () => {
  for (const path of scriptPaths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /\.orderBy\(FieldPath\.documentId\(\)\)\s*\.limit\(requestLimit\)/);
    assert.match(source, /\.startAfter\(lastId\)/);
    assert.match(source, /maxDocs \+ 1/);
    assert.match(source, /excedeu o limite/);
    assert.match(source, /Number\.isSafeInteger\(maxDocs\)/);
  }
});

test("migração de permissões divide escritas abaixo do limite do batch", async () => {
  const source = await readFile(new URL(scriptPaths[0], import.meta.url), "utf8");
  assert.match(source, /index \+= 400/);
  assert.match(source, /changes\.slice\(index, index \+ 400\)/);
});

test("validação operacional executa módulos server-only no contexto correto", async () => {
  const packageSource = await readFile(new URL("../../package.json", import.meta.url), "utf8");
  const packageJson = JSON.parse(packageSource) as { scripts?: Record<string, string> };
  assert.match(packageJson.scripts?.["validate:cash-closure"] ?? "", /--conditions=react-server/);
});
