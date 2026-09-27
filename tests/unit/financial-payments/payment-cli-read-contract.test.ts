import assert from "node:assert/strict";
import test from "node:test";
import { paymentReadPath, summarizePaymentRead } from "../../../scripts/financial/payment-cli-read-contract";
import { paymentLookupQuery, decodeFirestoreValue } from "../../../scripts/financial/payment-cli-query-contract";

test("lookup fixa campo, igualdade, limite e recusa consultas arbitrárias", () => {
  const query = paymentLookupQuery("expense-amount", "300000");
  assert.equal(query.limit, 26);
  assert.deepEqual(query.from, [{ collectionId: "expenses" }]);
  assert.deepEqual(query.where.fieldFilter?.value, { doubleValue: 3000 });
  assert.equal(paymentLookupQuery("expense-account", "account_1").where.fieldFilter?.field.fieldPath, "accountPlan");
  assert.equal(paymentLookupQuery("expense-account-center", "account_1:center_1").where.compositeFilter?.filters.length, 2);
  assert.equal(paymentLookupQuery("expense-unit-month", "unit_1:center_1:2026-10").limit, 26);
  assert.throws(() => paymentLookupQuery("expense-unit-month", "unit_1:center_1:2026-13"));
  const dueQuery = paymentLookupQuery("expense-center-due-month", "Quiosque Shopping do Automóvel|2026-10");
  assert.match(JSON.stringify(dueQuery), /2026-10-01T03:00:00.000Z/);
  assert.match(JSON.stringify(dueQuery), /2026-11-01T03:00:00.000Z/);
  assert.throws(() => paymentLookupQuery("expense-center-due-month", "Centro|2026-13"));
  assert.throws(() => paymentLookupQuery("all", "expenses"));
  assert.throws(() => paymentLookupQuery("payment-barcode", "0".repeat(47)));
  assert.throws(() => paymentLookupQuery("inbox-barcode", "0".repeat(47)));
  assert.throws(() => paymentLookupQuery("expense-amount", "-1"));
  assert.throws(() => paymentLookupQuery("expense-supplier", "../users"));
  assert.deepEqual(decodeFirestoreValue({ mapValue: { fields: { totalValue: { doubleValue: 3000 } } } }), { totalValue: 3000 });
});

test("consultas CLI exigem filtro limitado ou ID exato, sem coleção aberta", () => {
  assert.match(paymentReadPath({ command: "find", query: "Oceanos" }), /q=Oceanos&view=work&limit=25/);
  assert.match(paymentReadPath({ command: "document", collection: "expenses", id: "expense_123" }), /expenses%2Fexpense_123/);
  for (const input of [
    { command: "find", query: "" }, { command: "find", query: "Oceanos", view: "all" },
    { command: "document", collection: "users", id: "user_1" },
    { command: "document", collection: "expenses", id: "../users" },
    { command: "document", collection: "expenses", id: "" },
  ]) assert.throws(() => paymentReadPath(input));
});

test("saída minimiza mensagens e explicita cobertura parcial", () => {
  const output = summarizePaymentRead("find", { messages: [{ id: "inbox_1", bodyText: "private",
    attachments: [{ filename: "boleto.pdf", extractedHints: { amountCents: 300000, documentText: "private" } }] }],
    nextCursor: "next", searchTruncated: true });
  assert.doesNotMatch(JSON.stringify(output), /private/);
  assert.match(JSON.stringify(output), /não comprova inexistência/);
  assert.equal(output.nextCursor, "next");
  assert.equal(output.searchTruncated, true);
});
