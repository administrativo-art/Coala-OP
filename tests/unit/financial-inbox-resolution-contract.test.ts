import assert from "node:assert/strict";
import test from "node:test";

import {
  automaticReminderResolutionPatch,
  isStrongAutomaticExpenseMatch,
  resolutionForDisplay,
  restoredFinancialInboxResolution,
  financialInboxResolutionMigrationComplete,
  FINANCIAL_INBOX_RESOLUTION_VERSION,
} from "../../src/features/financial/inbox/resolution-contract";
import type { FinancialInboxExpenseSuggestion, FinancialInboxMessage } from "../../src/features/financial/inbox/types";

function suggestion(overrides: Partial<FinancialInboxExpenseSuggestion> = {}): FinancialInboxExpenseSuggestion {
  return {
    status: "suggested",
    expenseId: "expense-1",
    installmentNumber: 2,
    installmentTotal: 3,
    description: "Compra Marvi | NF 872460",
    supplier: "Marvi Alimentos",
    amountCents: 113884,
    dueDate: "2026-09-14",
    reasons: ["mesmo documento/NF 872460", "mesmo valor", "mesmo vencimento"],
    paymentState: "scheduled",
    existingBankPayment: {
      transactionId: "inter-1",
      bankStatus: "AGENDADO",
      schedulingStatus: "scheduled",
      scheduledFor: "2026-09-14",
    },
    existingSettlement: null,
    matchStrength: "document",
    automaticLinkEligible: true,
    automaticLinkPolicyVersion: 1,
    automaticLinkReasons: ["CNPJ, NF/documento, parcela, valor e vencimento idênticos"],
    alternatives: [],
    ...overrides,
  };
}

test("identifica automaticamente apenas correspondência aprovada pela política documental", () => {
  assert.equal(isStrongAutomaticExpenseMatch(suggestion()), true);
  assert.equal(isStrongAutomaticExpenseMatch(suggestion({ automaticLinkEligible: false })), false);
  assert.equal(isStrongAutomaticExpenseMatch(suggestion({ automaticLinkPolicyVersion: null })), false);
  assert.equal(isStrongAutomaticExpenseMatch(suggestion({ status: "ambiguous", expenseId: null })), false);
});

test("lembrete automático referencia a despesa sem criar vínculo financeiro principal", () => {
  const patch = automaticReminderResolutionPatch({
    suggestion: suggestion(),
    at: "2026-09-11T14:00:00.000Z",
  });

  assert.equal(patch?.status, "identified");
  assert.equal(patch?.bankState, "scheduled");
  assert.equal(patch?.resolution.kind, "reminder");
  assert.equal(patch?.resolution.targetId, "expense-1");
  assert.equal(patch?.resolution.installmentNumber, 2);
  assert.equal(patch?.resolution.financialState, "scheduled");
  assert.equal("linkedExpenseId" in (patch ?? {}), false);
});

test("liquidação confirmada no extrato é preservada como estado conciliado", () => {
  const patch = automaticReminderResolutionPatch({
    suggestion: suggestion({
      paymentState: "paid",
      existingBankPayment: null,
      existingSettlement: { transactionId: "statement-1", paidAt: "2026-09-10" },
    }),
    at: "2026-09-11T14:00:00.000Z",
  });

  assert.equal(patch?.bankState, "reconciled");
  assert.equal(patch?.resolution.financialState, "reconciled");
});

test("pagamento aguardando aprovação não é apresentado como agendado", () => {
  const patch = automaticReminderResolutionPatch({
    suggestion: suggestion({
      existingBankPayment: {
        transactionId: "inter-approval-1",
        bankStatus: "AGUARDANDO_APROVACAO",
        schedulingStatus: "awaiting_approval",
        scheduledFor: "2026-09-14",
      },
    }),
    at: "2026-09-11T14:00:00.000Z",
  });

  assert.equal(patch?.bankState, "awaiting_bank_approval");
  assert.equal(patch?.resolution.financialState, "payment_prepared");
});

test("pedido ainda pronto para envio ou desconhecido nunca é inferido como agendado", () => {
  const ready = automaticReminderResolutionPatch({
    suggestion: suggestion({
      existingBankPayment: {
        transactionId: "request-ready-1",
        bankStatus: null,
        schedulingStatus: "ready_to_submit",
        scheduledFor: "2026-09-14",
      },
    }),
    at: "2026-09-11T14:00:00.000Z",
  });
  const unknown = automaticReminderResolutionPatch({
    suggestion: suggestion({
      existingBankPayment: {
        transactionId: "request-unknown-1",
        bankStatus: "STATUS_NOVO",
        schedulingStatus: null,
        scheduledFor: "2026-09-14",
      },
    }),
    at: "2026-09-11T14:00:00.000Z",
  });

  assert.equal(ready?.bankState, "ready_to_submit");
  assert.equal(ready?.resolution.financialState, "payment_prepared");
  assert.equal(unknown?.bankState, "not_prepared");
  assert.equal(unknown?.resolution.financialState, "payment_prepared");
});

test("mensagens legadas vinculadas continuam aparecendo como identificadas", () => {
  const resolution = resolutionForDisplay({
    status: "linked",
    resolution: null,
    linkedExpenseId: "expense-legacy",
    linkedProvisionId: null,
    existingExpenseSuggestion: suggestion({ expenseId: "expense-legacy", matchStrength: null }),
    reviewedAt: "2026-09-10T12:00:00.000Z",
    reviewedBy: "user-1",
  } as Pick<FinancialInboxMessage, "status" | "resolution" | "linkedExpenseId" | "linkedProvisionId" | "existingExpenseSuggestion" | "reviewedAt" | "reviewedBy">);

  assert.equal(resolution.status, "identified");
  assert.equal(resolution.kind, "reminder");
  assert.equal(resolution.targetId, "expense-legacy");
});

test("normaliza resolução parcial criada por transições de registros legados", () => {
  const resolution = resolutionForDisplay({
    status: "scheduled",
    resolution: { status: "identified", financialState: "scheduled" } as FinancialInboxMessage["resolution"],
    linkedExpenseId: "expense-legacy",
    linkedProvisionId: null,
    existingExpenseSuggestion: null,
    reviewedAt: null,
    reviewedBy: null,
  });

  assert.equal(resolution.status, "identified");
  assert.equal(resolution.financialState, "scheduled");
  assert.deepEqual(resolution.reasons, []);
  assert.equal(resolution.kind, "reminder");
});

test("backfill distingue autorização pendente de pagamento agendado", () => {
  const resolution = resolutionForDisplay({
    status: "awaiting_authorization",
    resolution: null,
    linkedExpenseId: "expense-legacy",
    linkedProvisionId: null,
    existingExpenseSuggestion: null,
    reviewedAt: null,
    reviewedBy: null,
  });

  assert.equal(resolution.status, "identified");
  assert.equal(resolution.financialState, "payment_prepared");
});

test("backfill preserva a natureza e a liquidação de registro legado arquivado", () => {
  const resolution = resolutionForDisplay({
    status: "archived",
    resolution: null,
    linkedExpenseId: "expense-legacy",
    linkedProvisionId: null,
    existingExpenseSuggestion: null,
    reviewedAt: "2026-01-10T12:00:00.000Z",
    reviewedBy: "user-1",
    archivedFromStatus: "reconciled",
  });

  assert.equal(resolution.status, "archived");
  assert.equal(resolution.kind, "reminder");
  assert.equal(resolution.targetId, "expense-legacy");
  assert.equal(resolution.financialState, "reconciled");
});

test("restauração recompõe objeto inteiro, inclusive vínculo e quitação", () => {
  const archived = {
    status: "archived", archivedFromStatus: "identified", linkedExpenseId: "expense-1",
    resolution: { status: "archived", kind: "reminder", targetType: "expense", targetId: "expense-1",
      financialState: "reconciled", mode: "automatic", reasons: ["MATCH_CONFIRMED"] },
  } as FinancialInboxMessage;
  const restored = restoredFinancialInboxResolution(archived, "identified");
  assert.equal(restored.status, "identified");
  assert.equal(restored.targetId, "expense-1");
  assert.equal(restored.financialState, "reconciled");
  assert.deepEqual(restored.reasons, ["MATCH_CONFIRMED"]);
});

test("ignored legado entra em descarte manual somente após migração v2 concluída", () => {
  const legacy = { status: "ignored", resolution: { status: "discarded" }, linkedExpenseId: null } as FinancialInboxMessage;
  const normalized = resolutionForDisplay(legacy);
  assert.equal(normalized.mode, "manual");
  assert.deepEqual(normalized.reasons, ["LEGACY_DISCARD_ORIGIN_UNKNOWN"]);
  assert.equal(financialInboxResolutionMigrationComplete(null), false);
  assert.equal(financialInboxResolutionMigrationComplete({ complete: true, version: 1 }), false);
  assert.equal(financialInboxResolutionMigrationComplete({ complete: false, version: FINANCIAL_INBOX_RESOLUTION_VERSION }), false);
  assert.equal(financialInboxResolutionMigrationComplete({ complete: true, version: FINANCIAL_INBOX_RESOLUTION_VERSION }), true);
});
