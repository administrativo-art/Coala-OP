import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PDFDocument } from "pdf-lib";

import { buildAdmissionPdfBundle } from "../../../src/features/hr/documents/admission-pdf-bundle.server";

async function pdfWithPages(count: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) document.addPage([595.28, 841.89]);
  return Buffer.from(await document.save());
}

test("consolida PDFs, preserva o índice e recalcula o total de páginas", async () => {
  const logoPng = await readFile(path.join(process.cwd(), "src/features/hr/documents/assets/coala-shakes-letterhead-mark-v1.png"));
  const result = await buildAdmissionPdfBundle({
    title: "Kit admissional - Pessoa de Exemplo",
    logoPng,
    components: [
      { id: "contract", name: "Contrato", buffer: await pdfWithPages(2), templateVersion: 1 },
      { id: "closing", name: "Encerramento", buffer: await pdfWithPages(1), templateVersion: 1 },
    ],
  });
  const rendered = await PDFDocument.load(result.buffer);

  assert.equal(result.pageCount, 3);
  assert.equal(rendered.getPageCount(), 3);
  assert.deepEqual(result.index.map(({ id, startPage, endPage }) => ({ id, startPage, endPage })), [
    { id: "contract", startPage: 1, endPage: 2 },
    { id: "closing", startPage: 3, endPage: 3 },
  ]);
});

test("recusa componente que não seja PDF", async () => {
  const logoPng = await readFile(path.join(process.cwd(), "src/features/hr/documents/assets/coala-shakes-letterhead-mark-v1.png"));
  await assert.rejects(
    buildAdmissionPdfBundle({
      title: "Kit inválido",
      logoPng,
      components: [{ id: "docx", name: "Documento", buffer: Buffer.from("PK não é PDF") }],
    }),
    /não possui uma versão PDF válida/,
  );
});

test("inclui consentimento de imagem quando seu escopo é o pacote admissional", async () => {
  const logoPng = await readFile(path.join(process.cwd(), "src/features/hr/documents/assets/coala-shakes-letterhead-mark-v1.png"));
  const result = await buildAdmissionPdfBundle({
    title: "Kit com consentimento facultativo",
    logoPng,
    components: [{
      id: "image-consent",
      name: "Consentimento de imagem e voz",
      buffer: await pdfWithPages(1),
      signatureScope: "bundle",
    }],
  });
  assert.equal(result.pageCount, 1);
  assert.equal(result.index[0]?.id, "image-consent");
});

test("mantém documento independente fora do pacote contratual", async () => {
  const logoPng = await readFile(path.join(process.cwd(), "src/features/hr/documents/assets/coala-shakes-letterhead-mark-v1.png"));
  await assert.rejects(
    buildAdmissionPdfBundle({
      title: "Kit inválido",
      logoPng,
      components: [{
        id: "standalone-document",
        name: "Documento independente",
        buffer: await pdfWithPages(1),
        signatureScope: "independent",
      }],
    }),
    /aceite independente/,
  );
});
