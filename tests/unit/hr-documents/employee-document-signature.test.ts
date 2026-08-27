import assert from "node:assert/strict";
import { test } from "node:test";

import { employeeDocumentSignatureIndicator } from "../../../src/lib/hr/employee-document-signature";

test("documento comum não recebe indicador de assinatura", () => {
  assert.equal(employeeDocumentSignatureIndicator({ source: "manual_upload" }), null);
});

test("documento com assinatura exigida mostra pendência enquanto não assinado", () => {
  assert.deepEqual(employeeDocumentSignatureIndicator({ signatureRequired: true }), {
    required: true,
    signed: false,
    statusLabel: "Assinatura pendente",
  });
});

test("documento arquivado pelo fluxo eletrônico aparece como assinado", () => {
  assert.deepEqual(employeeDocumentSignatureIndicator({
    source: "autentique_signature",
    signatureStatus: "signed",
    signedAt: "2026-07-20T13:30:00-03:00",
  }), {
    required: true,
    signed: true,
    statusLabel: "Assinado",
  });
});
