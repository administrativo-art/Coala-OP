import assert from "node:assert/strict";
import test from "node:test";

import { chooseProvisionSuggestion } from "../../src/features/financial/inbox/provision-suggestions";
import type { FinancialInboxClassification } from "../../src/features/financial/inbox/types";

const classification: FinancialInboxClassification = {
  documentType: "accounting_fee",
  financeLikely: true,
  confidence: "high",
  supplierName: "Maximus Contabilidade / Grupo MSE",
  competence: "2026-08",
  dueDate: "2026-08-25",
  amountCents: 120000,
  barcode: null,
  barcodeMasked: null,
  links: [],
};

test("sugere uma única provisão com competência, tipo, valor e fornecedor compatíveis", () => {
  const suggestion = chooseProvisionSuggestion(classification, [{
    id: "forecast-1",
    description: "Honorário contábil - Maximus | Matriz",
    supplier: "Maximus Contabilidade / Grupo MSE",
    provisionSeriesKey: "recurring:honorario-contabil:maximus:matriz",
    provisionCompetence: "2026-08",
    totalValue: 1200,
    dueDate: new Date("2026-08-25T12:00:00-03:00"),
  }], "2026-08-24T12:00:00.000Z");

  assert.equal(suggestion.status, "suggested");
  assert.equal(suggestion.provisionExpenseId, "forecast-1");
  assert.equal(suggestion.confidence, "high");
  assert.ok((suggestion.score || 0) >= 80);
});

test("não escolhe arbitrariamente entre duas provisões equivalentes", () => {
  const base = {
    description: "Honorário contábil - Maximus",
    provisionCompetence: "2026-08",
    totalValue: 1200,
  };
  const suggestion = chooseProvisionSuggestion(classification, [
    { id: "forecast-a", ...base },
    { id: "forecast-b", ...base },
  ]);
  assert.equal(suggestion.status, "ambiguous");
  assert.equal(suggestion.provisionExpenseId, null);
});

test("ignora provisões de outra competência", () => {
  const suggestion = chooseProvisionSuggestion(classification, [{
    id: "forecast-old",
    description: "Honorário contábil",
    provisionCompetence: "2026-07",
    totalValue: 1200,
  }]);
  assert.equal(suggestion.status, "not_found");
});
