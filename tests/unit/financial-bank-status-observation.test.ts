import assert from "node:assert/strict";
import test from "node:test";

import {
  bankStatusRefreshIsDue,
  paymentSubmissionRequiresManualReconciliation,
  planBankStatusObservation,
} from "../../src/features/financial/payment-requests/bank-status-observation";

test("registra a primeira confirmação bancária e adia consulta de agendamento futuro", () => {
  const observation = planBankStatusObservation({
    current: { status: "awaiting_bank_approval", bankStatus: "EM_APROVACAO" },
    nextStatus: "scheduled",
    rawBankStatus: "AGENDADO",
    observedAt: "2026-09-08T16:58:18.592Z",
    scheduledFor: "2026-09-15",
  });

  assert.equal(observation.approvalObserved, true);
  assert.equal(observation.schedulingObserved, true);
  assert.equal(observation.shouldWriteAuditEvent, true);
  assert.deepEqual(observation.patch, {
    bankStatus: "AGENDADO",
    bankApprovalObservedAt: "2026-09-08T16:58:18.592Z",
    bankSchedulingObservedAt: "2026-09-08T16:58:18.592Z",
    nextBankStatusCheckAt: "2026-09-15T09:00:00.000Z",
  });
});

test("não cria nova auditoria quando o banco repete o mesmo estado", () => {
  const observation = planBankStatusObservation({
    current: {
      status: "scheduled",
      bankStatus: "AGENDADO",
      bankApprovalObservedAt: "2026-09-08T16:58:18.592Z",
      bankSchedulingObservedAt: "2026-09-08T16:58:18.592Z",
      nextBankStatusCheckAt: "2026-09-15T09:00:00.000Z",
    },
    nextStatus: "scheduled",
    rawBankStatus: "AGENDADO",
    observedAt: "2026-09-08T17:03:18.592Z",
    scheduledFor: "2026-09-15",
  });

  assert.equal(observation.changed, false);
  assert.equal(observation.shouldWriteAuditEvent, false);
  assert.deepEqual(observation.patch, {});
});

test("estado de processamento desconhecido não inventa aprovação bancária", () => {
  const observation = planBankStatusObservation({
    current: { status: "awaiting_bank_approval" },
    nextStatus: "processing",
    rawBankStatus: "STATUS_NOVO",
    observedAt: "2026-09-08T17:00:00.000Z",
  });

  assert.equal(observation.approvalObserved, false);
  assert.equal(observation.patch.bankApprovalObservedAt, undefined);
  assert.equal(observation.patch.nextBankStatusCheckAt, "2026-09-08T17:05:00.000Z");
});

test("libera a consulta automática na data programada", () => {
  assert.equal(bankStatusRefreshIsDue("2026-09-15T09:00:00.000Z", new Date("2026-09-15T08:59:59.000Z")), false);
  assert.equal(bankStatusRefreshIsDue("2026-09-15T09:00:00.000Z", new Date("2026-09-15T09:00:00.000Z")), true);
  assert.equal(bankStatusRefreshIsDue(undefined, new Date("2026-09-15T09:00:00.000Z")), true);
});

test("registra liquidação sem sobrescrever a primeira aprovação", () => {
  const observation = planBankStatusObservation({
    current: {
      status: "processing",
      bankStatus: "PROCESSANDO",
      bankApprovalObservedAt: "2026-09-08T16:58:18.592Z",
    },
    nextStatus: "paid",
    rawBankStatus: "PAGO",
    observedAt: "2026-09-15T13:04:00.000Z",
    scheduledFor: "2026-09-15",
  });

  assert.equal(observation.approvalObserved, false);
  assert.equal(observation.liquidationObserved, true);
  assert.equal(observation.patch.bankApprovalObservedAt, undefined);
  assert.equal(observation.patch.bankLiquidationObservedAt, "2026-09-15T13:04:00.000Z");
});

test("bloqueia reenvio no servidor quando a conciliação exige revisão", () => {
  assert.equal(paymentSubmissionRequiresManualReconciliation({
    lastError: { code: "BANK_RECONCILIATION_DIVERGENCE" },
  }), true);
  assert.equal(paymentSubmissionRequiresManualReconciliation({
    statementReconciliationStatus: "divergent",
  }), true);
  assert.equal(paymentSubmissionRequiresManualReconciliation({
    lastError: { code: "INTER_REQUEST_FAILED" },
  }), false);
});
