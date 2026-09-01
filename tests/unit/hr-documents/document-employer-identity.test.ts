import assert from "node:assert/strict";
import test from "node:test";

import { applyDocumentEmployerLegalName } from "../../../src/features/hr/documents/document-employer-identity";

test("exibe razão social e nome fantasia resolvidos pelo CNPJ", () => {
  const resolved = {
    data: { integration: { employer_name: "Quiosque Tirirical" } },
    flat: { "integration.employer_name": "Quiosque Tirirical" },
    rawFlat: { "integration.employer_name": "Quiosque Tirirical" },
    missingRequired: ["integration.employer_name", "employee.cpf"],
  };

  const canonical = applyDocumentEmployerLegalName(
    resolved,
    " C T SORVETES LTDA ",
    " Quiosque Tirirical ",
  );

  assert.equal(
    (canonical.data.integration as Record<string, unknown>).employer_name,
    "C T SORVETES LTDA, nome fantasia Quiosque Tirirical",
  );
  assert.equal(
    canonical.flat["integration.employer_name"],
    "C T SORVETES LTDA, nome fantasia Quiosque Tirirical",
  );
  assert.equal(
    canonical.flat["integration.employer_legal_name"],
    "C T SORVETES LTDA",
  );
  assert.equal(
    canonical.rawFlat["integration.employer_name"],
    "C T SORVETES LTDA, nome fantasia Quiosque Tirirical",
  );
  assert.deepEqual(canonical.missingRequired, ["employee.cpf"]);
});

test("não duplica o nome quando razão social e fantasia são iguais", () => {
  const resolved = {
    data: { integration: { employer_name: "C T Sorvetes Ltda" } },
    flat: { "integration.employer_name": "C T Sorvetes Ltda" },
    rawFlat: { "integration.employer_name": "C T Sorvetes Ltda" },
    missingRequired: [],
  };

  applyDocumentEmployerLegalName(resolved, "C T SORVETES LTDA", "c t sorvetes ltda");

  assert.equal(
    (resolved.data.integration as Record<string, unknown>).employer_name,
    "C T SORVETES LTDA",
  );
});

test("preserva o valor original quando a razão social não foi localizada", () => {
  const resolved = {
    data: { integration: { employer_name: "Quiosque Tirirical" } },
    flat: { "integration.employer_name": "Quiosque Tirirical" },
    rawFlat: { "integration.employer_name": "Quiosque Tirirical" },
    missingRequired: [],
  };

  applyDocumentEmployerLegalName(resolved, null);

  assert.equal(
    (resolved.data.integration as Record<string, unknown>).employer_name,
    "Quiosque Tirirical",
  );
});
