// Teste de integração contra o emulador do Firestore.
// Rodar com o emulador ativo: FIRESTORE_EMULATOR_HOST=localhost:8080 node --test src/stock-min-recalc.test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Protects the legacy calculation while the new policy is shadowed by default.
import { runMinimumStockRecalculation } from "./legacy-stock-min-recalc.js";
import { assertFirestoreEmulatorSafety } from '../../tests/helpers/firestore-emulator-safety.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "Este teste só roda contra o emulador do Firestore. Defina FIRESTORE_EMULATOR_HOST (ex.: localhost:8080) antes de executar.",
  );
}
assertFirestoreEmulatorSafety({ projectId: 'demo-coala-min-stock-test' });

if (getApps().length === 0) {
  initializeApp({ projectId: "demo-coala-min-stock-test" });
}

const db: Firestore = getFirestore("coala");

// 01/09/2026 03:00 — uma das datas do cron (dias 1 e 16). As 12 quinzenas completas
// anteriores cobrem: mar, abr, mai, jun, jul, ago/2026.
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

async function seedUnit(id: string, data: Record<string, unknown>) {
  await db.collection("dp_units").doc(id).set({ name: id, ...data });
}

test("unidade de abastecimento soma o consumo das unidades comerciais dos grupos atendidos (+30%)", async () => {
  const suffix = randomUUID().slice(0, 8);
  const baseProductId = `test-supply-${suffix}`;
  const groupCd = `group-cd-${suffix}`;
  const groupStores = `group-stores-${suffix}`;
  const cd = `cd-${suffix}`;
  const storeA = `store-a-${suffix}`;
  const storeB = `store-b-${suffix}`;
  const storeArchived = `store-archived-${suffix}`;
  const storeOtherGroup = `store-other-${suffix}`;

  await db.collection("dp_unitGroups").doc(groupCd).set({ name: "CD teste", suppliedGroupIds: [groupStores] });
  await db.collection("dp_unitGroups").doc(groupStores).set({ name: "Quiosques teste" });
  await seedUnit(`u-${cd}`, { externalSource: "kiosk", externalId: cd, groupId: groupCd, stockRole: "supply" });
  await seedUnit(`u-${storeA}`, { externalSource: "kiosk", externalId: storeA, groupId: groupStores });
  await seedUnit(`u-${storeB}`, { externalSource: "kiosk", externalId: storeB, groupId: groupStores, stockRole: "commercial" });
  await seedUnit(`u-${storeArchived}`, { externalSource: "kiosk", externalId: storeArchived, groupId: groupStores, isArchived: true });
  await seedUnit(`u-${storeOtherGroup}`, { externalSource: "kiosk", externalId: storeOtherGroup, groupId: `outro-${suffix}` });

  // A: 10/mês, B: 20/mês, arquivada e outro grupo não contam => CD: 30/mês => 30*1.3 = 39
  for (const month of [3, 4, 5, 6, 7, 8]) {
    await seedConsumptionReport(storeA, 2026, month, 10, [{ baseProductId, productName: "TESTE SUPPLY", consumedQuantity: 10 }]);
    await seedConsumptionReport(storeB, 2026, month, 10, [{ baseProductId, productName: "TESTE SUPPLY", consumedQuantity: 20 }]);
    await seedConsumptionReport(storeArchived, 2026, month, 10, [{ baseProductId, productName: "TESTE SUPPLY", consumedQuantity: 500 }]);
    await seedConsumptionReport(storeOtherGroup, 2026, month, 10, [{ baseProductId, productName: "TESTE SUPPLY", consumedQuantity: 700 }]);
  }

  // o CD nem tem linha no insumo: deve ser criada; storeB não tem linha também
  await db.collection("baseProducts").doc(baseProductId).set({
    name: "TESTE SUPPLY",
    unit: "L",
    category: "Volume",
    stockLevels: { [storeA]: { override: false } },
  });

  await runMinimumStockRecalculation(db, NOW);

  const levels = (await db.collection("baseProducts").doc(baseProductId).get()).data()!.stockLevels;
  assert.equal(levels[storeA].min, 13, "unidade comercial usa o próprio consumo: 10*1.3");
  assert.equal(levels[storeB].min, 26, "quiosque sem linha no cadastro é criado: 20*1.3");
  assert.equal(levels[cd].min, 39, "CD soma A+B (30) e aplica 30%");
  assert.equal(levels[cd].lastAutoCalculatedMean, 30);
  assert.equal(levels[cd].override, false);
});

test("unidade de abastecimento com override mantém o valor manual", async () => {
  const suffix = randomUUID().slice(0, 8);
  const baseProductId = `test-supply-override-${suffix}`;
  const groupCd = `group-cd-${suffix}`;
  const groupStores = `group-stores-${suffix}`;
  const cd = `cd-${suffix}`;
  const store = `store-${suffix}`;

  await db.collection("dp_unitGroups").doc(groupCd).set({ name: "CD teste", suppliedGroupIds: [groupStores] });
  await db.collection("dp_unitGroups").doc(groupStores).set({ name: "Quiosques teste" });
  await seedUnit(`u-${cd}`, { externalSource: "kiosk", externalId: cd, groupId: groupCd, stockRole: "supply" });
  await seedUnit(`u-${store}`, { externalSource: "kiosk", externalId: store, groupId: groupStores });
  await seedConsumptionReport(store, 2026, 6, 10, [{ baseProductId, productName: "TESTE", consumedQuantity: 60 }]);

  await db.collection("baseProducts").doc(baseProductId).set({
    name: "TESTE",
    unit: "kg",
    category: "Massa",
    stockLevels: { [cd]: { override: true, min: 77 } },
  });

  await runMinimumStockRecalculation(db, NOW);

  const levels = (await db.collection("baseProducts").doc(baseProductId).get()).data()!.stockLevels;
  assert.equal(levels[cd].min, 77, "valor manual do CD não pode ser sobrescrito");
  assert.equal(levels[store].min, 13, "60 em 6 meses => média 10 => 10*1.3");
});

test("unidade mista soma o consumo do próprio grupo (incluindo ela mesma)", async () => {
  const suffix = randomUUID().slice(0, 8);
  const baseProductId = `test-mixed-${suffix}`;
  const group = `group-mixed-${suffix}`;
  const mixed = `mixed-${suffix}`;
  const store = `store-${suffix}`;

  await db.collection("dp_unitGroups").doc(group).set({ name: "Grupo misto" });
  await seedUnit(`u-${mixed}`, { externalSource: "kiosk", externalId: mixed, groupId: group, stockRole: "mixed" });
  await seedUnit(`u-${store}`, { externalSource: "kiosk", externalId: store, groupId: group });

  for (const month of [3, 4, 5, 6, 7, 8]) {
    await seedConsumptionReport(mixed, 2026, month, 10, [{ baseProductId, productName: "TESTE", consumedQuantity: 10 }]);
    await seedConsumptionReport(store, 2026, month, 10, [{ baseProductId, productName: "TESTE", consumedQuantity: 20 }]);
  }
  await db.collection("baseProducts").doc(baseProductId).set({ name: "TESTE", unit: "kg", category: "Massa", stockLevels: {} });

  await runMinimumStockRecalculation(db, NOW);

  const levels = (await db.collection("baseProducts").doc(baseProductId).get()).data()!.stockLevels;
  assert.equal(levels[mixed].min, 39, "mista: (10+20)*1.3, sem contar a própria unidade em dobro");
  assert.equal(levels[store].min, 26, "comercial: só o próprio consumo");
});

test("execução no dia 16 avança a janela em uma quinzena (12 quinzenas anteriores)", async () => {
  const baseProductId = `test-day16-${randomUUID()}`;
  const kioskA = "kiosk-day16-a";
  const NOW_DAY_16 = new Date(Date.UTC(2026, 8, 16, 3, 0, 0)); // janela: 2026-03-2 .. 2026-09-1

  // mar/2026 dia 10 (1ª quinzena de março) fica FORA da janela; abr..set dia 10 ficam DENTRO
  await seedConsumptionReport(kioskA, 2026, 3, 10, [{ baseProductId, productName: "TESTE D16", consumedQuantity: 1000 }]);
  for (const month of [4, 5, 6, 7, 8, 9]) {
    await seedConsumptionReport(kioskA, 2026, month, 10, [{ baseProductId, productName: "TESTE D16", consumedQuantity: 10 }]);
  }
  // 2ª quinzena de setembro ainda não aconteceu para a janela do dia 16: fica FORA
  await seedConsumptionReport(kioskA, 2026, 9, 20, [{ baseProductId, productName: "TESTE D16", consumedQuantity: 5000 }]);

  await db.collection("baseProducts").doc(baseProductId).set({
    name: "TESTE D16",
    unit: "kg",
    category: "Massa",
    stockLevels: { [kioskA]: { override: false } },
  });

  await runMinimumStockRecalculation(db, NOW_DAY_16);

  const data = (await db.collection("baseProducts").doc(baseProductId).get()).data()!;
  assert.equal(data.stockLevels[kioskA].lastAutoCalculatedMean, 10, "6 meses (abr–set) de 10 => média mensal 10");
  assert.equal(data.stockLevels[kioskA].min, 13, "10*1.3");
});

test("base quinzenal divide o total da janela por 12 quinzenas", async () => {
  const baseProductId = `test-biweekly-${randomUUID()}`;
  const kioskA = "kiosk-biweekly-a";

  // 12 quinzenas anteriores a 01/09/2026: 2026-03-1 .. 2026-08-2. 24 em cada quinzena => média quinzenal 24
  for (const month of [3, 4, 5, 6, 7, 8]) {
    await seedConsumptionReport(kioskA, 2026, month, 5, [{ baseProductId, productName: "TESTE BI", consumedQuantity: 24 }]);
    await seedConsumptionReport(kioskA, 2026, month, 20, [{ baseProductId, productName: "TESTE BI", consumedQuantity: 24 }]);
  }
  await db.collection("baseProducts").doc(baseProductId).set({
    name: "TESTE BI",
    unit: "kg",
    category: "Massa",
    minStockRecalcPeriod: "biweekly",
    stockLevels: { [kioskA]: { override: false } },
  });

  await runMinimumStockRecalculation(db, NOW);

  const data = (await db.collection("baseProducts").doc(baseProductId).get()).data()!;
  assert.equal(data.stockLevels[kioskA].lastAutoCalculatedMean, 24);
  assert.equal(data.stockLevels[kioskA].min, 31.2, "24*1.3");
});

after(async () => {
  // Fecha a conexão do SDK admin para o node --test encerrar sozinho, sem handles pendurados.
  await Promise.all(getApps().map((app) => deleteApp(app)));
});
