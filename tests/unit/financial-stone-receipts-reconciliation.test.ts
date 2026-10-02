import assert from "node:assert/strict";
import test from "node:test";
import { receiptReconciliationRequestSchema, reconcileStoneReceipts, type BankCreditFact, type StoneReceiptSettlement } from "../../src/features/financial/receipts-reconciliation/reconciliation";

const settlement = (overrides: Partial<StoneReceiptSettlement> = {}): StoneReceiptSettlement => ({
  id: "sale-1:1",
  transactionId: "sale-1",
  installment: 1,
  paymentId: "payment-1",
  paymentDate: "2026-09-20",
  expectedPaymentDate: "2026-09-20",
  saleDate: "2026-09-18",
  grossAmount: 100,
  netAmount: 97.5,
  paymentEventCount: 1,
  sourceFileId: "file-20",
  sourceReferenceDate: "2026-09-20",
  adjustments: [],
  ...overrides,
});

const credit = (overrides: Partial<BankCreditFact> = {}): BankCreditFact => ({
  id: "bank-1",
  date: "2026-09-21",
  amount: 97.5,
  description: "STONE PAGAMENTOS",
  references: ["bank-ref-1"],
  externalTransactionId: "inter-1",
  ...overrides,
});

test("só considera recebido quando o crédito entra na conta vinculada", () => {
  const result = reconcileStoneReceipts({
    settlements: [settlement()],
    bankCredits: [credit()],
    today: "2026-09-24",
  });

  assert.equal(result.matches[0].status, "received");
  assert.equal(result.summary.received, 1);
  assert.equal(result.summary.bankMatchedAmount, 97.5);
  assert.equal(result.matches[0].bank?.id, "bank-1");
});

test("pagamento informado pela Stone permanece aguardando dentro da janela e vira pendência depois", () => {
  const awaiting = reconcileStoneReceipts({ settlements: [settlement()], bankCredits: [], today: "2026-09-21" });
  assert.equal(awaiting.matches[0].status, "awaiting_bank_credit");

  const late = reconcileStoneReceipts({ settlements: [settlement()], bankCredits: [], today: "2026-09-24" });
  assert.equal(late.matches[0].status, "missing_bank_credit");
  assert.equal(late.summary.missingBankCredit, 1);
});

test("diferencia valor divergente e créditos ambíguos", () => {
  const mismatch = reconcileStoneReceipts({ settlements: [settlement()], bankCredits: [credit({ amount: 96 })], today: "2026-09-24" });
  assert.equal(mismatch.matches[0].status, "bank_amount_mismatch");
  assert.equal(mismatch.matches[0].amountDifference, -1.5);

  const ambiguous = reconcileStoneReceipts({
    settlements: [settlement()],
    bankCredits: [credit(), credit({ id: "bank-2", description: "STONE REPASSE" })],
    today: "2026-09-24",
  });
  assert.equal(ambiguous.matches[0].status, "ambiguous_bank_credit");
  assert.equal(ambiguous.matches[0].candidateBankCredits.length, 2);
});

test("mantém estorno/ajuste visível mesmo quando o crédito foi confirmado", () => {
  const result = reconcileStoneReceipts({
    settlements: [settlement({ adjustments: [{ kind: "chargeback", count: 1 }] })],
    bankCredits: [credit()],
    today: "2026-09-24",
  });
  assert.equal(result.matches[0].status, "received_with_adjustment");
  assert.match(result.matches[0].explanation, /chargeback/);
});

test("não baixa uma parcela com múltiplos eventos de pagamento Stone", () => {
  const result = reconcileStoneReceipts({
    settlements: [settlement({ paymentEventCount: 2 })],
    bankCredits: [credit()],
    today: "2026-09-24",
  });
  assert.equal(result.matches[0].status, "stone_payment_review");
  assert.equal(result.summary.stonePaymentReview, 1);
  assert.equal(result.summary.received, 0);
  assert.equal(result.summary.bankOnly, 0);
});

test("expõe crédito sem par e marca somente texto Stone como indício", () => {
  const result = reconcileStoneReceipts({
    settlements: [],
    bankCredits: [credit({ id: "bank-stone" }), credit({ id: "bank-other", description: "TED CLIENTE" })],
    today: "2026-09-24",
  });
  assert.equal(result.summary.bankOnly, 2);
  assert.equal(result.unmatchedBankCredits.find(item => item.bank.id === "bank-stone")?.stoneOriginLikely, true);
  assert.equal(result.unmatchedBankCredits.find(item => item.bank.id === "bank-other")?.stoneOriginLikely, false);
});

test("valida o limite do recorte antes de consultar Stone ou o extrato", () => {
  const valid = receiptReconciliationRequestSchema.safeParse({ kioskId: "unit-a", stoneCode: "123", from: "2026-09-01", through: "2026-10-01" });
  assert.equal(valid.success, true);
  const invalid = receiptReconciliationRequestSchema.safeParse({ kioskId: "unit-a", stoneCode: "123", from: "2026-09-01", through: "2026-10-02" });
  assert.equal(invalid.success, false);
});
