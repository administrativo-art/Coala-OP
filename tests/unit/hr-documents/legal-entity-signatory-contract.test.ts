import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [repositorySource, snapshotSource] = await Promise.all([
  readFile(
    new URL("../../../src/lib/company/internal-company-repository.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../../src/features/hr/documents/legal-entity-snapshot.server.ts", import.meta.url),
    "utf8",
  ),
]);

test("resolve filial pela raiz do CNPJ sem perder CNPJ, endereço e nome fantasia da unidade", () => {
  assert.match(repositorySource, /async findByCnpjRoot/);
  assert.match(repositorySource, /where\('cnpjRoot', '==', root\)/);
  assert.match(repositorySource, /\.limit\(10\)/);
  assert.match(snapshotSource, /exactEntity \?\? await repository\.findByCnpjRoot\(cnpj\)/);
  assert.match(snapshotSource, /fallbackTradeName/);
  assert.match(snapshotSource, /exactEntity \? company\.cnpj \|\| cnpj : cnpj/);
  assert.match(snapshotSource, /exactEntity \? joinedAddress\(company\) \|\| fallback\.address : fallback\.address/);
});
