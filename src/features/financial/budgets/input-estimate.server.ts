import "server-only";

import { dbAdmin } from "@/lib/firebase-admin";
import { WORKSPACE_ID } from "@/lib/workspace";
import { getBaseUnitsPerPurchaseUnit } from "@/lib/purchasing-units";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { estimateInputPurchase } from "@/features/financial/lib/budget-input-estimate";
import type { BaseProduct, ConsumptionReport, EffectiveCostEntry, LotEntry, Product, PurchaseOrder, PurchaseOrderItem } from "@/types";
import type { FinancialBudgetRule } from "./types";
import { BudgetDomainError } from "./errors";

const REPORT_LIMIT = 500;
const LOT_LIMIT = 1500;
const ORDER_LIMIT = 100;

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysBetween(start: string, end: string) {
  return Math.max(0, Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000));
}

async function productsByIds(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  const snapshots = unique.length ? await dbAdmin.getAll(...unique.map((id) => dbAdmin.collection("products").doc(id))) : [];
  return new Map(snapshots.filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, { id: snapshot.id, ...snapshot.data() } as Product]));
}

function baseUnits(quantity: number, product: Product | undefined, base: BaseProduct | undefined, unitType: PurchaseOrderItem["purchaseUnitType"] = "content") {
  if (!product || !base) throw new BudgetDomainError("Há um item de estoque ou pedido sem produto derivado vinculado.");
  const conversion = getBaseUnitsPerPurchaseUnit(product, base, unitType);
  if (!conversion.ok) throw new BudgetDomainError(`Não foi possível converter ${base.name} para a unidade base.`);
  return quantity * conversion.baseUnitsPerPurchaseUnit;
}

export async function estimateConsumptionPriceBudget(rule: Pick<FinancialBudgetRule,
  "baseProductIds" | "averageMonths" | "closingStockDays" | "accountPlanIds" | "stockKioskId">, month: string) {
  const now = financialDateKey(new Date())!;
  const targetStart = `${month}-01`;
  if (month < now.slice(0, 7)) throw new BudgetDomainError("A previsão por estoque exige o mês atual ou um mês futuro.");
  if (rule.stockKioskId !== "matriz" || rule.baseProductIds.length === 0) {
    throw new BudgetDomainError("Selecione os insumos e o estoque da matriz.");
  }
  const referenceMonths: string[] = [];
  let reference = previousMonth(month);
  const lastClosed = previousMonth(now.slice(0, 7));
  if (reference > lastClosed) reference = lastClosed;
  for (let index = 0; index < rule.averageMonths; index++) {
    referenceMonths.push(reference);
    reference = previousMonth(reference);
  }
  const [baseSnapshots, reports, lotsSnapshot, ordersSnapshot, costSnapshots] = await Promise.all([
    dbAdmin.getAll(...rule.baseProductIds.map((id) => dbAdmin.collection("baseProducts").doc(id))),
    Promise.all(referenceMonths.map(async (key) => {
      const [year, monthNumber] = key.split("-").map(Number);
      const snapshot = await dbAdmin.collection("consumptionReports")
        .where("year", "==", year).where("month", "==", monthNumber).limit(REPORT_LIMIT + 1).get();
      if (snapshot.size > REPORT_LIMIT) throw new BudgetDomainError(`Há relatórios demais em ${key}.`);
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ConsumptionReport));
    })),
    dbAdmin.collection("lots").where("kioskId", "==", "matriz").limit(LOT_LIMIT + 1).get(),
    dbAdmin.collection("purchase_orders")
      .where("workspaceId", "==", WORKSPACE_ID).where("status", "==", "confirmed")
      .where("estimatedReceiptDate", ">=", now).where("estimatedReceiptDate", "<", `${month}-32`)
      .limit(ORDER_LIMIT + 1).get(),
    Promise.all(rule.baseProductIds.map(async (id) => {
      const snapshot = await dbAdmin.collection("effective_cost_history")
        .where("workspaceId", "==", WORKSPACE_ID).where("baseItemId", "==", id)
        .where("occurredAt", "<", `${month}-01T00:00:00Z`).orderBy("occurredAt", "desc").limit(20).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as EffectiveCostEntry));
    })),
  ]);
  if (lotsSnapshot.size > LOT_LIMIT || ordersSnapshot.size > ORDER_LIMIT) {
    throw new BudgetDomainError("Há estoque ou pedidos demais para esta prévia. Refine a consulta.");
  }
  const bases = new Map(baseSnapshots.filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, { id: snapshot.id, ...snapshot.data() } as BaseProduct]));
  if (bases.size !== rule.baseProductIds.length || [...bases.values()].some((base) => base.isArchived)) {
    throw new BudgetDomainError("Um dos insumos selecionados não existe ou está arquivado.");
  }
  const orderRows = ordersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as PurchaseOrder))
    .filter((order) => !order.receivedAt);
  const orderItems = await Promise.all(orderRows.map(async (order) => {
    const snapshot = await dbAdmin.collection("purchase_orders").doc(order.id).collection("items").limit(101).get();
    if (snapshot.size > 100) throw new BudgetDomainError("Um pedido tem itens demais para a prévia.");
    return { order, items: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as PurchaseOrderItem)) };
  }));
  const lotRows = lotsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as LotEntry))
    .filter((lot) => lot.quantity > 0 && (!lot.expiryDate || lot.expiryDate.slice(0, 10) >= targetStart));
  const productMap = await productsByIds([
    ...lotRows.map((lot) => lot.productId),
    ...orderItems.flatMap(({ items }) => items.map((item) => item.productId ?? "")),
  ]);
  const targetDays = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const daysUntilMonth = daysBetween(now, targetStart);
  const inputEstimates = rule.baseProductIds.map((id, index) => {
    const base = bases.get(id)!;
    const monthQuantities = reports.map((monthReports, monthIndex) => {
      const valid = monthReports.filter((report) => report.status !== "error" && report.status !== "processing");
      const scoped = valid.some((report) => report.kioskId !== "matriz") ? valid.filter((report) => report.kioskId !== "matriz") : valid;
      if (!scoped.length) throw new BudgetDomainError(`Não há relatório de consumo completo em ${referenceMonths[monthIndex]}.`);
      const daily = scoped.filter((report) => report.day);
      if (daily.length && new Set(daily.map((report) => report.day)).size < 20) {
        throw new BudgetDomainError(`Consumo diário incompleto em ${referenceMonths[monthIndex]}.`);
      }
      return scoped.reduce((sum, report) => sum + report.results
        .filter((item) => item.baseProductId === id).reduce((subtotal, item) => subtotal + Number(item.consumedQuantity || 0), 0), 0);
    });
    const costs = costSnapshots[index].filter((entry) => Number(entry.quantity) > 0 && Number(entry.unitCost) > 0);
    if (!costs.length) throw new BudgetDomainError(`Falta preço efetivo de compra para ${base.name}.`);
    const pricePerUnit = costs.reduce((sum, entry) => sum + entry.quantity * entry.unitCost, 0)
      / costs.reduce((sum, entry) => sum + entry.quantity, 0);
    const stockNow = lotRows.reduce((sum, lot) => {
      const product = productMap.get(lot.productId);
      return product?.baseProductId === id ? sum + baseUnits(Math.max(0, lot.quantity - (lot.reservedQuantity || 0)), product, base) : sum;
    }, 0);
    const inbound = orderItems.reduce((result, { order, items }) => {
      const amount = items.filter((item) => item.baseItemId === id)
        .reduce((sum, item) => sum + baseUnits(Math.max(0, item.quantityOrdered - (item.quantityReceived || 0)), productMap.get(item.productId || ""), base, item.purchaseUnitType), 0);
      if (order.estimatedReceiptDate.slice(0, 10) < targetStart) result.before += amount;
      else result.during += amount;
      return result;
    }, { before: 0, during: 0 });
    const averageMonthly = monthQuantities.reduce((sum, quantity) => sum + quantity, 0) / monthQuantities.length;
    const remainingDays = month === now.slice(0, 7) ? targetDays - Number(now.slice(8, 10)) + 1 : targetDays;
    return estimateInputPurchase({ baseProductId: id, name: base.name, unit: base.unit,
      monthlyConsumption: averageMonthly * remainingDays / targetDays,
      stockNow, inboundBeforeMonth: inbound.before, inboundDuringMonth: inbound.during,
      daysUntilMonth, targetMonthDays: targetDays, closingStockDays: rule.closingStockDays, pricePerUnit });
  });
  return { referenceMonths, inputEstimates, additionalAmountCents: inputEstimates.reduce((sum, item) => sum + item.additionalPurchaseAmountCents, 0) };
}
