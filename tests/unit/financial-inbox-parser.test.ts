import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFinancialEmail,
  extractEmailAddress,
  extractExternalLinks,
  extractPaymentBarcode,
  htmlToPlainText,
} from "../../src/features/financial/inbox/parser";

test("classifica guia de FGTS da Maximus com competência e vencimento", () => {
  const parsed = classifyFinancialEmail({
    subject: "GUIA DE FGTS - VENCIMENTO: 20/08/2026",
    html: "<p>Maximus Contabilidade</p><p>Competência de <strong>07/2026</strong></p><a href='https://documentos.grupomse.com/guia/123'>Acessar</a>",
    senderDomain: "grupomse.com",
  });

  assert.equal(parsed.classification.documentType, "fgts");
  assert.equal(parsed.classification.competence, "2026-07");
  assert.equal(parsed.classification.dueDate, "2026-08-20");
  assert.equal(parsed.classification.supplierName, "Maximus Contabilidade / Grupo MSE");
  assert.deepEqual(parsed.classification.links, ["https://documentos.grupomse.com/guia/123"]);
});

test("extrai e mascara linha digitável sem confundir outros números", () => {
  const code = "34191.79001 01043.510047 91020.150008 8 95190000003999";
  const parsed = classifyFinancialEmail({
    subject: "Boleto disponível",
    text: `Valor: R$ 39,99. Linha digitável: ${code}`,
  });
  assert.equal(extractPaymentBarcode(`Telefone 98999999999. Linha digitável: ${code}`), "34191790010104351004791020150008895190000003999");
  assert.equal(parsed.classification.barcode, "34191790010104351004791020150008895190000003999");
  assert.match(parsed.classification.barcodeMasked || "", /^34191.*03999$/);
});

test("classifica INSS-DARF e extrai valor brasileiro somente como sugestão", () => {
  const parsed = classifyFinancialEmail({
    subject: "INSS-DARF - VENCIMENTO: 20/08/2026",
    text: "Competência 07/2026. Valor total: R$ 1.234,56.",
  });

  assert.equal(parsed.classification.documentType, "inss_darf");
  assert.equal(parsed.classification.amountCents, 123456);
  assert.equal(parsed.classification.financeLikely, true);
});

test("identifica honorário contábil mesmo quando o assunto é genérico", () => {
  const parsed = classifyFinancialEmail({
    subject: "Documento [BOLETO-25]",
    text: "BOLETO - HONORÁRIO CONTÁBIL. Competência de 07/2026.",
  });

  assert.equal(parsed.classification.documentType, "accounting_fee");
  assert.equal(parsed.classification.dueDate, null);
});

test("não preserva scripts nem links com protocolos inseguros", () => {
  const html = "<script>alert(1)</script><p>Documento</p><a href='javascript:alert(2)'>ruim</a><a href='https://seguro.example/doc'>bom</a>";
  assert.equal(htmlToPlainText(html), "Documento\nruim bom");
  assert.deepEqual(extractExternalLinks("", html), ["https://seguro.example/doc"]);
});

test("extrai o endereço real de remetentes com nome de exibição", () => {
  assert.equal(extractEmailAddress("Urania | Maximus <urania.silva@grupomse.com>"), "urania.silva@grupomse.com");
});
