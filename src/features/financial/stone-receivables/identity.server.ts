import { createHash } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function stoneReceivableId(input: { workspaceId: string; receivableKey: string }) {
  return `stone_recv_${digest(`${input.workspaceId}|${input.receivableKey}`).slice(0, 40)}`;
}

export function stoneSettlementId(input: { workspaceId: string; externalSettlementId: string }) {
  return `stone_settle_${digest(`${input.workspaceId}|${input.externalSettlementId}`).slice(0, 40)}`;
}

export function stoneFinancialRunId(input: { workspaceId: string; source: string; idempotencyKey: string }) {
  return `stone_run_${digest(`${input.workspaceId}|${input.source}|${input.idempotencyKey}`).slice(0, 40)}`;
}
