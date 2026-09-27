import { convertValue, normalizeMeasurementUnit, units } from "@/lib/conversion";
import type { BaseProduct, ProductSimulationItem } from "@/types";

export const COMPOSITION_CMV_FORMULA_VERSION = "composition-current-v1";
export type CompositionCmvLine = {
  itemId: string; baseProductId: string; baseProductName: string;
  quantity: number; unit: string; category: BaseProduct["category"];
  priceSource: "lastEffectivePrice" | "initialCostPerUnit" | "override";
  priceReferenceId: string | null; priceReferenceAt: string | null;
  appliedPrice: number; priceUnit: string; conversionFactor: number;
  costPerBaseUnit: number; totalCmv: number;
};
export type CompositionCmvResult = {
  formulaVersion: typeof COMPOSITION_CMV_FORMULA_VERSION;
  complete: boolean; totalCmv: number | null; diagnostics: string[]; lines: CompositionCmvLine[];
};

/** Quantity is expressed in the ingredient base unit; override price is per overrideUnit. */
export function calculateProductCompositionCmv(
  items: readonly ProductSimulationItem[], baseProductsById: ReadonlyMap<string, BaseProduct>,
): CompositionCmvResult {
  const diagnostics: string[] = [];
  const lines: CompositionCmvLine[] = [];
  if (!items.length) diagnostics.push("empty_composition");
  const ids = new Set<string>();
  for (const item of items) {
    const fail = (code: string) => diagnostics.push(`${code}:${item.id || item.baseProductId || "unknown"}`);
    if (!item.id || ids.has(item.id)) { fail("invalid_item_id"); continue; }
    ids.add(item.id);
    const base = baseProductsById.get(item.baseProductId);
    if (!base) { fail("missing_ingredient"); continue; }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) { fail("invalid_quantity"); continue; }
    if (typeof item.useDefault !== "boolean") { fail("invalid_price_mode"); continue; }
    const unitValid = (unit: string) => Object.keys(units[base.category] ?? {})
      .some(key => key.toLowerCase() === normalizeMeasurementUnit(unit).toLowerCase());
    const priceUnit = item.useDefault ? base.unit : item.overrideUnit;
    if (!base.unit || !priceUnit || !unitValid(base.unit) || !unitValid(priceUnit)) { fail("invalid_unit"); continue; }
    const appliedPrice = item.useDefault
      ? base.lastEffectivePrice?.pricePerUnit ?? base.initialCostPerUnit : item.overrideCostPerUnit;
    if (typeof appliedPrice !== "number" || !Number.isFinite(appliedPrice) || appliedPrice <= 0) { fail("invalid_price"); continue; }
    const conversionFactor = convertValue(1, priceUnit, base.unit, base.category);
    const costPerBaseUnit = appliedPrice / conversionFactor;
    const totalCmv = item.quantity * costPerBaseUnit;
    if (!Number.isFinite(totalCmv) || totalCmv <= 0) { fail("invalid_cost"); continue; }
    lines.push({ itemId: item.id, baseProductId: base.id, baseProductName: base.name ?? "",
      quantity: item.quantity, unit: base.unit, category: base.category,
      priceSource: item.useDefault ? (base.lastEffectivePrice?.pricePerUnit != null ? "lastEffectivePrice" : "initialCostPerUnit") : "override",
      priceReferenceId: item.useDefault ? base.lastEffectivePrice?.id ?? null : null,
      priceReferenceAt: item.useDefault ? base.lastEffectivePrice?.confirmedAt ?? null : null,
      appliedPrice, priceUnit, conversionFactor, costPerBaseUnit, totalCmv });
  }
  const total = lines.reduce((sum, line) => sum + line.totalCmv, 0);
  if (!Number.isFinite(total)) diagnostics.push("invalid_total");
  return { formulaVersion: COMPOSITION_CMV_FORMULA_VERSION, complete: diagnostics.length === 0,
    totalCmv: diagnostics.length ? null : total, diagnostics, lines };
}
