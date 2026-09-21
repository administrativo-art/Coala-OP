// Teste de integração contra o emulador do Firestore.
// Rodar com o emulador ativo: FIRESTORE_EMULATOR_HOST=localhost:8080 node --test src/stock-min-recalc.test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { runMinimumStockRecalculation } from "./stock-min-recalc.js";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "Este teste só roda contra o emulador do Firestore. Defina FIRESTORE_EMULATOR_HOST (ex.: localhost:8080) antes de executar.",
  );
}

if (getApps().length === 0) {
  initializeApp({ projectId: "demo-coala-min-stock-test" });
}

const db: Firestore = getFirestore("coala");

// 01/09/2026 03:00 — a mesma data usada pelo cron (dia 1 do mês). Os 6 meses completos
// anteriores são: mar, abr, mai, jun, jul, ago/2026.
const NOW = new Date(Date.UTC(2026, 8, 1, 3, 0, 0));

function consumptionReportId(kioskId: string, year: number, month: number, day: number): string {
  return `cons_sync_${kioskId}_${year}_${String(month).padStart(2, "0")}_${String(day).padStart(2, "0")}`;
}

async function seedConsumptionReport(
  kioskId: string,
  year: number,
  month: number,
  day: number,
  results: Array<{ baseProductId: string; productName: string; consumedQuantity: number }>,
) {
  const id = consumptionReportId(kioskId, year, month, day);
  await db.collection("consumptionReports").doc(id).set({
    reportName: `Teste ${id}`,
    month,
    year,
    day,
    kioskId,
    status: "completed",
    results: results.map((r) => ({ ...r, productId: r.baseProductId })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

test("consumptionReports: calcula média mensal + 30% para item em kg, ignora quiosque com override", async () => {
  const baseProductId = `test-kg-${randomUUID()}`;
  const kioskA = "kiosk-a";
  const kioskB = "kiosk-b-override";

  // 10kg/mês em kioskA por 6 meses (mar a ago/2026) => média 10 => ideal 10*1.3 = 13.00
  const months = [3, 4, 5, 6, 7, 8];
  for (const month of months) {
    await seedConsumptionReport(kioskA, 2026, month, 10, [
      { baseProductId, productName: "TESTE KG", consumedQuantity: 10 },
    ]);
  }
  // kioskB também tem consumo, mas está com override:true — não deve ser tocado
  await seedConsumptionReport(kioskB, 2026, 6, 10, [
    { baseProductId, productName: "TESTE KG", consumedQuantity: 999 },
  ]);

  await db.collection("baseProducts").doc(baseProductId).set({
    name: "TESTE KG",
    unit: "kg",
    category: "Massa",
    stockLevels: {
      [kioskA]: { override: false },
      [kioskB]: { override: true, min: 42 },
    },
  });

  const summary = await runMinimumStockRecalculation(db, NOW);
  assert.ok(summary.updated >= 1, "esperava pelo menos 1 atualização");

  const after = await db.collection("baseProducts").doc(baseProductId).get();
  const data = after.data()!;
  assert.equal(data.stockLevels[kioskA].min, 13, "kioskA deveria ter min = média(10) * 1.30 = 13");
  assert.ok(data.stockLevels[kioskA].lastAutoCalculatedAt, "deveria registrar lastAutoCalculatedAt");
  assert.equal(data.stockLevels[kioskA].lastAutoCalculatedMean, 10, "mean registrado deveria ser 10");
  assert.equal(data.stockLevels[kioskB].min, 42, "kioskB com override não deveria ser alterado");
});

test("consumptionReports: arredonda para cima itens em unidade (un)", async () => {
  const baseProductId = `test-un-${randomUUID()}`;
  const kioskA = "kiosk-un-a";

  // 7 unidades/mês por 6 meses => média 7 => ideal bruto 7*1.3 = 9.1 => arredonda para 10
  for (const month of [3, 4, 5, 6, 7, 8]) {
    await seedConsumptionReport(kioskA, 2026, month, 10, [
      { baseProductId, productName: "TESTE UN", consumedQuantity: 7 },
    ]);
  }

  await db.collection("baseProducts").doc(baseProductId).set({
    name: "TESTE UN",
    unit: "un",
    category: "Unidade",
    stockLevels: { [kioskA]: { override: false } },
  });

  await runMinimumStockRecalculation(db, NOW);

  const after = await db.collection("baseProducts").doc(baseProductId).get();
  const data = after.data()!;
  assert.equal(data.stockLevels[kioskA].min, 10, "7*1.3=9.1 deveria arredondar para cima (10) por ser unidade");
});

test("movementHistory (SAIDA_CONSUMO): usado como fallback quando o insumo não aparece em consumptionReports", async () => {
  const baseProductId = `test-fallback-${randomUUID()}`;
  const skuProductId = `sku-${randomUUID()}`;
  const kioskA = "kiosk-fallback-a";

  // mapeia o SKU específico (products) para o baseProduct
  await db.collection("products").doc(skuProductId).set({ baseProductId, name: "Detergente Teste 1un" });

  // 4un/mês por 6 meses via SAIDA_CONSUMO => média 4 => ideal 4*1.3 = 5.2 => arredonda para 6 (un)
  for (const month of [3, 4, 5, 6, 7, 8]) {
    await db.collection("movementHistory").add({
      productId: skuProductId,
      productName: "Detergente Teste 1un",
      type: "SAIDA_CONSUMO",
      fromKioskId: kioskA,
      quantityChange: 4,
      timestamp: new Date(Date.UTC(2026, month - 1, 10)),
      notes: "Ajuste de contagem:",
    });
  }

  await db.collection("baseProducts").doc(baseProductId).set({
    name: "DETERGENTE TESTE",
    unit: "un",
    category: "Unidade",
    stockLevels: { [kioskA]: { override: false } },
  });

  await runMinimumStockRecalculation(db, NOW);

  const after = await db.collection("baseProducts").doc(baseProductId).get();
  const data = after.data()!;
  assert.equal(data.stockLevels[kioskA].min, 6, "4*1.3=5.2 deveria arredondar para cima (6) via fallback do movementHistory");
});

test("insumo arquivado é ignorado", async () => {
  const baseProductId = `test-archived-${randomUUID()}`;
  const kioskA = "kiosk-archived-a";

  await seedConsumptionReport(kioskA, 2026, 6, 10, [
    { baseProductId, productName: "TESTE ARQUIVADO", consumedQuantity: 999 },
  ]);

  await db.collection("baseProducts").doc(baseProductId).set({
    name: "TESTE ARQUIVADO",
    unit: "kg",
    category: "Massa",
    isArchived: true,
    stockLevels: { [kioskA]: { override: false, min: 1 } },
  });

  await runMinimumStockRecalculation(db, NOW);

  const after = await db.collection("baseProducts").doc(baseProductId).get();
  assert.equal(after.data()!.stockLevels[kioskA].min, 1, "insumo arquivado não deveria ser recalculado");
});

after(async () => {
  // Fecha a conexão do SDK admin para o node --test encerrar sozinho, sem handles pendurados.
  await Promise.all(getApps().map((app) => deleteApp(app)));
});
