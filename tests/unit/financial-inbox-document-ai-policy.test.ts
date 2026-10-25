import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseFinancialDocumentAi } from "../../src/features/financial/inbox/document-ai-policy";

const complete = {
  candidate: true, supported: true, subject: "Boleto mensal", senderDomain: "example.org",
  text: "Fornecedor Exemplo CNPJ 64.433.090/0001-97\nCompetência: 10/2026\nVencimento: 31/10/2026\nValor: R$ 10,00",
};

test("IA documental exige candidato, formato suportado e lacuna essencial após parser", () => {
  assert.equal(shouldUseFinancialDocumentAi(complete), false);
  assert.equal(shouldUseFinancialDocumentAi({ ...complete, candidate: false, text: "" }), false);
  assert.equal(shouldUseFinancialDocumentAi({ ...complete, supported: false, text: "" }), false);
  assert.equal(shouldUseFinancialDocumentAi({ ...complete, text: complete.text.replace("Vencimento: 31/10/2026", "") }), true);
});
