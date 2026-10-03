import assert from "node:assert/strict";
import test from "node:test";
import { resolveBankStatementCoverage } from "../../src/features/financial/receipts-reconciliation/receipt-bank-coverage";
import { receiptDayGroups, receiptFilterCount, receiptListRows, receiptRowMatchesFilter } from "../../src/features/financial/receipts-reconciliation/presentation";
import { reconcileStoneReceipts, type BankCreditFact, type StoneReceiptSettlement } from "../../src/features/financial/receipts-reconciliation/reconciliation";

const settlement = (overrides: Partial<StoneReceiptSettlement> = {}): StoneReceiptSettlement => ({
  id: "sale-1:1", transactionId: "sale-1", installment: 1, paymentId: "payment-1", paymentDate: "2026-09-20", expectedPaymentDate: "2026-09-20", saleDate: "2026-09-18", grossAmount: 100, netAmount: 97.5, paymentEventCount: 1, sourceFileId: "file-20", sourceReferenceDate: "2026-09-20", adjustments: [], ...overrides,
});
const credit = (overrides: Partial<BankCreditFact> = {}): BankCreditFact => ({ id: "bank-1", date: "2026-09-21", amount: 97.5, description: "STONE PAGAMENTOS", references: [], externalTransactionId: null, ...overrides });

test("lista de recebimentos mantém filtros e grupos diários derivados dos fatos", () => {
  const result = reconcileStoneReceipts({ settlements: [settlement(), settlement({ id: "sale-2:1", transactionId: "sale-2", paymentDate: "2026-09-21", netAmount: 50 })], bankCredits: [credit(), credit({ id: "bank-only", date: "2026-09-22", amount: 12, description: "PIX CLIENTE" })], today: "2026-09-24" });
  const rows = receiptListRows(result);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, "2026-09-22");
  assert.equal(receiptFilterCount(rows, "received"), 1);
  assert.equal(rows.filter(row => receiptRowMatchesFilter(row, "pending")).length, 1);
  assert.equal(rows.filter(row => receiptRowMatchesFilter(row, "bank_only")).length, 1);
  const groups = receiptDayGroups(rows);
  assert.deepEqual(groups.map(group => group.date), ["2026-09-22", "2026-09-21", "2026-09-20"]);
  assert.equal(groups[0].amount, 12);
});

test("cobertura do extrato indica apenas o alcance da sincronização", () => {
  assert.deepEqual(resolveBankStatementCoverage({ accountId: "a", requiredThrough: "2026-09-22", state: { accountId: "a", lastRangeEnd: "2026-09-22" } }), { status: "complete", requiredThrough: "2026-09-22", syncedThrough: "2026-09-22", syncedAt: null });
  assert.equal(resolveBankStatementCoverage({ accountId: "a", requiredThrough: "2026-09-22", state: { accountId: "a", lastRangeEnd: "2026-09-21" } }).status, "partial");
  assert.equal(resolveBankStatementCoverage({ accountId: "a", requiredThrough: "2026-09-22", state: { accountId: "other", lastRangeEnd: "2026-09-23" } }).status, "unknown");
});
