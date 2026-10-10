import type { User } from "@firebase/auth";

import { authenticatedJson } from "./upload";

export type RepositionRow = { baseProductId: string; lotId: string; productName: string; lotNumber: string; sentQuantity: number; imageUrl?: string | null };
export type RepositionToReceive = {
  id: string;
  originName: string;
  destinationId: string;
  destinationName: string;
  createdAt: string;
  dispatchedBy: string | null;
  dispatchedAt: string | null;
  rows: RepositionRow[];
};
/** O que a colaboradora digitou para um lote: quantidade recebida (texto) e a explicação da diferença. */
export type ReceiptDraft = { received: string; notes: string };

export const receiptRowKey = (row: Pick<RepositionRow, "baseProductId" | "lotId">) => `${row.baseProductId}:${row.lotId}`;

export function loadRepositionsToReceive(user: User) {
  return authenticatedJson<{ activities: RepositionToReceive[]; truncated: boolean }>(user, "/api/stock/mobile-reposition");
}

export function confirmRepositionReceipt(user: User, activityId: string, rows: Array<{ baseProductId: string; lotId: string; receivedQuantity: number; notes: string }>) {
  return authenticatedJson<{ status: string; hasDivergence: boolean; alreadyReceived: boolean }>(
    user, "/api/stock/mobile-reposition/receive", { method: "POST", body: JSON.stringify({ activityId, rows }) });
}

export function createSimulationRepositions(): RepositionToReceive[] {
  const now = new Date().toISOString();
  return [{
    id: "simulation-reposition", originName: "Centro de distribuição", destinationId: "simulation-unit", destinationName: "Unidade de simulação",
    createdAt: now, dispatchedBy: "Motorista de simulação", dispatchedAt: now,
    rows: [
      { baseProductId: "b1", lotId: "l1", productName: "Leite integral (1L)", lotNumber: "SIM-001", sentQuantity: 12 },
      { baseProductId: "b2", lotId: "l2", productName: "Açúcar refinado (1kg)", lotNumber: "SIM-002", sentQuantity: 5 },
      { baseProductId: "b3", lotId: "l3", productName: "Copo descartável 300 ml (100un)", lotNumber: "SIM-003", sentQuantity: 8 },
      { baseProductId: "b4", lotId: "l4", productName: "Canudo biodegradável (500un)", lotNumber: "SIM-004", sentQuantity: 2 },
    ],
  }];
}
