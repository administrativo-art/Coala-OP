import assert from "node:assert/strict";
import test from "node:test";

import { mainPaymentLookupQuery, summarizeMainPaymentLookup } from "../../../scripts/financial/payment-cli-main-query-contract";

test("buscas principais ficam em coleções e campos exatos", () => {
  const entity = mainPaymentLookupQuery("entity-document", "02.911.413/0001-53");
  assert.equal(entity.from[0].collectionId, "entities");
  assert.match(JSON.stringify(entity), /02\.911\.413\/0001-53/);
  assert.equal(mainPaymentLookupQuery("purchase-supplier", "supplier_1").from[0].collectionId, "purchase_orders");
  assert.match(JSON.stringify(mainPaymentLookupQuery("entity-name", "NATUCOPOS")), /fantasyName/);
  assert.match(JSON.stringify(mainPaymentLookupQuery("purchase-supplier-name", "NATUCOPOS")), /supplierName/);
  assert.equal(mainPaymentLookupQuery("purchase-invoice-key", "1".repeat(44)).limit, 26);
  assert.throws(() => mainPaymentLookupQuery("collection", "entities"));
  assert.throws(() => mainPaymentLookupQuery("purchase-supplier", "../users"));
});

test("resumo principal remove campos fora da allowlist", () => {
  const summary = summarizeMainPaymentLookup({ id: "entity_1", name: "Fornecedor", document: "123", privateNote: "segredo" });
  assert.deepEqual(summary, { id: "entity_1", name: "Fornecedor", document: "123" });
});
