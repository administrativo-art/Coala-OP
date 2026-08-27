import assert from "node:assert/strict";
import test from "node:test";

import {
  RECEIPT_FORM_SCHEMA,
  resolveDocumentFormSchema,
} from "../../../src/features/hr/documents/document-form-schema";

test("recibo aceita parte avulsa, itens repetíveis e calcula o total", () => {
  const result = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
    receipt: {
      direction: "Recebemos",
      issuer: {
        partyType: "company",
        ref: "company-1",
        snapshot: { name: "Coala", document: "123", email: "emitente@coala.test" },
      },
      recipient: {
        partyType: "external_person",
        ref: null,
        snapshot: { name: "João", document: "123", email: "joao@exemplo.test" },
      },
      items: [
        { name: "Item A", description: "Serviço A", value: 100 },
        { name: "Item B", description: "Serviço B", value: 50.25 },
      ],
      payment: { method: "cash" },
      city: "São Luís",
      state: "MA",
      issueDate: "2026-07-28",
    },
  });
  assert.deepEqual(result.missing, []);
  assert.match(String((result.values.receipt as Record<string, unknown>).total), /150,25/);
  assert.equal(
    ((result.values.receipt as Record<string, unknown>).payment as Record<string, unknown>).methodLabel,
    "Dinheiro",
  );
  assert.equal(result.parties.find((party) => party.role === "recipient")?.snapshot.name, "João");
});

test("campo condicional só é exigido quando aplicável", () => {
  const cash = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
    receipt: {
      recipient: { partyType: "company", snapshot: { name: "Cliente", document: "1" } },
      items: [{ name: "Item", description: "Descrição", value: 10 }],
      payment: { method: "cash" },
    },
  });
  assert.equal(cash.missing.includes("Chave Pix"), false);
  const pix = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
    receipt: {
      recipient: { partyType: "company", snapshot: { name: "Cliente", document: "1" } },
      items: [{ name: "Item", description: "Descrição", value: 10 }],
      payment: { method: "pix" },
    },
  });
  assert.equal(pix.missing.includes("Chave Pix"), true);
});

test("recibo exige UF e canal de assinatura das duas partes", () => {
  const result = resolveDocumentFormSchema(RECEIPT_FORM_SCHEMA, {
    receipt: {
      direction: "Pagamos",
      issuer: {
        partyType: "company",
        snapshot: { name: "Coala", document: "123" },
      },
      recipient: {
        partyType: "external_person",
        snapshot: { name: "João", document: "456", email: "email-invalido" },
      },
      items: [{ name: "Item", description: "Descrição", value: 10 }],
      payment: { method: "cash" },
      city: "São Luís",
      issueDate: "2026-07-30",
    },
  });
  assert.equal(result.missing.includes("Estado (UF)"), true);
  assert.equal(result.missing.includes("Emitente: e-mail para assinatura"), true);
  assert.equal(result.missing.includes("Recebedor: e-mail para assinatura"), true);
});
