import assert from "node:assert/strict";
import test from "node:test";

import { buildGeneratedDocumentAudit } from "../../../src/features/hr/documents/generated-document-audit";

test("registra valor renderizado, origem e versões sem repetir bruto sensível", () => {
  const { audit } = buildGeneratedDocumentAudit({
    variables: ["employee.name", "employee.bank_account", "receipt_note"],
    mapping: {
      receipt_note: {
        kind: "manual",
        label: "Observação",
        format: "text",
        required: false,
      },
    },
    data: {
      employee: { name: "MARIA", bank_account: "000123-4" },
      receipt_note: "Quitado",
    },
    flat: {
      "employee.name": "MARIA",
      "employee.bank_account": "000123-4",
    },
    rawFlat: {
      "employee.name": "MARIA",
      "employee.bank_account": "000123-4",
    },
    manualValues: { receipt_note: "Quitado" },
    resolvedAt: "2026-07-28T00:00:00.000Z",
  });

  assert.equal(audit.values["employee.name"].renderedValue, "MARIA");
  assert.equal(audit.values["employee.bank_account"].sensitive, true);
  assert.equal(audit.values["employee.bank_account"].rawValue, null);
  assert.equal(audit.values.receipt_note.sourceType, "manual");
  assert.equal(audit.catalogVersion, "coala-documents-v2");
});
