import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PAYMENT_REQUEST_FILTER,
  matchesPaymentRequestFilter,
  paymentSchedulePresentation,
  stageGroup,
} from "../../src/features/financial/payment-requests/presentation";
import type {
  BankPaymentRequestStatus,
  BarcodeBankPaymentRequest,
  PixBankPaymentRequest,
} from "../../src/features/financial/payment-requests/types";

const now = new Date("2026-09-26T15:00:00.000Z");
const pix: PixBankPaymentRequest = {
  id: "pix-request",
  sourceType: "generated_receipt",
  sourceId: "receipt-1",
  paymentRail: "pix",
  beneficiaryReference: { sourceType: "entity", sourceId: "supplier-1" },
  beneficiarySnapshot: {
    sourceType: "entity",
    sourceId: "supplier-1",
    name: "Fornecedor de teste",
    document: "00000000000000",
    paymentMethod: "pix_key",
    maskedPaymentDestination: "•••• 1234",
    sourceUpdatedAt: "2026-09-25T15:00:00.000Z",
    resolvedAt: "2026-09-25T15:00:00.000Z",
  },
  amount: 100,
  description: "Pagamento de teste",
  status: "ready_to_submit",
  idempotencyKey: "test-pix",
  createdAt: "2026-09-25T15:00:00.000Z",
  createdBy: "test-user",
  updatedAt: "2026-09-25T15:00:00.000Z",
};
const boleto: BarcodeBankPaymentRequest = {
  id: "barcode-request",
  sourceType: "financial_inbox",
  sourceId: "inbox-1",
  paymentRail: "barcode",
  barcodeSnapshot: {
    type: "barcode",
    code: "23790",
    maskedCode: "23790••••",
    scheduledFor: "2026-09-26",
    dueDate: "2026-09-30",
  },
  amount: 100,
  description: "Boleto de teste",
  status: "awaiting_financial_authorization",
  idempotencyKey: "test-barcode",
  createdAt: "2026-09-25T15:00:00.000Z",
  createdBy: "test-user",
  updatedAt: "2026-09-25T15:00:00.000Z",
};

test("Pix distingue previsão para hoje, futura e passada sem criar vencimento", () => {
  for (const [scheduledFor, date, timing] of [
    ["2026-09-26", "26/09/2026", "Hoje"],
    ["2026-09-27", "27/09/2026", "Data futura"],
    ["2026-09-25", "25/09/2026", "Data passada"],
  ]) {
    assert.deepEqual(paymentSchedulePresentation({ ...pix, scheduledFor }, now), {
      label: "Pagamento previsto", date, timing, dueDate: null,
    });
  }
});

test("Pix sem data, inclusive legado sem trilho, informa imediato no envio", () => {
  for (const paymentRail of ["pix", undefined] as const) {
    for (const scheduledFor of [undefined, null, ""]) {
      assert.deepEqual(paymentSchedulePresentation({ ...pix, paymentRail, scheduledFor }, now), {
        label: "Pagamento previsto", date: null, timing: "Imediato no envio", dueDate: null,
      });
    }
  }
});

test("previsão usa a virada do dia em Belém, independentemente da data UTC", () => {
  const item = { ...pix, scheduledFor: "2027-01-01" };
  for (const [instant, timing] of [
    ["2027-01-01T02:59:59.999Z", "Data futura"],
    ["2027-01-01T03:00:00.000Z", "Hoje"],
    ["2027-01-02T02:59:59.999Z", "Hoje"],
    ["2027-01-02T03:00:00.000Z", "Data passada"],
  ]) {
    assert.equal(paymentSchedulePresentation(item, new Date(instant)).timing, timing);
  }
});

test("boleto mantém programação e vencimento independentes e usa a programação do snapshot", () => {
  assert.deepEqual(paymentSchedulePresentation({ ...boleto, scheduledFor: "2026-10-01" }, now), {
    label: "Pagamento previsto", date: "26/09/2026", timing: "Hoje", dueDate: "30/09/2026",
  });
  assert.deepEqual(paymentSchedulePresentation({
    ...boleto,
    barcodeSnapshot: { ...boleto.barcodeSnapshot, scheduledFor: "2026-09-28" },
  }, now), {
    label: "Pagamento previsto", date: "28/09/2026", timing: "Data futura", dueDate: "30/09/2026",
  });
});

test("boleto com mesma data mantém explícitos os dois significados", () => {
  assert.deepEqual(paymentSchedulePresentation({
    ...boleto,
    barcodeSnapshot: { ...boleto.barcodeSnapshot, dueDate: "2026-09-26" },
  }, now), {
    label: "Pagamento previsto", date: "26/09/2026", timing: "Hoje", dueDate: "26/09/2026",
  });
});

test("previsão passada do boleto não é substituída pelo vencimento futuro", () => {
  assert.deepEqual(paymentSchedulePresentation({
    ...boleto,
    barcodeSnapshot: { ...boleto.barcodeSnapshot, scheduledFor: "2026-09-25" },
  }, now), {
    label: "Pagamento previsto", date: "25/09/2026", timing: "Data passada", dueDate: "30/09/2026",
  });
});

test("boleto sem programação não herda vencimento nem programação de outro campo", () => {
  assert.deepEqual(paymentSchedulePresentation({
    ...boleto,
    scheduledFor: "2026-09-26",
    barcodeSnapshot: { ...boleto.barcodeSnapshot, scheduledFor: "" },
  }, now), {
    label: "Pagamento previsto", date: null, timing: "Data não informada", dueDate: "30/09/2026",
  });
});

test("data em formato desconhecido não é apresentada como pagamento imediato", () => {
  assert.deepEqual(paymentSchedulePresentation({ ...pix, scheduledFor: "26/09/2026" }, now), {
    label: "Pagamento previsto", date: null, timing: "Data não informada", dueDate: null,
  });
});

test("data solicitada não presume confirmação de agendamento pelo banco", () => {
  const requested = paymentSchedulePresentation({ ...pix, scheduledFor: "2026-09-27" }, now);
  const confirmed = paymentSchedulePresentation({
    ...pix,
    scheduledFor: "2026-09-27",
    status: "scheduled",
    bankSchedulingObservedAt: "2026-09-26T14:00:00.000Z",
  }, now);
  assert.deepEqual(requested, {
    label: "Pagamento previsto", date: "27/09/2026", timing: "Data futura", dueDate: null,
  });
  assert.deepEqual(confirmed, { ...requested, label: "Agendado para" });
});

test("boleto já agendado explicita data do agendamento independente do vencimento", () => {
  assert.deepEqual(paymentSchedulePresentation({ ...boleto, status: "scheduled" }, now), {
    label: "Agendado para", date: "26/09/2026", timing: "Hoje", dueDate: "30/09/2026",
  });
});

test("filtro inicial inclui todos os status não pagos, até os terminais", () => {
  const statuses: BankPaymentRequestStatus[] = [
    "draft", "awaiting_financial_authorization", "ready_to_submit", "submitting",
    "awaiting_bank_approval", "scheduled", "processing", "awaiting_statement",
    "paid", "rejected", "approval_expired", "failed", "cancelled",
  ];
  assert.equal(DEFAULT_PAYMENT_REQUEST_FILTER, "unpaid");
  const requests = statuses.map((status) => ({ ...boleto, status }));
  assert.deepEqual(
    requests.filter((item) => matchesPaymentRequestFilter(item, DEFAULT_PAYMENT_REQUEST_FILTER))
      .map((item) => item.status),
    statuses.filter((status) => status !== "paid"),
  );
  assert.equal(requests.filter((item) => matchesPaymentRequestFilter(item, "all")).length, statuses.length);
});

test("pago divergente sai de Não pagos e continua acessível em Todos e Atenção", () => {
  const divergent = { ...boleto, status: "paid", beneficiaryVerificationStatus: "divergent" } as const;
  assert.equal(matchesPaymentRequestFilter(divergent, DEFAULT_PAYMENT_REQUEST_FILTER), false);
  assert.equal(matchesPaymentRequestFilter(divergent, "all"), true);
  assert.equal(matchesPaymentRequestFilter(divergent, "risk"), true);
  assert.equal(stageGroup(divergent), "risk");
  // Preserve the existing attention grouping for a paid request requiring review.
  assert.equal(matchesPaymentRequestFilter(divergent, "done"), false);
});

test("filtros anteriores preservam acesso por etapa e concluídos", () => {
  assert.equal(matchesPaymentRequestFilter(pix, "you"), true);
  assert.equal(matchesPaymentRequestFilter({ ...pix, status: "scheduled" }, "bank"), true);
  assert.equal(matchesPaymentRequestFilter({ ...pix, status: "failed" }, "risk"), true);
  for (const beneficiaryVerificationStatus of ["verified", "unavailable", undefined] as const) {
    const paid = { ...pix, status: "paid", beneficiaryVerificationStatus } as const;
    assert.equal(matchesPaymentRequestFilter(paid, "done"), true);
    assert.equal(matchesPaymentRequestFilter(paid, "risk"), false);
    assert.equal(matchesPaymentRequestFilter(paid, "all"), true);
    assert.equal(matchesPaymentRequestFilter(paid, "unpaid"), false);
  }
});
