import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdmissionSignatureDocumentName,
  buildSignatureDocumentName,
  buildSignatureFileName,
  signatureDepartmentForTemplate,
} from "../../../src/features/hr/documents/signature-document-name";

test("aplica o padrão corporativo aos documentos de assinatura", () => {
  assert.equal(
    buildSignatureDocumentName({
      documentType: "Contrato de trabalho a título de experiência",
      holderName: "Sara Ferreira Coelho",
    }),
    "Coala Shakes - RH | Contrato de trabalho a título de experiência - Sara Ferreira Coelho"
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
    "Coala Shakes - RH | Termo de VT - Titular não identificado"
  );
});

test("gera nome de arquivo válido preservando o padrão", () => {
  assert.equal(
    buildSignatureFileName("COALA SHAKES - Contrato: experiência - Ana"),
    "COALA SHAKES - Contrato- experiência - Ana.docx"
  );
});

test("usa o setor do documento e o padrão aprovado para Financeiro e Operações", () => {
  assert.equal(buildSignatureDocumentName({ department: "FN", documentType: "Recibo", holderName: "João Meloriano" }), "Coala Shakes - FN | Recibo - João Meloriano");
  assert.equal(buildSignatureDocumentName({ department: "OP", documentType: "Entrega de equipamento", holderName: "Ana" }), "Coala Shakes - OP | Entrega de equipamento - Ana");
  assert.equal(signatureDepartmentForTemplate({ id: "system-receipt-standard" }), "FN");
  assert.equal(signatureDepartmentForTemplate({ category: "Financeiro e recibos" }), "FN");
  assert.equal(signatureDepartmentForTemplate({ sourceModule: "assets" }), "OP");
  assert.equal(signatureDepartmentForTemplate({ sourceModule: "uniforms" }), "OP");
  assert.equal(signatureDepartmentForTemplate({ sourceModule: "admission" }), "RH");
  assert.equal(signatureDepartmentForTemplate(null), "RH");
  assert.equal(buildSignatureFileName(buildSignatureDocumentName({ department: "FN", documentType: "Recibo", holderName: "João Meloriano" }), "pdf"), "Coala Shakes - FN - Recibo - João Meloriano.pdf");
});
