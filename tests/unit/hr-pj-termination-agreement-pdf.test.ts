import assert from "node:assert/strict";
import test from "node:test";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";

import { moneyWords, PjTerminationAgreementPdf } from "../../src/features/hr/termination/pj-termination-agreement-pdf";
import type { PjTerminationContractSnapshot } from "../../src/features/hr/termination/types";

const contract: PjTerminationContractSnapshot = {
  onboardingId: "onboarding-pj-test",
  contractor: {
    entityId: "contractor-entity",
    legalName: "CT Sorvetes Ltda.",
    tradeName: "Coala Shakes",
    cnpj: "14276603000125",
    email: "representante@coala.test",
    address: "Avenida Teste, 100, São Luís/MA",
    representative: {
      name: "Representante Contratante",
      email: "representante@coala.test",
      role: "Administrador",
      qualification: "empresário",
      cpf: "12345678901",
      professionalId: null,
    },
  },
  provider: {
    entityId: "provider-entity",
    legalName: "Prestadora Exemplo Ltda.",
    tradeName: null,
    cnpj: "64433090000197",
    email: "prestadora@example.com",
    address: "Rua da Prestadora, 20, São Luís/MA",
    representative: {
      name: "Representante Prestadora",
      email: "prestadora@example.com",
      role: null,
      qualification: "empresária",
      cpf: "98765432100",
      professionalId: null,
    },
  },
  sourceContract: {
    contractDate: "2026-07-01",
    contractStartDate: "2026-07-01",
    termType: "indefinite",
    contractEndDate: null,
    monthlyValue: 3000,
    version: 1,
    signedStoragePath: "tests/contrato-assinado.pdf",
    signedHashSha256: "a".repeat(64),
    signedAt: "2026-07-01T12:00:00.000Z",
    signatureCity: "São Luís/MA",
    forumCity: "São Luís/MA",
  },
  capturedAt: "2026-08-10T12:00:00.000Z",
};

test("distrato PJ renderiza PDF paginado e valores por extenso", async () => {
  const document = PjTerminationAgreementPdf({
    data: {
      contract,
      terminationDate: "2026-08-10",
      daysWorked: 10,
      prorataFormulaText: "R$ 3.000,00 ÷ 30 × 10 = R$ 1.000,00",
      grossValue: 1000,
      invoiceNumber: "123",
      invoiceDate: "2026-08-10",
      paymentDate: "2026-08-10",
      forumCity: "São Luís/MA",
      signatureCity: "São Luís/MA",
      signatureDate: "2026-08-10",
      witnesses: [
        { name: "Ana Testemunha", email: "ana@example.com", cpf: "12345678901" },
        { name: "Bruno Testemunha", email: "bruno@example.com", cpf: "98765432100" },
      ],
    },
  }) as Parameters<typeof renderToBuffer>[0];
  const buffer = Buffer.from(await renderToBuffer(document));
  const pdf = await PDFDocument.load(buffer);
  assert.ok(buffer.byteLength > 10_000);
  assert.ok(pdf.getPageCount() >= 2);
  assert.equal(moneyWords(3000), "três mil reais");
  assert.equal(moneyWords(1000.5), "mil reais e cinquenta centavos");
});
