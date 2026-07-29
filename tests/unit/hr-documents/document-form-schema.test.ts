import assert from "node:assert/strict";
import test from "node:test";

import {
  RECEIPT_FORM_SCHEMA,
  resolveDocumentFormSchema,
} from "../../../src/features/hr/documents/document-form-schema";

test("recibo aceita parte avulsa, itens repetíveis e calcula o total", () => {
  const result = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
    receipt: {
      direction: "Recebemos de",
      issuer: {
        partyType: "company",
        ref: "company-1",
        snapshot: { name: "Coala", document: "123" },
      },
      recipient: {
        partyType: "external_person",
        ref: null,
        snapshot: { name: "João", document: "123" },
      },
      items: [
        { description: "Serviço A", value: 100 },
        { description: "Serviço B", value: 50.25 },
      ],
      payment: { method: "cash" },
      city: "São Luís/MA",
      issueDate: "2026-07-28",
    },
  });
  assert.deepEqual(result.missing, []);
  assert.match(String((result.values.receipt as Record<string, unknown>).total), /150,25/);
  assert.equal(result.parties.find((party) => party.role === "recipient")?.snapshot.name, "João");
});

test("campo condicional só é exigido quando aplicável", () => {
  const cash = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
    receipt: {
      recipient: { partyType: "company", snapshot: { name: "Cliente", document: "1" } },
      items: [{ description: "Item", value: 10 }],
      payment: { method: "cash" },
    },
  });
  assert.equal(cash.missing.includes("Chave Pix"), false);
  const pix = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
    receipt: {
      recipient: { partyType: "company", snapshot: { name: "Cliente", document: "1" } },
      items: [{ description: "Item", value: 10 }],
      payment: { method: "pix" },
    },
  });
  assert.equal(pix.missing.includes("Chave Pix"), true);
});
