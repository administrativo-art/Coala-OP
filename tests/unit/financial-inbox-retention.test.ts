import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { financialInboxRetentionPlan } from "../../src/features/financial/inbox/retention-policy";
import type { FinancialInboxMessage } from "../../src/features/financial/inbox/types";

function treated(overrides: Partial<FinancialInboxMessage> = {}): FinancialInboxMessage {
  return {
    id: "message-1",
    workspaceId: "workspace-1",
    provider: "resend",
    providerEmailId: "provider-1",
    providerEventId: "event-1",
    messageId: null,
    status: "reconciled",
    from: "Fornecedor <financeiro@example.com>",
    fromAddress: "financeiro@example.com",
    senderDomain: "example.com",
    to: [],
    originalRecipients: [],
    subject: "Cobrança",
    receivedAt: "2025-01-01T12:00:00.000Z",
    textPreview: "",
    textContent: "",
    classification: {
      documentType: "charge",
      financeLikely: true,
      confidence: "high",
      supplierName: "Fornecedor",
      competence: "2025-01",
      dueDate: "2025-02-01",
      amountCents: 10000,
      barcode: null,
      barcodeMasked: null,
      links: [],
    },
    attachments: [],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: "expense-1",
    reviewedAt: null,
    reviewedBy: null,
    createdAt: "2025-01-01T12:00:00.000Z",
    updatedAt: "2025-02-01T12:00:00.000Z",
    ...overrides,
  };
}

test("arquiva somente tratado há pelo menos seis meses", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");
  assert.equal(financialInboxRetentionPlan(treated({ status: "linked" }), now), null);
  assert.equal(financialInboxRetentionPlan(treated({ updatedAt: "2026-04-01T12:00:00.000Z" }), now), null);
  assert.equal(financialInboxRetentionPlan(treated(), now)?.archivedFromStatus, "reconciled");
});

test("aplica um, seis e dez anos conforme a categoria", () => {
  const now = new Date("2026-09-09T12:00:00.000Z");
  const standard = financialInboxRetentionPlan(treated(), now);
  const nonFinancial = financialInboxRetentionPlan(treated({
    status: "ignored",
    classification: { ...treated().classification, financeLikely: false, marketingLikely: true },
  }), now);
  const tax = financialInboxRetentionPlan(treated({
    classification: { ...treated().classification, documentType: "tax" },
  }), now);
  assert.equal(standard?.retentionClass, "financial_standard");
  assert.match(standard?.purgeEligibleAt ?? "", /^2031-02-01/);
  assert.equal(nonFinancial?.retentionClass, "non_financial");
  assert.match(nonFinancial?.purgeEligibleAt ?? "", /^2026-02-01/);
  assert.equal(tax?.retentionClass, "tax_or_payroll");
  assert.match(tax?.purgeEligibleAt ?? "", /^2035-02-01/);
});

test("manutenção é seca por padrão, transacional e não apaga documentos", () => {
  const source = readFileSync("src/features/financial/inbox/maintenance.server.ts", "utf8");
  const scheduled = readFileSync("functions/src/financial-inbox-jobs.ts", "utf8");
  assert.match(source, /const dryRun = params\.dryRun !== false/);
  assert.match(source, /runTransaction\(async \(transaction\) =>/);
  assert.match(source, /MESSAGE_ARCHIVED_BY_RETENTION/);
  assert.doesNotMatch(source, /\.delete\(/);
  assert.match(scheduled, /schedule: '20 2 \* \* \*'/);
  assert.match(scheduled, /timeZone: 'America\/Belem'/);
  assert.match(scheduled, /process\.env\.FINANCIAL_INBOX_MAINTENANCE_URL\?\.trim\(\)/);
  assert.doesNotMatch(scheduled, /defineString\('FINANCIAL_INBOX_MAINTENANCE_URL'/);
  assert.match(scheduled, /body: JSON\.stringify\(\{ mode: 'execute', batchSize: 300 \}\)/);
});
