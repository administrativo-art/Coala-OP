import assert from "node:assert/strict";
import test from "node:test";

import {
  FinancialServiceInboxPreparationIneligibleError,
  planFinancialServiceInboxPreparation,
} from "../../../src/features/financial/payment-requests/service-inbox-orchestration-policy";
import type { FinancialInboxMessage } from "../../../src/features/financial/inbox/types";

const sourceId = "vivo_source_123";
const allowedSourceIds = new Set([sourceId]);

function message(patch: Partial<FinancialInboxMessage> = {}): FinancialInboxMessage {
  return {
    id: sourceId,
    workspaceId: "coala",
    provider: "resend",
    providerEmailId: "email_123",
    providerEventId: "event_123",
    messageId: null,
    status: "suggestion_available",
    from: "Vivo",
    fromAddress: "cobranca@vivo.com.br",
    senderDomain: "vivo.com.br",
    to: ["cobrancas@entrada.coalashakes.com"],
    originalRecipients: ["cobrancas@entrada.coalashakes.com"],
    subject: "Fatura Vivo",
    receivedAt: "2026-10-16T12:00:00.000Z",
    textPreview: "Fatura Vivo",
    textContent: "Fatura Vivo",
    classification: {
      documentType: "utility_bill",
      financeLikely: true,
      confidence: "high",
      supplierName: "Vivo",
      competence: "2026-10",
      dueDate: "2026-10-25",
      amountCents: 49_900,
      barcode: "8".repeat(48),
      barcodeMasked: "********",
      links: [],
      billingIdentity: {
        supplierTaxId: "02558157000405",
        customerAccount: "conta_123",
        contractNumber: null,
        serviceType: "mobile",
        serviceNumbers: ["91999999999"],
      },
    },
    attachments: [],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: null,
    paymentRequestId: null,
    existingBankPayment: null,
    existingSettlement: null,
    existingExpenseSuggestion: {
      status: "suggested",
      expenseId: "expense_vivo_123",
      installmentNumber: null,
      installmentTotal: null,
      description: "Vivo",
      supplier: "Vivo",
      amountCents: 49_900,
      dueDate: "2026-10-25",
      reasons: ["valor e vencimento conferem"],
      paymentState: "needs_scheduling",
      existingBankPayment: null,
      existingSettlement: null,
    },
    provisionSuggestion: null,
    creationSuggestion: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: "2026-10-16T12:00:00.000Z",
    updatedAt: "2026-10-16T12:00:00.000Z",
    ...patch,
  };
}

function plan(candidate: FinancialInboxMessage) {
  return planFinancialServiceInboxPreparation({
    message: candidate,
    sourceId,
    allowedSourceIds,
    workspaceId: "coala",
    today: "2026-10-16",
  });
}

function rejected(candidate: FinancialInboxMessage, pattern: RegExp) {
  assert.throws(() => plan(candidate), (error: unknown) => (
    error instanceof FinancialServiceInboxPreparationIneligibleError && pattern.test(error.message)
  ));
}

test("backend vincula somente a despesa real única e aberta", () => {
  assert.deepEqual(plan(message()), {
    kind: "existing_expense",
    expenseId: "expense_vivo_123",
    installmentNumber: null,
    barcode: "8".repeat(48),
    dueDate: "2026-10-25",
    amountCents: 49_900,
  });
  rejected(message({ existingExpenseSuggestion: { ...message().existingExpenseSuggestion!, paymentState: "scheduled" } }), /única/);
});

test("backend pode materializar somente uma previsão única", () => {
  const candidate = message({
    existingExpenseSuggestion: { ...message().existingExpenseSuggestion!, status: "not_found", expenseId: null, paymentState: null },
    provisionSuggestion: {
      status: "suggested",
      provisionExpenseId: "forecast_vivo_123",
      confidence: "high",
      score: 90,
      reasons: ["fornecedor e competência conferem"],
      description: "Vivo",
      supplier: "Vivo",
      competence: "2026-10",
      dueDate: "2026-10-25",
      provisionedAmountCents: 49_900,
      checkedAt: "2026-10-16T12:00:00.000Z",
    },
  });
  assert.equal(plan(candidate).kind, "provision");
});

test("backend bloqueia CNPJ, limite, vencimento e cadastro contábil incertos", () => {
  rejected(message({ classification: { ...message().classification, billingIdentity: { ...message().classification.billingIdentity!, supplierTaxId: "11222333000181" } } }), /Vivo/);
  rejected(message({ classification: { ...message().classification, amountCents: 500_001 } }), /limite/);
  rejected(message({ classification: { ...message().classification, dueDate: "2026-10-15" } }), /vencida/);
  rejected(message({
    existingExpenseSuggestion: { ...message().existingExpenseSuggestion!, status: "not_found", expenseId: null, paymentState: null },
    creationSuggestion: {
      status: "suggested",
      description: "Vivo",
      supplier: "Vivo",
      amountCents: 49_900,
      dueDate: "2026-10-25",
      competence: "2026-10",
      billingIdentity: message().classification.billingIdentity!,
      missingFields: [],
      reasons: ["nenhuma despesa encontrada"],
    },
  }), /classificação contábil/);
});
