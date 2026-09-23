import assert from "node:assert/strict";
import test from "node:test";
import Papa from "papaparse";
import { exactStonePixCents, parseStonePixCsv } from "../../src/lib/integrations/stone/pix-conciliation";

const payment = {
  id: "event-1", amount: "1000", status: "paid", payment_method: "pix",
  created_at: "2026-09-20T02:00:00.123456+00:00",
  pix_transaction__e2e_id: "E0000000020260920000000example00001",
  pix_transaction__paid_amount: "1000", pix_transaction__canceled_amount: "0",
  pix_transaction__fee_amount: "5",
  pix_transaction__additional_data: "[{name=Cliente, value=123456789}, {name=Terminal, value=TEST-001}]",
  pix_transaction__terminal__serial_number: "TEST-001",
  pix_transaction__detail__operation: "pay",
  pix_transaction__detail__provider_datetime: "2026-09-20T02:00:00.123457+00:00",
  pix_transaction__detail__operation_amount: "1000",
  pix_transaction__detail__refund_id: "",
};
const parse = (...rows: Record<string, unknown>[]) => parseStonePixCsv(Papa.unparse(rows)).transactions;
const evidence = (overrides: Record<string, unknown> = {}) => parse({ ...payment, ...overrides })[0].reviewEvidence;

test("centavos estritos não multiplicam, arredondam ou substituem ausência por zero", () => {
  for (const [value, expected] of [["1000", 1000], ["700,0", 700], ["700.000", 700], [0, 0], ["0", 0]] as const) {
    assert.equal(exactStonePixCents(value), expected);
  }
  for (const value of [undefined, null, "", " ", "1.1", "1,1", -1, "-1", "1e3", "1 000", "0x10",
    NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER, "999999999999999999999", {}, true]) {
    assert.equal(exactStonePixCents(value), null);
  }
});

test("pagamento íntegro conserva evento, E2E, centavos e microssegundos sem confirmar conciliação", () => {
  const result = evidence();
  assert.equal(result.candidateForReview, true);
  assert.equal(result.eventKind, "payment");
  assert.equal(result.eventId, payment.id);
  assert.equal(result.e2eId, payment.pix_transaction__e2e_id);
  assert.equal(result.createdAtUtc, payment.created_at);
  assert.deepEqual(result.amounts, { gross: 1000, paid: 1000, canceled: 0, fee: 5, operation: 1000 });
  assert.deepEqual(result.issues, []);
});

test("campo monetário faltante ou fracionário impede candidato mesmo que parser legado arredonde", () => {
  for (const field of ["amount", "pix_transaction__paid_amount", "pix_transaction__canceled_amount",
    "pix_transaction__fee_amount", "pix_transaction__detail__operation_amount"]) {
    for (const value of ["", "0.4", "invalid"]) {
      const result = evidence({ [field]: value });
      assert.equal(result.candidateForReview, false);
      assert.ok(result.issues.includes("invalid_amount"));
    }
  }
  const [row] = parse({ ...payment, amount: "999.8" });
  assert.equal(row.amountCents, 1000); // Compatibility only; never use for review.
  assert.equal(row.reviewEvidence.amounts.gross, null);
});

test("valores incompatíveis e pagamentos zerados não viram venda candidata", () => {
  for (const overrides of [
    { amount: "0" }, { pix_transaction__paid_amount: "999" },
    { pix_transaction__detail__operation_amount: "999" }, { pix_transaction__fee_amount: "1001" },
  ]) {
    const result = evidence(overrides);
    assert.equal(result.candidateForReview, false);
    assert.ok(result.issues.includes("inconsistent_payment"));
  }
});

test("cancelamentos integrais, parciais e refund não se tornam vendas pagas", () => {
  for (const overrides of [
    { status: "canceled" }, { pix_transaction__detail__operation: "cancel" },
    { pix_transaction__canceled_amount: "100" }, { pix_transaction__canceled_amount: "1000" },
    { pix_transaction__detail__refund_id: "refund-1" },
  ]) {
    const result = evidence(overrides);
    assert.equal(result.candidateForReview, false);
    assert.ok(result.issues.includes("cancellation"));
  }
});

test("operação, status e meio desconhecidos ficam pendentes", () => {
  for (const overrides of [{ status: "pending" }, { payment_method: "credit_card" },
    { pix_transaction__detail__operation: "payment" }, { pix_transaction__detail__operation: "refund" }]) {
    assert.ok(evidence(overrides).issues.includes("unsupported_event"));
    assert.equal(evidence(overrides).candidateForReview, false);
  }
});

test("datas inválidas, sem UTC ou anteriores à criação são rejeitadas sem perder microssegundos", () => {
  for (const value of ["", "2026-02-30T12:00:00Z", "2026-09-20T02:00:00", "2026-09-20T24:00:00Z",
    "2026-09-20T02:00:00-03:00", "2026-09-20T02:00:00.1234567Z"]) {
    assert.ok(evidence({ created_at: value }).issues.includes("invalid_timestamp"));
  }
  assert.ok(evidence({ pix_transaction__detail__provider_datetime: "2026-09-20T02:00:00.123455Z" })
    .issues.includes("invalid_timestamp"));
  assert.equal(evidence({ created_at: "2026-09-20T02:00:00Z" }).candidateForReview, true);
});

test("IDs ausentes, longos ou inválidos não são truncados para produzir igualdade", () => {
  for (const field of ["id", "pix_transaction__e2e_id"]) {
    for (const value of ["", "x".repeat(161), "bad/id"]) {
      const result = evidence({ [field]: value });
      assert.ok(result.issues.includes("invalid_identifiers"));
      assert.equal(result.candidateForReview, false);
    }
  }
});

test("provider_datetime sem zona segue UTC documentado, sem depender do timezone da máquina", () => {
  const result = evidence({ pix_transaction__detail__provider_datetime: "2026-09-20T02:00:00.123457" });
  assert.equal(result.candidateForReview, true);
  assert.equal(result.providerDateTimeUtc, "2026-09-20T02:00:00.123457Z");
});

test("replay de evento bloqueia todas as linhas e preserva IDs estáveis do parser legado", () => {
  const rows = parse(payment, payment);
  assert.notEqual(rows[0].rowId, rows[1].rowId);
  for (const row of rows) {
    assert.equal(row.reviewEvidence.candidateForReview, false);
    assert.ok(row.reviewEvidence.issues.includes("duplicate_event"));
    assert.ok(row.reviewEvidence.issues.includes("related_pix_events"));
  }
});

test("pagamento e cancelamento do mesmo E2E bloqueiam ambos, independentemente da ordem", () => {
  const cancel = { ...payment, id: "event-2", status: "canceled", pix_transaction__detail__operation: "cancel" };
  for (const input of [[payment, cancel], [cancel, payment]]) {
    for (const row of parse(...input)) {
      assert.equal(row.reviewEvidence.candidateForReview, false);
      assert.ok(row.reviewEvidence.issues.includes("related_pix_events"));
    }
  }
});

test("sem StoneCode identificado não há candidato e dados sensíveis não são retidos", () => {
  const [row] = parse({ ...payment, pix_transaction__additional_data: "[]",
    pix_transaction__payer__name: "PRIVATE-PAYER", pix_transaction__pix_key: "PRIVATE-KEY" });
  assert.equal(row.reviewEvidence.candidateForReview, false);
  assert.ok(row.reviewEvidence.issues.includes("merchant_unidentified"));
  assert.equal(JSON.stringify(row).includes("PRIVATE-"), false);
});
