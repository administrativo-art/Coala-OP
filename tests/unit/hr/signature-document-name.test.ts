import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdmissionSignatureDocumentName,
  buildSignatureDocumentName,
  buildSignatureFileName,
} from "../../../src/features/hr/documents/signature-document-name";

test("aplica o padrão corporativo aos documentos de assinatura", () => {
  assert.equal(
    buildSignatureDocumentName({
      documentType: "Contrato de trabalho a título de experiência",
      holderName: "Sara Ferreira Coelho",
    }),
    "COALA SHAKES - Contrato de trabalho a título de experiência - Sara Ferreira Coelho"
  );
});

test("nomeia o kit admissional pelo padrão do RH e pelo titular", () => {
  assert.equal(
    buildAdmissionSignatureDocumentName("  Thaise Correia\nMarinho "),
    "Coala Shakes - RH | Admissão - Thaise Correia Marinho",
  );
});

test("limpa quebras e impede nome vazio", () => {
  assert.equal(
    buildSignatureDocumentName({ documentType: "  Termo\n de VT ", holderName: " " }),
    "COALA SHAKES - Termo de VT - Titular não identificado"
  );
});

test("gera nome de arquivo válido preservando o padrão", () => {
  assert.equal(
    buildSignatureFileName("COALA SHAKES - Contrato: experiência - Ana"),
    "COALA SHAKES - Contrato- experiência - Ana.docx"
  );
});
