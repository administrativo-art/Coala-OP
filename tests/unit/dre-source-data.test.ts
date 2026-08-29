import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { chunkDreSimulationIds, summarizeDreSalesReports } from "../../src/features/financial/dre/source-data";
import type { SalesReport } from "../../src/types";

test("divide referências de simulação sem corte arbitrário", () => {
  const ids = Array.from({ length: 2_001 }, (_, index) => `simulation-${index}`);
  const chunks = chunkDreSimulationIds(ids, 200);
  assert.equal(chunks.length, 11);
  assert.equal(chunks.flat().length, 2_001);
  assert.equal(new Set(chunks.flat()).size, 2_001);
});

test("agrega receita e CMV por unidade e competência e informa ficha ausente", () => {
  const reports: SalesReport[] = [{
    id: "sales-1",
    year: 2026,
    month: 8,
    day: 1,
    kioskId: "kiosk-1",
    createdAt: "2026-08-01T12:00:00.000Z",
    items: [
      { sku: "A", productName: "Produto A", simulationId: "simulation-a", quantity: 2, unitPrice: 10 },
      { sku: "B", productName: "Produto B", simulationId: "simulation-missing", quantity: 1, unitPrice: 5 },
    ],
  }];
  const result = summarizeDreSalesReports(reports, new Map([["simulation-a", 3]]));
  assert.deepEqual(result.salesSummaries, [{ kioskId: "kiosk-1", year: 2026, month: 8, revenue: 25, cmv: 6 }]);
  assert.deepEqual(result.missingSimulationIds, ["simulation-missing"]);
});

test("mantém a fonte da DRE filtrada, paginada e sem leitura direta no cliente", async () => {
  const serverSource = await readFile(
    new URL("../../src/features/financial/dre/source-data.server.ts", import.meta.url),
    "utf8",
  );
  const pageSource = await readFile(
    new URL("../../src/features/financial/pages/dre-page.tsx", import.meta.url),
    "utf8",
  );
  const indexes = JSON.parse(await readFile(
    new URL("../../firestore.indexes.json", import.meta.url),
    "utf8",
  )) as {
    indexes: Array<{
      collectionGroup: string;
      fields: Array<{ fieldPath: string }>;
    }>;
  };

  assert.match(serverSource, /\.where\("kioskId", "in", kioskIds\)/);
  assert.match(serverSource, /\.limit\(Math\.min\(SALES_PAGE_SIZE, remaining\)\)/);
  assert.match(serverSource, /MAX_REPORTS_PER_PERIOD/);
  assert.doesNotMatch(pageSource, /\b(?:getDocs|onSnapshot)\s*\(/);
  assert.ok(indexes.indexes.some((index) => (
    index.collectionGroup === "salesReports"
    && ["year", "month", "kioskId", "__name__"].every((field) => (
      index.fields.some((candidate) => candidate.fieldPath === field)
    ))
  )));
});
