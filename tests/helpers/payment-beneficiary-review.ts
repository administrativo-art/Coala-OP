import { createHash } from "node:crypto";
import type { PixBankPaymentRequest } from "../../src/features/financial/payment-requests/types";

export const reviewRequest: PixBankPaymentRequest = {
  id: "beneficiary-review-request",
  sourceType: "generated_receipt",
  sourceId: "test-receipt",
  expenseId: "test-expense",
  paymentRail: "pix",
  beneficiaryReference: { sourceType: "employee", sourceId: "test-employee" },
  beneficiarySnapshot: {
    sourceType: "employee", sourceId: "test-employee", name: "Pessoa de teste",
    document: "***.***.***-01",
    documentHash: createHash("sha256").update("12345678901").digest("hex"),
    paymentMethod: "pix_key", maskedPaymentDestination: "••••8901",
    sourceUpdatedAt: "2026-09-01T15:00:00.000Z", resolvedAt: "2026-09-01T15:00:00.000Z",
  },
  amount: 15.95, description: "Pagamento de teste", status: "paid",
  idempotencyKey: "test-key", interRequestId: "test-inter-request", endToEndId: "test-end-to-end",
  statementTransactionId: "test-statement", statementReconciliationStatus: "matched",
  bankReconciliationDivergenceField: "receiver", beneficiaryVerificationStatus: "divergent",
  beneficiaryVerificationWarning: "Divergência anterior do recebedor.",
  beneficiaryVerificationObservedAt: "2026-09-08T18:00:00.000Z",
  paidAt: "2026-09-08T15:00:00.000Z", postPaymentProcessingStatus: "completed",
  proofStoragePath: "test/proof.pdf", sourceCompletedAt: "2026-09-10T15:00:00.000Z",
  createdAt: "2026-09-01T15:00:00.000Z", createdBy: "test", updatedAt: "2026-09-10T15:00:00.000Z",
};

export const reviewStatement = {
  type: "expense_payment", direction: "out", importSource: "inter_api", importedFrom: "bank_statement",
  auditStatus: "resolved", reversed: false,
  expenseId: "test-expense", linkedExpenseId: "test-expense", amount: 15.95,
  bankStatementData: {
    tipoOperacao: "D", tipoTransacao: "PIX",
    detalhes: { codigoSolicitacao: "test-inter-request", endToEndId: "test-end-to-end", cpfCnpjRecebedor: "123.456.789-01" },
  },
};
