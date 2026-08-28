import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNTANT_REGISTRY_MAX_FILE_SIZE,
  accountantRhRegistryUploadPreflight,
  validateAccountantRegistryPdf,
} from "../../../src/features/hr/accountant/registry-upload";

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function readyProcess(overrides: Record<string, unknown> = {}) {
  return {
    currentStage: "accountant",
    accountantWorkflow: {
      latestFormId: "form-v1",
      formValidation: { documentId: "form-v1" },
      documentSelection: { documentId: "form-v1" },
    },
    ...overrides,
  };
}

test("aceita somente PDF real de até 15 MB", () => {
  assert.deepEqual(validateAccountantRegistryPdf({
    mimeType: "application/pdf",
    size: pdfBytes.length,
    bytes: pdfBytes,
  }), { ok: true });
  assert.equal(validateAccountantRegistryPdf({
    mimeType: "image/jpeg",
    size: pdfBytes.length,
    bytes: pdfBytes,
  }).ok, false);
  assert.equal(validateAccountantRegistryPdf({
    mimeType: "application/pdf",
    size: ACCOUNTANT_REGISTRY_MAX_FILE_SIZE + 1,
    bytes: pdfBytes,
  }).ok, false);
  assert.equal(validateAccountantRegistryPdf({
    mimeType: "application/pdf",
    size: 8,
    bytes: new Uint8Array(8),
  }).ok, false);
});

test("upload do RH exige a etapa do contador e as duas fases anteriores concluídas", () => {
  assert.deepEqual(accountantRhRegistryUploadPreflight(readyProcess()), {
    ok: true,
    unchanged: false,
  });
  assert.equal(accountantRhRegistryUploadPreflight(readyProcess({ currentStage: "document_review" })).ok, false);
  assert.equal(accountantRhRegistryUploadPreflight(readyProcess({
    accountantWorkflow: {
      latestFormId: "form-v1",
      formValidation: { documentId: "form-v1" },
    },
  })).ok, false);
});

test("envio de e-mail legado também comprova a seleção do pacote", () => {
  assert.deepEqual(accountantRhRegistryUploadPreflight(readyProcess({
    accountantWorkflow: {
      latestFormId: "form-v1",
      formValidation: { documentId: "form-v1" },
      email: { sentAt: "2026-08-25T13:54:00.000Z" },
    },
  })), { ok: true, unchanged: false });
});

test("não substitui uma ficha recebida e trata conclusão repetida como idempotente", () => {
  assert.equal(accountantRhRegistryUploadPreflight(readyProcess({
    accountantWorkflow: {
      latestFormId: "form-v1",
      formValidation: { documentId: "form-v1" },
      documentSelection: { documentId: "form-v1" },
      registryDocument: { status: "received", storagePath: "registry/v1.pdf" },
    },
  })).ok, false);

  assert.deepEqual(accountantRhRegistryUploadPreflight(readyProcess({
    currentStage: "signature_preparation",
    accountantWorkflow: {
      status: "completed",
      registryDocument: { status: "approved", storagePath: "registry/v1.pdf" },
    },
  })), { ok: true, unchanged: true });
});
