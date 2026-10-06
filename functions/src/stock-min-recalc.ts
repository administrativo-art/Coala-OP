import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

const TIME_ZONE = "America/Belem";
const HISTORY_MONTHS = 6;
const SAFETY_MARGIN = 1.3; // +30% sobre a média de consumo
const MOVEMENT_HISTORY_READ_LIMIT = 20000; // salvaguarda: sem índice composto (type, timestamp) hoje, lemos tudo e filtramos em memória

type Period = "monthly" | "biweekly";
type BucketKey = string; // "2026-04" (monthly) ou "2026-04-1" / "2026-04-2" (biweekly)

type ConsumptionEntry = {
  baseProductId: string;
  kioskId: string;
  year: number;
  month: number;
  day: number;
  quantity: number;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Os HISTORY_MONTHS meses completos anteriores ao mês corrente (assume execução no dia 1). */
function lastCompleteMonths(now: Date): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1; // 1-12
  for (let i = 0; i < HISTORY_MONTHS; i++) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    months.push({ year, month });
  }
  return months.reverse();
}

function allBucketKeys(period: Period, months: Array<{ year: number; month: number }>): BucketKey[] {
  if (period === "monthly") return months.map(({ year, month }) => `${year}-${pad2(month)}`);
  return months.flatMap(({ year, month }) => [`${year}-${pad2(month)}-1`, `${year}-${pad2(month)}-2`]);
}

function bucketKeyFor(period: Period, year: number, month: number, day: number): BucketKey {
  if (period === "monthly") return `${year}-${pad2(month)}`;
  return `${year}-${pad2(month)}-${day <= 15 ? 1 : 2}`;
}

/** consumptionReports gerados via `pdv-sync.ts` nem sempre têm o campo `day` (alguns docs antigos só têm no id: cons_sync_<kiosk>_YYYY_MM_DD). */
function dayFromDocId(id: string): number | null {
  const match = id.match(/_(\d{1,2})$/);
  return match ? Number(match[1]) : null;
}

async function loadConsumptionReportEntries(db: Firestore, years: number[]): Promise<ConsumptionEntry[]> {
  const snap = await db.collection("consumptionReports").where("year", "in", years).get();
  const entries: ConsumptionEntry[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const day = typeof data.day === "number" ? data.day : dayFromDocId(doc.id);
    if (!data.kioskId || !data.year || !data.month || !day || !Array.isArray(data.results)) continue;
    for (const item of data.results) {
      if (!item?.baseProductId || typeof item.consumedQuantity !== "number") continue;
      entries.push({
        baseProductId: item.baseProductId,
        kioskId: data.kioskId,
        year: data.year,
        month: data.month,
        day,
        quantity: item.consumedQuantity,
      });
    }
  }
  return entries;
}

/** movementHistory.productId referencia a coleção `products` (SKU específico), não `baseProducts` diretamente. */
async function loadProductToBaseProductMap(db: Firestore): Promise<Map<string, string>> {
  const snap = await db.collection("products").select("baseProductId").get();
  const map = new Map<string, string>();
  for (const doc of snap.docs) {
    const baseProductId = doc.get("baseProductId");
    if (typeof baseProductId === "string") map.set(doc.id, baseProductId);
  }
  return map;
}

/**
 * Fonte de fallback para insumos que não passam pela sincronização de vendas do PDV
 * (ex.: limpeza, EPI) — consumo lançado manualmente como "Ajuste de contagem".
 */
async function loadMovementHistoryEntries(
  db: Firestore,
  cutoff: Date,
  productToBaseProduct: Map<string, string>,
): Promise<ConsumptionEntry[]> {
  const snap = await db
    .collection("movementHistory")
    .where("type", "==", "SAIDA_CONSUMO")
    .limit(MOVEMENT_HISTORY_READ_LIMIT)
    .get();
  if (snap.size === MOVEMENT_HISTORY_READ_LIMIT) {
    logger.warn("movementHistory atingiu o limite de leitura; crie o índice composto e pagine por data.", {
      source: "recalculateMinimumStock",
      readLimit: MOVEMENT_HISTORY_READ_LIMIT,
    });
  }
  const entries: ConsumptionEntry[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const timestampValue = data.timestamp;
    if (!timestampValue || typeof timestampValue.toDate !== "function") continue;
    const date: Date = timestampValue.toDate();
    if (date < cutoff) continue;
    const baseProductId = productToBaseProduct.get(data.productId);
    const kioskId = data.fromKioskId;
    const quantity = data.quantityChange;
    if (!baseProductId || !kioskId || typeof quantity !== "number") continue;
    entries.push({
      baseProductId,
      kioskId,
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      quantity,
    });
  }
  return entries;
}

type StockRole = "commercial" | "mixed" | "supply";

/**
 * Mapeia, para cada quiosque de estoque que seja unidade de abastecimento (ou mista), os quiosques
 * cujo consumo ele deve somar. Vem do cadastro do módulo de Pessoal:
 * - `dp_units.externalId` (com `externalSource: "kiosk"`) liga a unidade ao quiosque do estoque;
 * - `dp_units.stockRole`: "commercial" (padrão), "mixed" ou "supply";
 * - `dp_unitGroups.suppliedGroupIds`: grupos que o grupo da unidade de abastecimento atende.
 * Uma unidade mista atende também o próprio grupo.
 */
export async function loadSupplyMap(db: Firestore): Promise<Map<string, Set<string>>> {
  const [unitsSnap, groupsSnap] = await Promise.all([
    db.collection("dp_units").get(),
    db.collection("dp_unitGroups").get(),
  ]);

  const suppliedByGroup = new Map<string, string[]>();
  for (const doc of groupsSnap.docs) {
    const ids = doc.get("suppliedGroupIds");
    if (Array.isArray(ids)) suppliedByGroup.set(doc.id, ids.filter((id): id is string => typeof id === "string"));
  }

  type UnitInfo = { kioskId: string; groupId?: string; role: StockRole };
  const units: UnitInfo[] = [];
  for (const doc of unitsSnap.docs) {
    const data = doc.data();
    if (data.isArchived === true) continue;
    if (data.externalSource !== "kiosk" || typeof data.externalId !== "string" || !data.externalId) continue;
    const role: StockRole = data.stockRole === "supply" || data.stockRole === "mixed" ? data.stockRole : "commercial";
    units.push({ kioskId: data.externalId, groupId: typeof data.groupId === "string" ? data.groupId : undefined, role });
  }

  const supplyMap = new Map<string, Set<string>>();
  for (const supplier of units) {
    if (supplier.role === "commercial" || !supplier.groupId) continue;
    const servedGroups = new Set<string>(suppliedByGroup.get(supplier.groupId) ?? []);
    if (supplier.role === "mixed") servedGroups.add(supplier.groupId);
    if (servedGroups.size === 0) continue;
    const served = new Set<string>();
    for (const unit of units) {
      if (unit.role === "supply" || !unit.groupId || !servedGroups.has(unit.groupId)) continue;
      served.add(unit.kioskId);
    }
    if (served.size > 0) supplyMap.set(supplier.kioskId, served);
  }
  return supplyMap;
}

function roundForUnit(value: number, unit: string | undefined): number {
  if (unit === "un") return Math.ceil(value);
  return Math.round(value * 100) / 100;
}

function groupBy<T, K>(entries: T[], keyOf: (entry: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
  }
  return map;
}

export type RecalculationSummary = {
  updated: number;
  skippedArchived: number;
  skippedOverride: number;
  skippedNoData: number;
};

/**
 * Recalcula `stockLevels.<kioskId>.min` de cada insumo (baseProduct), usando a média de
 * consumo dos últimos 6 meses + 30% de margem de segurança. Extraída do trigger `onSchedule`
 * abaixo para poder ser exercitada por teste de integração contra o emulador do Firestore.
 *
 * Fonte de consumo: primeiro tenta `consumptionReports` (consumo ligado a vendas via PDV);
 * se o insumo nunca aparece lá, usa `movementHistory` (tipo SAIDA_CONSUMO — baixa manual,
 * ex. limpeza/EPI) como alternativa. As duas fontes nunca são somadas para o mesmo insumo,
 * pra não contar em dobro consumo de venda + ajuste manual de contagem.
 *
 * `minStockRecalcPeriod` em cada baseProduct escolhe a granularidade da média: 'monthly'
 * (padrão) usa a média mensal dos 6 meses; 'biweekly' usa a média quinzenal (12 quinzenas).
 * Itens em "un" são arredondados para cima; os demais mantêm 2 casas decimais.
 *
 * `stockLevels.<kioskId>.override === true` ("Manter valor manual") trava o item nesse quiosque —
 * pula e não sobrescreve um valor ajustado manualmente.
 *
 * Unidades de abastecimento/mistas (ver `loadSupplyMap`) usam a soma do consumo das unidades
 * atendidas, na mesma base mensal/quinzenal, com a mesma margem de 30%.
 */
export async function runMinimumStockRecalculation(db: Firestore, now: Date): Promise<RecalculationSummary> {
  const months = lastCompleteMonths(now);
  const years = Array.from(new Set(months.map((m) => m.year)));
  const cutoff = new Date(Date.UTC(months[0].year, months[0].month - 1, 1));

  const [productToBaseProduct, baseProductsSnap, supplyMap] = await Promise.all([
    loadProductToBaseProductMap(db),
    db.collection("baseProducts").get(),
    loadSupplyMap(db),
  ]);

  const [reportEntries, movementEntries] = await Promise.all([
    loadConsumptionReportEntries(db, years),
    loadMovementHistoryEntries(db, cutoff, productToBaseProduct),
  ]);

  const reportByProduct = groupBy(reportEntries, (e) => e.baseProductId);
  const movementByProduct = groupBy(movementEntries, (e) => e.baseProductId);

  let batch = db.batch();
  let batchCount = 0;
  const summary: RecalculationSummary = { updated: 0, skippedArchived: 0, skippedOverride: 0, skippedNoData: 0 };

  for (const doc of baseProductsSnap.docs) {
    const product = doc.data();
    if (product.isArchived === true) {
      summary.skippedArchived++;
      continue;
    }

    const period: Period = product.minStockRecalcPeriod === "biweekly" ? "biweekly" : "monthly";
    const bucketKeys = allBucketKeys(period, months);

    // fonte primária: consumptionReports; só cai para movementHistory se o insumo nunca aparecer lá
    const sourceEntries = reportByProduct.get(doc.id) ?? movementByProduct.get(doc.id) ?? [];
    if (sourceEntries.length === 0) {
      summary.skippedNoData++;
      continue;
    }

    const byKiosk = groupBy(sourceEntries, (e) => e.kioskId);

    const stockLevels: Record<string, { min?: number; override?: boolean }> = product.stockLevels ?? {};
    // Quiosques sem linha no cadastro do insumo também entram assim que tiverem consumo
    // (ou, no caso de unidade de abastecimento, consumo das unidades atendidas).
    const kioskIds = new Set<string>([...Object.keys(stockLevels), ...byKiosk.keys(), ...supplyMap.keys()]);

    for (const kioskId of kioskIds) {
      const level = stockLevels[kioskId];
      if (level?.override) {
        summary.skippedOverride++;
        continue;
      }

      const served = supplyMap.get(kioskId);
      const kioskEntries = served
        ? Array.from(served).flatMap((servedKioskId) => byKiosk.get(servedKioskId) ?? [])
        : byKiosk.get(kioskId) ?? [];
      if (kioskEntries.length === 0) {
        summary.skippedNoData++;
        continue;
      }

      const totals = new Map<BucketKey, number>(bucketKeys.map((k) => [k, 0]));
      for (const entry of kioskEntries) {
        const key = bucketKeyFor(period, entry.year, entry.month, entry.day);
        if (!totals.has(key)) continue; // fora da janela de 6 meses
        totals.set(key, (totals.get(key) ?? 0) + entry.quantity);
      }

      const values = Array.from(totals.values());
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      if (mean <= 0) {
        summary.skippedNoData++;
        continue;
      }

      const newMin = roundForUnit(mean * SAFETY_MARGIN, product.unit);

      batch.update(doc.ref, {
        [`stockLevels.${kioskId}.min`]: newMin,
        [`stockLevels.${kioskId}.override`]: false,
        [`stockLevels.${kioskId}.lastAutoCalculatedAt`]: now.toISOString(),
        [`stockLevels.${kioskId}.lastAutoCalculatedMean`]: Math.round(mean * 100) / 100,
      });
      summary.updated++;
      batchCount++;
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
  }

  if (batchCount > 0) await batch.commit();
  return summary;
}

export const recalculateMinimumStock = onSchedule(
  {
    schedule: "0 3 1 * *",
    timeZone: TIME_ZONE,
    retryCount: 2,
    timeoutSeconds: 300,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore("coala");
    const summary = await runMinimumStockRecalculation(db, new Date());
    console.log(
      `[recalculateMinimumStock] ${summary.updated} estoques mínimos atualizados; ${summary.skippedArchived} insumos arquivados ignorados; ${summary.skippedOverride} pulados por override; ${summary.skippedNoData} pulados por falta de dado de consumo.`,
    );
  },
);
