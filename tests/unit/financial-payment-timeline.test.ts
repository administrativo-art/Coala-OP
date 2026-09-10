import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildPaymentTimeline,
  financialDaysUntil,
  isWithinPastFinancialDays,
} from "../../src/features/financial/payment-requests/timeline";
import type { BarcodeBankPaymentRequest } from "../../src/features/financial/payment-requests/types";

const paymentPage = readFileSync("src/features/financial/payment-requests/payment-requests-page.tsx", "utf8");

const scheduledRequest: BarcodeBankPaymentRequest = {
  id: "payment-1",
  sourceType: "financial_inbox",
  sourceId: "inbox-1",
  paymentRail: "barcode",
  barcodeSnapshot: {
    type: "barcode",
    code: "23790",
    maskedCode: "23790••••",
    dueDate: "2026-09-15",
    scheduledFor: "2026-09-15",
  },
  amount: 536.64,
  description: "Honorário Maximus 09/2026 - João Paulo",
  status: "scheduled",
  idempotencyKey: "key-1",
  createdAt: "2026-09-08T16:30:09.150Z",
  createdBy: "user-1",
  authorizedAt: "2026-09-08T16:30:09.150Z",
  submittedAt: "2026-09-08T16:40:55.609Z",
  bankApprovalObservedAt: "2026-09-08T16:58:18.592Z",
  bankSchedulingObservedAt: "2026-09-08T16:58:18.592Z",
  updatedAt: "2026-09-08T16:58:18.592Z",
};

test("linha do tempo distingue autorização bancária, agendamento e liquidação", () => {
  const timeline = buildPaymentTimeline(scheduledRequest, "Cobrança recebida");
  const approval = timeline.find((step) => step.title === "Autorização bancária identificada");
  const scheduling = timeline.find((step) => step.title === "Pagamento agendado");
  const liquidation = timeline.find((step) => step.title === "Pagamento liquidado");

  assert.deepEqual(approval, {
    title: "Autorização bancária identificada",
    meta: "Identificada em 08/09/2026 13:58",
    state: "done",
  });
  assert.equal(scheduling?.meta, "Identificado em 08/09/2026 13:58 · para 15/09/2026");
  assert.equal(scheduling?.state, "done");
  assert.equal(liquidation?.meta, "Aguardando a data programada (15/09/2026)");
  assert.equal(liquidation?.state, "pending");
});

test("não inventa horário de aprovação para registro legado", () => {
  const timeline = buildPaymentTimeline({
    ...scheduledRequest,
    bankApprovalObservedAt: undefined,
    bankSchedulingObservedAt: undefined,
  }, "Cobrança recebida");
  assert.equal(
    timeline.find((step) => step.title === "Autorização bancária identificada")?.meta,
    "Confirmação ainda sem horário registrado",
  );
});

test("Pix pago não fica aguardando uma conciliação de extrato não exigida", () => {
  const timeline = buildPaymentTimeline({
    ...scheduledRequest,
    sourceType: "generated_receipt",
    paymentRail: "pix",
    beneficiaryReference: {
      sourceType: "entity",
      sourceId: "supplier-1",
    },
    beneficiarySnapshot: {
      sourceType: "entity",
      sourceId: "supplier-1",
      name: "Fornecedor",
      document: "00.000.000/0001-00",
      paymentMethod: "pix_key",
      maskedPaymentDestination: "•••• 1234",
      sourceUpdatedAt: "2026-09-08T16:00:00.000Z",
      resolvedAt: "2026-09-08T16:00:00.000Z",
    },
    barcodeSnapshot: undefined,
    scheduledFor: undefined,
    status: "paid",
    paidAt: "2026-09-08T17:00:00.000Z",
    bankLiquidationObservedAt: "2026-09-08T17:00:00.000Z",
    statementReconciliationStatus: "not_expected",
  }, "Recibo gerado");

  assert.equal(timeline.some((step) => step.title === "Conciliado no extrato"), false);
  assert.equal(timeline.find((step) => step.title === "Pagamento liquidado")?.state, "done");
});

test("conciliação divergente e agendamento terminal são exibidos como falha", () => {
  const timeline = buildPaymentTimeline({
    ...scheduledRequest,
    status: "rejected",
    bankSchedulingObservedAt: undefined,
    statementReconciliationStatus: "divergent",
  }, "Cobrança recebida");

  assert.equal(timeline.find((step) => step.title === "Pagamento agendado")?.state, "fail");
  assert.equal(timeline.find((step) => step.title === "Conciliado no extrato")?.state, "fail");
});

test("janela de sete dias usa o calendário financeiro de Belém", () => {
  assert.equal(
    isWithinPastFinancialDays(
      "2026-09-01T02:30:00.000Z",
      7,
      new Date("2026-09-08T02:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    isWithinPastFinancialDays(
      "2026-08-31T02:30:00.000Z",
      7,
      new Date("2026-09-08T03:00:00.000Z"),
    ),
    false,
  );
  assert.equal(financialDaysUntil("2026-09-09", new Date("2026-09-09T02:30:00.000Z")), 1);
  assert.equal(financialDaysUntil("2026-09-09", new Date("2026-09-09T03:00:00.000Z")), 0);
});

test("divergência bancária não oferece reenvio do pagamento", () => {
  assert.match(paymentPage, /item\.lastError\?\.code !== "BANK_RECONCILIATION_DIVERGENCE"/);
});
