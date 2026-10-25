import assert from "node:assert/strict";
import test from "node:test";

import { groupFinancialInboxMessages } from "../../src/features/financial/inbox/message-groups";
import type { FinancialInboxMessage } from "../../src/features/financial/inbox/types";

function message(overrides: Partial<FinancialInboxMessage>): FinancialInboxMessage {
  return {
    id: "message-1",
    workspaceId: "workspace",
    provider: "resend",
    providerEmailId: "provider-1",
    providerEventId: "event-1",
    messageId: null,
    status: "identified",
    from: "supplier@example.com",
    fromAddress: "supplier@example.com",
    senderDomain: "example.com",
    to: [],
    originalRecipients: [],
    subject: "Cobrança",
    receivedAt: "2026-09-08T12:00:00.000Z",
    textPreview: "",
    textContent: "",
    classification: {
      documentType: "charge",
      financeLikely: true,
      confidence: "high",
      supplierName: "Fornecedor",
      competence: "2026-09",
      dueDate: "2026-09-25",
      amountCents: 10000,
      barcode: null,
      barcodeMasked: null,
      links: [],
    },
    attachments: [],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: null,
    reviewedAt: null,
    reviewedBy: null,
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

test("agrupa cobrança e lembrete pela mesma obrigação e mantém a cobrança como principal", () => {
  const primary = message({
    id: "charge",
    obligationId: "obligation-1",
    linkedExpenseId: "expense-1",
    resolution: {
      status: "identified",
      kind: "new_charge",
      targetType: "expense",
      targetId: "expense-1",
      installmentNumber: null,
      financialState: "open",
      mode: "manual",
      confidence: "high",
      reasons: [],
      resolvedAt: "2026-09-08T12:00:00.000Z",
      resolvedBy: "user",
    },
  });
  const reminder = message({
    id: "reminder",
    obligationId: "obligation-1",
    thread: { primaryMessageId: "other-thread", messageCount: 1, messages: [] },
    receivedAt: "2026-09-10T12:00:00.000Z",
    resolution: {
      ...primary.resolution!,
      kind: "reminder",
      resolvedAt: "2026-09-10T12:00:00.000Z",
    },
  });

  const groups = groupFinancialInboxMessages([reminder, primary]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.id, "charge");
  assert.equal(groups[0].messageCount, 2);
  assert.deepEqual(groups[0].messages.map((entry) => entry.id), ["charge", "reminder"]);
});

test("a obrigação prevalece sobre conversas de e-mail diferentes", () => {
  const groups = groupFinancialInboxMessages([
    message({ id: "one", obligationId: "obligation-1", thread: { primaryMessageId: "thread-a", messageCount: 1, messages: [] } }),
    message({ id: "two", obligationId: "obligation-1", thread: { primaryMessageId: "thread-b", messageCount: 1, messages: [] } }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].messageCount, 2);
  assert.deepEqual(groups[0].messages.map((entry) => entry.id), ["one", "two"]);
});

test("não agrupa parcelas diferentes da mesma obrigação", () => {
  const groups = groupFinancialInboxMessages([
    message({ id: "one", obligationId: "obligation-1", classification: { ...message({}).classification, installmentNumber: 1, installmentTotal: 2 } }),
    message({ id: "two", obligationId: "obligation-1", classification: { ...message({}).classification, installmentNumber: 2, installmentTotal: 2 } }),
  ]);
  assert.equal(groups.length, 2);
});

test("agrupa mensagens do mesmo pedido bancário mesmo quando vieram em conversas diferentes", () => {
  const groups = groupFinancialInboxMessages([
    message({ id: "one", paymentRequestId: "request-1", thread: { primaryMessageId: "thread-a", messageCount: 1, messages: [] } }),
    message({ id: "two", paymentRequestId: "request-1", thread: { primaryMessageId: "thread-b", messageCount: 1, messages: [] } }),
  ]);
  assert.equal(groups.length, 1);
});

test("linha digitável prevalece quando registros legados criaram obrigações diferentes", () => {
  const barcode = "8".repeat(48);
  const groups = groupFinancialInboxMessages([
    message({ id: "one", obligationId: "obligation-1", classification: { ...message({}).classification, barcode } }),
    message({ id: "two", obligationId: "obligation-2", receivedAt: "2026-09-09T12:00:00.000Z", classification: { ...message({}).classification, barcode } }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].messageCount, 2);
});

test("não agrupa cobranças do mesmo fornecedor por valor, competência ou vencimento", () => {
  const groups = groupFinancialInboxMessages([
    message({ id: "september" }),
    message({ id: "october", receivedAt: "2026-10-08T12:00:00.000Z", classification: { ...message({}).classification, competence: "2026-10", dueDate: "2026-10-25" } }),
  ]);
  assert.equal(groups.length, 2);
});

test("usa a conversa apenas quando não existe identidade financeira forte", () => {
  const thread = { primaryMessageId: "thread-1", messageCount: 2, messages: [] };
  const groups = groupFinancialInboxMessages([
    message({ id: "one", thread }),
    message({ id: "two", thread, receivedAt: "2026-09-09T12:00:00.000Z" }),
  ]);
  assert.equal(groups.length, 1);
});

test("não agrupa mensagens sem obrigação ou despesa comum", () => {
  const groups = groupFinancialInboxMessages([
    message({ id: "one" }),
    message({ id: "two", receivedAt: "2026-09-09T12:00:00.000Z" }),
  ]);
  assert.equal(groups.length, 2);
});
