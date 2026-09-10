import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildFinancialInboxSearchTerms,
  financialInboxSearchLookupToken,
  FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
} from "../../src/features/financial/inbox/search-index";
import type { FinancialInboxMessage } from "../../src/features/financial/inbox/types";

function message(): FinancialInboxMessage {
  return {
    id: "message-1",
    workspaceId: "workspace-1",
    provider: "resend",
    providerEmailId: "provider-1",
    providerEventId: "event-1",
    messageId: null,
    status: "reconciled",
    from: "Vivo <contadigitalvivo@vivo.com.br>",
    fromAddress: "contadigitalvivo@vivo.com.br",
    senderDomain: "vivo.com.br",
    to: [],
    originalRecipients: [],
    subject: "A fatura Vivo Móvel chegou",
    receivedAt: "2026-01-01T12:00:00.000Z",
    textPreview: "",
    textContent: "",
    classification: {
      documentType: "utility_bill",
      financeLikely: true,
      confidence: "high",
      supplierName: "Telefônica Brasil S.A.",
      competence: "2025-12",
      dueDate: "2026-01-12",
      amountCents: 19600,
      barcode: null,
      barcodeMasked: null,
      links: [],
      billingIdentity: {
        supplierTaxId: "02558157000162",
        customerAccount: "123456789",
        contractNumber: "987654",
        serviceType: "mobile",
        serviceNumbers: ["+55 (98) 99999-1234"],
      },
    },
    attachments: [],
    rawStoragePath: null,
    rawSha256: null,
    archiveWarnings: [],
    linkedExpenseId: "expense-1",
    reviewedAt: null,
    reviewedBy: null,
    searchIndexVersion: FINANCIAL_INBOX_SEARCH_INDEX_VERSION,
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-02T12:00:00.000Z",
  };
}

test("índice cobre acentos, prefixos, valor, conta e sufixo do telefone", () => {
  const terms = new Set(buildFinancialInboxSearchTerms(message()));
  assert.equal(terms.has("telefonica"), true);
  assert.equal(terms.has("telef"), true);
  assert.equal(terms.has("196"), true);
  assert.equal(terms.has("123456789"), true);
  assert.equal(terms.has("98999991234"), true);
  assert.ok(terms.size <= 600);
});

test("consulta escolhe o termo mais seletivo sem perder busca parcial", () => {
  assert.equal(financialInboxSearchLookupToken("vivo 196"), "vivo");
  assert.equal(financialInboxSearchLookupToken("Telefô"), "telefo");
  assert.equal(financialInboxSearchLookupToken("   "), null);
});

test("Firestore e repositório usam o índice de termos com fallback durante o rollout", () => {
  const indexes = JSON.parse(readFileSync("firestore.financial.indexes.json", "utf8")) as {
    indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; arrayConfig?: string }> }>;
  };
  const repository = readFileSync("src/features/financial/inbox/repository.server.ts", "utf8");
  const searchIndex = indexes.indexes.find((index) => index.collectionGroup === "financialInboxMessages"
    && index.fields.some((field) => field.fieldPath === "searchTerms" && field.arrayConfig === "CONTAINS"));
  assert.ok(searchIndex);
  assert.match(repository, /where\("searchTerms", "array-contains", lookupToken\)/);
  assert.match(repository, /Durante a construção inicial do índice composto/);
  assert.match(repository, /const SUMMARY_FALLBACK_LIMIT = 500/);
  assert.match(repository, /limit\(SUMMARY_FALLBACK_LIMIT \+ 1\)/);
  assert.match(repository, /isMissingFirestoreIndex/);
});

test("resumo possui índice para somar valores por workspace e status", () => {
  const indexes = JSON.parse(readFileSync("firestore.financial.indexes.json", "utf8")) as {
    indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order?: string }> }>;
  };
  const summaryIndex = indexes.indexes.find((index) => index.collectionGroup === "financialInboxMessages"
    && index.fields.map((field) => field.fieldPath).join("|")
      === "status|workspaceId|classification.amountCents");
  assert.ok(summaryIndex);
});
