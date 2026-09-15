import "server-only";

import { createHash } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function pdvPaymentFactId(input: {
  workspaceId: string;
  kioskId: string;
  couponId: string;
  paymentIndex: number;
}) {
  return `pdv_${digest(`${input.workspaceId}|${input.kioskId}|${input.couponId}|${input.paymentIndex}`).slice(0, 40)}`;
}

export function stoneSaleTransactionId(input: { workspaceId: string; externalTransactionId: string }) {
  return `stone_sale_${digest(`${input.workspaceId}|${input.externalTransactionId}`).slice(0, 40)}`;
}

export function salesReconciliationCaseId(input: { workspaceId: string; deterministicKey: string }) {
  return `sales_case_${digest(`${input.workspaceId}|${input.deterministicKey}`).slice(0, 40)}`;
}

export function stoneIngestionRunId(input: { workspaceId: string; idempotencyKey: string }) {
  return `stone_run_${digest(`${input.workspaceId}|${input.idempotencyKey}`).slice(0, 40)}`;
}
