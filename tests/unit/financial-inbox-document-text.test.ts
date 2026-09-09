import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { extractDeterministicFinancialDocumentText } from "../../src/features/financial/inbox/document-text";

test("extrai a camada textual de um boleto PDF", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("VIVO FATURA MOVEL", { x: 40, y: 790, size: 12, font });
  page.drawText("Linha: (98) 99999-1234", { x: 40, y: 765, size: 12, font });
  page.drawText("Vencimento: 15/09/2026", { x: 40, y: 740, size: 12, font });
  page.drawText("Valor total: R$ 249,90", { x: 40, y: 715, size: 12, font });
  const bytes = await pdf.save();

  const extracted = await extractDeterministicFinancialDocumentText({
    buffer: Buffer.from(bytes),
    filename: "fatura-vivo.pdf",
    contentType: "application/pdf",
  });

  assert.equal(extracted.method, "pdf_text");
  assert.equal(extracted.pageCount, 1);
  assert.match(extracted.text, /VIVO FATURA MOVEL/);
  assert.match(extracted.text, /99999-1234/);
});

test("converte XML financeiro em texto rotulado", async () => {
  const extracted = await extractDeterministicFinancialDocumentText({
    buffer: Buffer.from("<?xml version=\"1.0\"?><cobranca><vencimento>15/09/2026</vencimento><valor>249.90</valor></cobranca>"),
    filename: "cobranca.xml",
    contentType: "application/xml",
  });
  assert.equal(extracted.method, "xml_text");
  assert.match(extracted.text, /vencimento: 15\/09\/2026/);
});

test("decodifica somente uma camada de entidades XML", async () => {
  const extracted = await extractDeterministicFinancialDocumentText({
    buffer: Buffer.from("<cobranca><descricao>&lt;fatura&gt; &amp; &amp;lt;segura&amp;gt;</descricao></cobranca>"),
    filename: "cobranca.xml",
    contentType: "application/xml",
  });

  assert.match(extracted.text, /descricao: <fatura> & &lt;segura&gt;/);
  assert.doesNotMatch(extracted.text, /<segura>/);
});
