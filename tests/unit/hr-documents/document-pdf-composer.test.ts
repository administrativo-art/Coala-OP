import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { composeDocumentPackage } from "../../../src/features/hr/documents/document-pdf-composer.server";

async function pdfWithPages(count: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) {
    document.addPage([595.28, 841.89]);
  }
  return Buffer.from(await document.save());
}

test("compõe pacote genérico com cadeia de hashes e índice imutável", async () => {
  const result = await composeDocumentPackage({
    packageId: "package-1",
    packageType: "admission",
    protocol: "COAL-ADM-2026-000001",
    title: "Pacote de teste",
    parties: [],
    letterheadVersion: "coala-letterhead-v2",
    generatedAt: "2026-07-28T00:00:00.000Z",
    components: [
      {
        componentId: "contract",
        title: "Contrato",
        buffer: await pdfWithPages(2),
        templateId: "template-contract",
        templateVersion: 2,
        sourceDocxHash: "docx-contract",
      },
      {
        componentId: "closing",
        title: "Encerramento",
        buffer: await pdfWithPages(1),
        templateId: "template-closing",
        templateVersion: 1,
        sourceDocxHash: "docx-closing",
      },
    ],
  });
  const pdf = await PDFDocument.load(result.buffer);

  assert.equal(pdf.getPageCount(), 3);
  assert.equal(result.manifest.packageHash, result.packageHash);
  assert.equal(result.manifest.totalPages, 3);
  assert.deepEqual(
    result.manifest.components.map(
      ({ componentId, startPage, endPage }) => ({
        componentId,
        startPage,
        endPage,
      }),
    ),
    [
      { componentId: "contract", startPage: 1, endPage: 2 },
      { componentId: "closing", startPage: 3, endPage: 3 },
    ],
  );
  assert.ok(result.manifestHash.length === 64);
  assert.ok(
    result.artifacts.every(
      (artifact) =>
        artifact.contentHash.length === 64 &&
        artifact.artifactHash.length === 64 &&
        artifact.contentHash !== artifact.artifactHash,
    ),
  );
});

test("usa formato avulso e aceita assinatura standalone", async () => {
  const result = await composeDocumentPackage({
    packageId: "receipt-1",
    packageType: "receipt",
    protocol: "COAL-REC-2026-000001",
    title: "Recibo",
    parties: [],
    letterheadVersion: "coala-letterhead-v2",
    components: [
      {
        componentId: "receipt",
        title: "Recibo",
        buffer: await pdfWithPages(1),
        signatureScope: "standalone",
      },
    ],
  });
  assert.equal(result.manifest.components[0].signatureScope, "standalone");
});

test("impede consentimento standalone dentro de pacote", async () => {
  await assert.rejects(
    composeDocumentPackage({
      packageId: "package-invalid",
      packageType: "admission",
      protocol: "COAL-ADM-2026-000002",
      title: "Pacote inválido",
      parties: [],
      letterheadVersion: "coala-letterhead-v2",
      components: [
        {
          componentId: "consent",
          title: "Imagem e voz",
          buffer: await pdfWithPages(1),
          signatureScope: "standalone",
        },
      ],
    }),
    /aceite independente/,
  );
});
