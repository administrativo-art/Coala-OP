import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { getMovementQuantityInBaseUnit } from "@/lib/movement-quantity";
import type { BaseProduct, EffectiveCostEntry, MovementRecord, Product } from "@/types";

export class DreStockCmvLimitError extends Error {
  readonly reason: "movements" | "products" | "costs";

  constructor(reason: "movements" | "products" | "costs") {
    super("O volume solicitado ultrapassa o limite operacional do CMV por estoque.");
    this.name = "DreStockCmvLimitError";
    this.reason = reason;
  }
}

export type DreCmvCriterion = "composition" | "stock_movement";

export type DreStockUnitMonthSummary = {
  kioskId: string;
  year: number;
  month: number;
  consumptionCmv: number;
  lossesCmv: number;
  adjustmentsCmv: number;
  totalCmv: number;
  movementCount: number;
  unpricedMovementCount: number;
  movementDays: number;
  firstMovementAt?: string;
  lastMovementAt?: string;
};

export type DreStockCmvPayload = {
  periods: string[];
  stockSummaries: DreStockUnitMonthSummary[];
  missingProductIds: string[];
  missingBaseProductIds: string[];
  unpricedBaseProductIds: string[];
  stats: {
    movementDocuments: number;
    productDocuments: number;
    baseProductDocuments: number;
    effectiveCostDocuments: number;
  };
};

type StockMovementCategory = "consumption" | "losses" | "adjustments";

type ValuationContext = {
  productsById: ReadonlyMap<string, Product>;
  baseProductsById: ReadonlyMap<string, BaseProduct>;
  effectiveCostsByBaseProductId: ReadonlyMap<string, EffectiveCostEntry[]>;
};

function movementCategory(type: string): StockMovementCategory | null {
  if (type === "SAIDA_CONSUMO") return "consumption";
  if (type.startsWith("SAIDA_DESCARTE_")) return "losses";
  if (
    type === "SAIDA_CORRECAO"
    || type.includes("decréscimo")
    || type.includes("Divergência")
  ) return "adjustments";
  return null;
}

export function isDreStockOutflowMovement(
  movement: Pick<MovementRecord, "type" | "reverted" | "itemClass" | "fromKioskId">,
) {
  return Boolean(
    movementCategory(String(movement.type ?? ""))
    && !movement.reverted
    && movement.itemClass !== "uniform"
    && movement.fromKioskId,
  );
}

function latestEffectiveCostAt(entries: EffectiveCostEntry[], movementAt: number) {
  let selected: EffectiveCostEntry | undefined;
  let selectedAt = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const occurredAt = new Date(entry.occurredAt).getTime();
    if (!Number.isFinite(occurredAt) || occurredAt > movementAt || occurredAt < selectedAt) continue;
    if (!Number.isFinite(entry.unitCost) || entry.unitCost <= 0) continue;
    selected = entry;
    selectedAt = occurredAt;
  }
  return selected?.unitCost;
}

export function summarizeDreStockMovements(
  movements: MovementRecord[],
  context: ValuationContext,
) {
  const summaries = new Map<string, DreStockUnitMonthSummary & { movementDateKeys: Set<string> }>();
  const missingProductIds = new Set<string>();
  const missingBaseProductIds = new Set<string>();
  const unpricedBaseProductIds = new Set<string>();

  for (const movement of movements) {
    const category = movementCategory(String(movement.type ?? ""));
    if (!category || !isDreStockOutflowMovement(movement) || !movement.fromKioskId) continue;

    const movementAt = new Date(movement.timestamp).getTime();
    const movementDateKey = financialDateKey(movement.timestamp);
    if (!Number.isFinite(movementAt) || !movementDateKey) continue;
    const monthKey = movementDateKey.slice(0, 7);
    const [year, month] = monthKey.split("-").map(Number);
    const summaryKey = `${movement.fromKioskId}:${monthKey}`;
    const summary = summaries.get(summaryKey) ?? {
      kioskId: movement.fromKioskId,
      year,
      month,
      consumptionCmv: 0,
      lossesCmv: 0,
      adjustmentsCmv: 0,
      totalCmv: 0,
      movementCount: 0,
      unpricedMovementCount: 0,
      movementDays: 0,
      movementDateKeys: new Set<string>(),
    };
    summary.movementCount += 1;
    summary.movementDateKeys.add(movementDateKey);
    if (!summary.firstMovementAt || movement.timestamp < summary.firstMovementAt) {
      summary.firstMovementAt = movement.timestamp;
    }
    if (!summary.lastMovementAt || movement.timestamp > summary.lastMovementAt) {
      summary.lastMovementAt = movement.timestamp;
    }

    const product = context.productsById.get(movement.productId);
    if (!product) {
      missingProductIds.add(movement.productId);
      summary.unpricedMovementCount += 1;
      summaries.set(summaryKey, summary);
      continue;
    }
    const baseProductId = product.baseProductId;
    const baseProduct = baseProductId ? context.baseProductsById.get(baseProductId) : undefined;
    if (!baseProductId || !baseProduct) {
      missingBaseProductIds.add(baseProductId || movement.productId);
      summary.unpricedMovementCount += 1;
      summaries.set(summaryKey, summary);
      continue;
    }

    const historicalCost = latestEffectiveCostAt(
      context.effectiveCostsByBaseProductId.get(baseProductId) ?? [],
      movementAt,
    );
    const fallbackCost = Number(baseProduct.initialCostPerUnit);
    const unitCost = historicalCost ?? (Number.isFinite(fallbackCost) && fallbackCost > 0 ? fallbackCost : undefined);
    if (unitCost === undefined) {
      unpricedBaseProductIds.add(baseProductId);
      summary.unpricedMovementCount += 1;
      summaries.set(summaryKey, summary);
      continue;
    }

    const baseQuantity = Math.abs(getMovementQuantityInBaseUnit(movement, product, baseProduct));
    const value = baseQuantity * unitCost;
    if (!Number.isFinite(value)) {
      unpricedBaseProductIds.add(baseProductId);
      summary.unpricedMovementCount += 1;
      summaries.set(summaryKey, summary);
      continue;
    }
    if (category === "consumption") summary.consumptionCmv += value;
    if (category === "losses") summary.lossesCmv += value;
    if (category === "adjustments") summary.adjustmentsCmv += value;
    summary.totalCmv += value;
    summaries.set(summaryKey, summary);
  }

  return {
    stockSummaries: [...summaries.values()].map(({ movementDateKeys, ...summary }) => ({
      ...summary,
      movementDays: movementDateKeys.size,
    })).sort((left, right) => (
      left.year - right.year
      || left.month - right.month
      || left.kioskId.localeCompare(right.kioskId)
    )),
    missingProductIds: [...missingProductIds].sort(),
    missingBaseProductIds: [...missingBaseProductIds].sort(),
    unpricedBaseProductIds: [...unpricedBaseProductIds].sort(),
  };
}
