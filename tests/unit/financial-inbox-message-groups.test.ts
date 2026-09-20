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

test("não agrupa mensagens sem obrigação ou despesa comum", () => {
  const groups = groupFinancialInboxMessages([
    message({ id: "one" }),
    message({ id: "two", receivedAt: "2026-09-09T12:00:00.000Z" }),
  ]);
  assert.equal(groups.length, 2);
});
