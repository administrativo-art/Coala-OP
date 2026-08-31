import assert from "node:assert/strict";
import test from "node:test";

import { applyDocumentEmployerLegalName } from "../../../src/features/hr/documents/document-employer-identity";

test("substitui o nome operacional pela razão social resolvida pelo CNPJ", () => {
  const resolved = {
    data: { integration: { employer_name: "Quiosque Tirirical" } },
    flat: { "integration.employer_name": "Quiosque Tirirical" },
    rawFlat: { "integration.employer_name": "Quiosque Tirirical" },
    missingRequired: ["integration.employer_name", "employee.cpf"],
  };

  const canonical = applyDocumentEmployerLegalName(resolved, " CT Sorvetes LTDA ");

  assert.equal(
    (canonical.data.integration as Record<string, unknown>).employer_name,
    "CT Sorvetes LTDA",
  );
  assert.equal(canonical.flat["integration.employer_name"], "CT Sorvetes LTDA");
  assert.equal(canonical.rawFlat["integration.employer_name"], "CT Sorvetes LTDA");
  assert.deepEqual(canonical.missingRequired, ["employee.cpf"]);
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
