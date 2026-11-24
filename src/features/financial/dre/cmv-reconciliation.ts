import type { BaseProduct, EffectiveCostEntry, MovementRecord } from "@/types";
import { convertValue, normalizeMeasurementUnit } from "@/lib/conversion";
import { getMovementQuantityInBaseUnit } from "@/lib/movement-quantity";
import { isDreStockOutflowMovement, summarizeDreStockMovements } from "./stock-cmv";
import type { CmvProductSnapshot } from "./cmv-closure";
export type StockCmvContribution = { kioskId: string; baseProductId: string; name: string; unit: string; category: BaseProduct["category"];
  quantity: number; value: number; kind: "consumption" | "losses" | "adjustments"; initialCost: boolean; costReferenceId?: string | null; costReferenceAt?: string | null; appliedCost?: number };
export type StockReconciliationInput = { complete: boolean; rows: StockCmvContribution[]; diagnostics: string[] };
export type CompositionReconciliationInput = { kioskId: string; period: string; status: "open" | "closed"; complete: boolean;
  sourceChanged: boolean; referenceAt: string; revision?: number; sourceFingerprint?: string; salesFingerprint?: string; totalCmv: number | null; products: CmvProductSnapshot[] };
export function buildStockReconciliationInput(movements: MovementRecord[], context: Parameters<typeof summarizeDreStockMovements>[1]): StockReconciliationInput {
  const rows: StockCmvContribution[] = [], diagnostics: string[] = [];
  for (const movement of movements.filter(isDreStockOutflowMovement)) {
    const product = context.productsById.get(movement.productId), base = product?.baseProductId ? context.baseProductsById.get(product.baseProductId) : undefined;
    const summary = summarizeDreStockMovements([movement], context).stockSummaries[0];
    if (!product || !base || !summary || summary.unpricedMovementCount) { diagnostics.push("Saída sem produto, base ou custo comprovado."); continue; }
    const quantity = Math.abs(getMovementQuantityInBaseUnit(movement, product, base));
    if (!Number.isFinite(quantity) || quantity <= 0) { diagnostics.push("Quantidade de saída inválida para conciliar."); continue; }
    let costReference: EffectiveCostEntry | undefined;
    for (const entry of context.effectiveCostsByBaseProductId.get(base.id) ?? []) {
      const at = new Date(entry.occurredAt).getTime();
      if (!Number.isFinite(entry.unitCost) || entry.unitCost <= 0 || !Number.isFinite(at) || at > new Date(movement.timestamp).getTime()) continue;
      if (!costReference || at >= new Date(costReference.occurredAt).getTime()) costReference = entry;
    }
    const historical = !!costReference;
    rows.push({ kioskId: movement.fromKioskId!, baseProductId: base.id, name: base.name, unit: base.unit, category: base.category,
      quantity, value: summary.totalCmv, kind: movement.type === "SAIDA_CONSUMO" ? "consumption" : String(movement.type).startsWith("SAIDA_DESCARTE_") ? "losses" : "adjustments", initialCost: !historical, costReferenceId: costReference?.id ?? base.id, costReferenceAt: costReference?.occurredAt ?? null, appliedCost: summary.totalCmv / quantity });
  }
  return { complete: diagnostics.length === 0, rows, diagnostics: [...new Set(diagnostics)] };
}
export type CmvReconciliationRow = { kioskId: string; baseProductId: string; name: string; unit: string;
  expectedQty: number; consumedQty: number; discardedQty: number; adjustedQty: number;
  expectedValue: number; consumedValue: number; discardedValue: number; adjustedValue: number;
  quantityEffect: number; priceEffect: number; unplannedValue: number; difference: number;
  initialCostCount: number; initialCostValue: number; overridePrice: boolean; manualPrices: number[] };
export const reconciliationFields = ["expectedValue", "consumedValue", "discardedValue", "adjustedValue", "quantityEffect", "priceEffect", "unplannedValue", "difference", "initialCostValue"] as const;
export function summarizeCmvReconciliation(rows: CmvReconciliationRow[]) {
  return Object.fromEntries(reconciliationFields.map(key => [key, rows.reduce((sum, r) => sum + r[key], 0)])) as Record<typeof reconciliationFields[number], number>;
}
export type CmvReconciliationReference = { kioskId: string; kind: "composition" | "stock_cost" | "composition_price"; baseProductId: string | null;
  referenceId: string | null; referenceAt: string | null; source: string; revision: number | null; sourceFingerprint: string | null; salesFingerprint: string | null; appliedPrice: number | null; unit: string | null };
export type CmvReconciliation = { available: boolean; reasons: string[]; basis: string; references: CmvReconciliationReference[]; rows: CmvReconciliationRow[];
  totals: ReturnType<typeof summarizeCmvReconciliation> | null; stockTotal: number | null; compositionTotal: number | null; residual: number | null };
/** Counterfactual bridge by unit/base ID. It explains arithmetic, not physical causes. */
export function reconcileDreCmv(input: { stock: StockReconciliationInput | null; composition: CompositionReconciliationInput[];
  kioskIds: string[]; stockTotal: number; period: string }): CmvReconciliation {
  const reasons: string[] = [];
  const failed = (): CmvReconciliation => ({ available: false, reasons: [...new Set(reasons)], basis: "Indisponível", references: [], rows: [], totals: null, stockTotal: Number.isFinite(input.stockTotal) ? input.stockTotal : null, compositionTotal: null, residual: null });
  if (!input.stock?.complete || !Number.isFinite(input.stockTotal)) { reasons.push(...(input.stock?.diagnostics ?? []), "Fonte de estoque incompleta ou indisponível para a conciliação."); return failed(); }
  const composition = input.composition.filter(c => c.period === input.period && input.kioskIds.includes(c.kioskId));
  if (!input.kioskIds.length || composition.length !== input.kioskIds.length || new Set(composition.map(c => c.kioskId)).size !== input.kioskIds.length
    || composition.some(c => !c.complete || c.totalCmv === null || c.sourceChanged)) {
    reasons.push("Fichas/snapshot ou vendas não comprovam uma referência completa e íntegra para todas as unidades."); return failed();
  }
  if (composition.some(c => c.status === "closed" && (!Number.isInteger(c.revision) || c.revision! < 1 || !c.sourceFingerprint || !c.salesFingerprint || !c.referenceAt))) {
    reasons.push("Snapshot fechado sem revisão, fingerprints ou data auditáveis."); return failed();
  }
  const references: CmvReconciliationReference[] = composition.map(c => ({ kioskId: c.kioskId, kind: "composition", baseProductId: null, referenceId: `${c.kioskId}:${c.period}`,
    referenceAt: c.referenceAt, source: c.status === "closed" ? "snapshot fechado" : "fichas abertas", revision: c.revision ?? 0, sourceFingerprint: c.sourceFingerprint ?? null,
    salesFingerprint: c.salesFingerprint ?? null, appliedPrice: null, unit: null }));
  const rows = new Map<string, CmvReconciliationRow>();
  const baseUnits = new Map(input.stock.rows.map(r => [r.baseProductId, { unit: r.unit, category: r.category, name: r.name }]));
  const get = (kioskId: string, baseProductId: string, name: string, unit: string) => {
    const key = kioskId + ":" + baseProductId;
    if (!rows.has(key)) rows.set(key, { kioskId, baseProductId, name, unit, expectedQty: 0, consumedQty: 0, discardedQty: 0, adjustedQty: 0,
      expectedValue: 0, consumedValue: 0, discardedValue: 0, adjustedValue: 0, quantityEffect: 0, priceEffect: 0, unplannedValue: 0, difference: 0, initialCostCount: 0, initialCostValue: 0, overridePrice: false, manualPrices: [] });
    return rows.get(key)!;
  };
  for (const c of composition) for (const p of c.products) {
    if (!p.composition?.complete || !Number.isFinite(p.quantity) || p.quantity <= 0) { reasons.push("Snapshot da ficha contém produto/quantidade inválido."); continue; }
    for (const line of p.composition.lines) {
      const reference = baseUnits.get(line.baseProductId); const unit = reference?.unit ?? line.unit;
      let quantity: number;
      try { quantity = normalizeMeasurementUnit(line.unit).toLowerCase() === normalizeMeasurementUnit(unit).toLowerCase()
        ? line.quantity : convertValue(line.quantity, line.unit, unit, reference?.category ?? line.category); }
      catch { reasons.push("Unidades incompatíveis entre ficha e estoque; nenhum produto foi relacionado por nome."); continue; }
      references.push({ kioskId: c.kioskId, kind: "composition_price", baseProductId: line.baseProductId, referenceId: line.priceReferenceId ?? line.itemId,
        referenceAt: line.priceReferenceAt, source: line.priceSource, revision: null, sourceFingerprint: null, salesFingerprint: null,
        appliedPrice: quantity > 0 ? line.totalCmv / quantity : null, unit });
      const r = get(c.kioskId, line.baseProductId, reference?.name ?? line.baseProductName, unit);
      r.expectedQty += quantity * p.quantity; r.expectedValue += line.totalCmv * p.quantity; r.overridePrice ||= line.priceSource === "override";
      if (line.priceSource === "override" && quantity > 0) { const price = line.totalCmv / quantity; if (!r.manualPrices.includes(price)) r.manualPrices.push(price); }
    }
  }
  if (reasons.length) return failed();
  for (const s of input.stock.rows) {
    references.push({ kioskId: s.kioskId, kind: "stock_cost", baseProductId: s.baseProductId, referenceId: s.costReferenceId ?? s.baseProductId,
      referenceAt: s.costReferenceAt ?? null, source: s.initialCost ? "custo inicial (sem histórico)" : "histórico efetivo", revision: null, sourceFingerprint: null, salesFingerprint: null,
      appliedPrice: s.appliedCost ?? (s.quantity > 0 ? s.value / s.quantity : null), unit: s.unit });
    const r = get(s.kioskId, s.baseProductId, s.name, s.unit);
    if (s.kind === "consumption") { r.consumedQty += s.quantity; r.consumedValue += s.value; }
    if (s.kind === "losses") { r.discardedQty += s.quantity; r.discardedValue += s.value; }
    if (s.kind === "adjustments") { r.adjustedQty += s.quantity; r.adjustedValue += s.value; }
    if (s.initialCost) { r.initialCostCount++; r.initialCostValue += s.value; }
  }
  for (const r of rows.values()) {
    if (r.expectedQty > 0) { const price = r.expectedValue / r.expectedQty; r.quantityEffect = (r.consumedQty - r.expectedQty) * price; r.priceEffect = r.consumedValue - r.consumedQty * price; }
    else r.unplannedValue = r.consumedValue;
    r.difference = r.consumedValue + r.discardedValue + r.adjustedValue - r.expectedValue;
  }
  const resultRows = [...rows.values()].sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.kioskId.localeCompare(b.kioskId) || a.baseProductId.localeCompare(b.baseProductId));
  const totals = summarizeCmvReconciliation(resultRows), compositionTotal = composition.reduce((sum, c) => sum + c.totalCmv!, 0);
  const residual = input.stockTotal - compositionTotal - totals.quantityEffect - totals.priceEffect - totals.unplannedValue - totals.discardedValue - totals.adjustedValue;
  if (Math.abs(residual) > .00001 || Math.abs(totals.expectedValue - compositionTotal) > .00001) { reasons.push("A ponte não reproduz os totais de origem; conciliação não publicada como completa."); return failed(); }
  return { available: true, reasons: [], references: [...new Map(references.map(r => [JSON.stringify(r), r])).values()], rows: resultRows, totals, stockTotal: input.stockTotal, compositionTotal, residual,
    basis: composition.every(c => c.status === "closed") ? "Fichas congeladas no fechamento íntegro" : composition.every(c => c.status === "open") ? "Fichas abertas e custos atuais na geração" : "Referências mistas: snapshots fechados e fichas abertas" };
}
