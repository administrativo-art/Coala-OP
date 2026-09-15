import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeStoneMappingCodes, stoneMappingsOverlap } from "../../src/features/financial/stone-integration/types";

test("normaliza Stonecodes e terminais sem duplicação", () => {
  assert.deepEqual(normalizeStoneMappingCodes([" sc-2 ", "SC-1", "sc-2"]), ["SC-1", "SC-2"]);
});

test("impede sobreposição ativa por Stonecode e escopo de terminal", () => {
  const global = { status: "active" as const, stoneCodes: ["SC-1"], terminalIds: [] };
  const terminal = { status: "active" as const, stoneCodes: ["sc-1"], terminalIds: ["POS-1"] };
  const anotherTerminal = { status: "active" as const, stoneCodes: ["SC-1"], terminalIds: ["POS-2"] };
  const inactive = { ...global, status: "inactive" as const };

  assert.equal(stoneMappingsOverlap(global, terminal), true);
  assert.equal(stoneMappingsOverlap(terminal, anotherTerminal), false);
  assert.equal(stoneMappingsOverlap(global, inactive), false);
});

test("administração Stone é server-only, paginada, auditada e não recebe segredo bruto", async () => {
  const [service, listRoute, updateRoute, schema, page, indexes] = await Promise.all([
    readFile(new URL("../../src/features/financial/stone-integration/service.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/api/financial/stone-integration/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/app/api/financial/stone-integration/[mappingId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/financial/stone-integration/schemas.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/financial/stone-integration/components/stone-integration-page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../firestore.financial.indexes.json", import.meta.url), "utf8"),
  ]);

  assert.match(service, /MAX_MAPPINGS = 100/);
  assert.match(service, /\.limit\(input\.limit \+ 1\)/);
  assert.match(service, /collection\("events"\)/);
  assert.match(service, /stoneMappingsOverlap/);
  assert.match(listRoute, /stoneIntegration\?\.manage/);
  assert.match(updateRoute, /stoneIntegration\?\.manage/);
  assert.match(listRoute, /unitAccess\.allUnits/);
  assert.match(schema, /secretReference/);
  assert.doesNotMatch(schema, /password|clientSecret|accessToken|apiKey/);
  assert.match(page, /Execuções da integração/);
  assert.match(indexes, /"collectionGroup": "stoneIngestionRuns"/);
});
