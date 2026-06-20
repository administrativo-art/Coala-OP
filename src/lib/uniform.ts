import type { UniformCondition, UniformStockStatus } from "@/types";

export const UNIFORM_STOCK_ID = "__uniform_stock__";
export const UNIFORM_STOCK_NAME = "Estoque de uniformes";

function keyPart(value: string) {
  return value.trim().replace(/[\/\s]+/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "");
}

export function uniformLotId(params: {
  productId: string;
  condition: UniformCondition;
  status?: UniformStockStatus;
  lotNumber?: string | null;
}) {
  const status = params.status ?? "disponivel";
  const lotNumber = keyPart(params.lotNumber || "sem_lote") || "sem_lote";
  return `uniform_${keyPart(params.productId)}__${params.condition}__${status}__${lotNumber}`;
}

export function isUniformStockLot(lot: {
  kioskId?: string | null;
}) {
  return lot.kioskId === UNIFORM_STOCK_ID;
}
