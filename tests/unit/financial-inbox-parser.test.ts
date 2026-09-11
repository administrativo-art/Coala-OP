import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFinancialEmail,
  extractEmailAddress,
  extractExternalLinks,
  extractFinancialDocumentReferences,
  extractFinancialInstallmentReference,
  extractPaymentBarcode,
  extractTelecomServiceNumbers,
  htmlToPlainText,
  normalizeBrazilianServiceNumber,
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

test("extrai linha digitável quando o PDF inclui o código do banco antes do boleto", () => {
  const text = "237-2   23793.49307 90010.049923 96000.130003 9 15620000113884";
  assert.equal(
    extractPaymentBarcode(text),
    "23793493079001004992396000130003915620000113884",
  );
});

test("dados estruturados concordantes do boleto prevalecem sobre encargos citados no e-mail", () => {
  const parsed = classifyFinancialEmail({
    subject: "Seu boleto vencerá em breve",
    text: "Após o vencimento haverá mora diária de R$ 5,71.",
    documentText: "Valor do documento: R$ 285,60. Vencimento: 25/09/2026.",
    documentHints: [{
      documentText: null,
      supplierName: "Bizneo Solutions do Brasil Ltda",
      supplierTaxId: "46164085000144",
      competence: null,
      dueDate: "2026-09-25",
      amountCents: 28560,
      barcode: "48190000030000515057880058150147115800000028560",
      customerAccount: null,
      contractNumber: null,
      serviceType: "other",
      serviceNumbers: [],
      confidence: "high",
    }],
  });

  assert.equal(parsed.classification.amountCents, 28560);
  assert.equal(parsed.classification.dueDate, "2026-09-25");
  assert.equal(parsed.classification.barcode, "48190000030000515057880058150147115800000028560");
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

test("identifica fornecedor e vencimento no assunto do boleto da Marvi", () => {
  const parsed = classifyFinancialEmail({
    subject: "Aviso de vencimento de boleto Marvi 07/09/2026",
    text: "Valor da cobrança: R$ 1.138,84",
    senderDomain: "marvi.com.br",
  });

  assert.equal(parsed.classification.supplierName, "Marvi");
  assert.equal(parsed.classification.dueDate, "2026-09-07");
  assert.equal(parsed.classification.amountCents, 113884);
});

test("extrai referências de NF do texto e do nome do anexo", () => {
  assert.deepEqual(extractFinancialDocumentReferences("Compra referente à NF-e 872460"), ["872460"]);
  const parsed = classifyFinancialEmail({
    subject: "Aviso de vencimento de boleto",
    text: "Valor: R$ 1.138,84. Vencimento: 07/09/2026.",
    senderDomain: "marvi.com.br",
    documentReferences: ["BOLETO_COALA_SHAKES_CD_872460.PDF"],
  });
  assert.deepEqual(parsed.classification.documentReferences, ["872460"]);
});

test("extrai a parcela documental sem inferir números soltos", () => {
  assert.deepEqual(extractFinancialInstallmentReference("Parcela 01 de 08"), {
    installmentNumber: 1,
    installmentTotal: 8,
  });
  assert.deepEqual(extractFinancialInstallmentReference("parcela: 3/3"), {
    installmentNumber: 3,
    installmentTotal: 3,
  });
  assert.deepEqual(extractFinancialInstallmentReference("NF 872460 vencimento 07/09/2026"), {
    installmentNumber: null,
    installmentTotal: null,
  });
});

test("obtém o CNPJ do fornecedor na chave de acesso da NF-e", () => {
  const parsed = classifyFinancialEmail({
    subject: "NF-e 872460",
    text: "Chave de acesso 35260853408654000115550010008724601319021139",
    senderDomain: "marvi.com.br",
  });
  assert.equal(parsed.classification.billingIdentity?.supplierTaxId, "53408654000115");
});

test("extrai identidade da linha móvel do documento anexado", () => {
  const parsed = classifyFinancialEmail({
    subject: "A fatura Vivo Móvel da sua empresa chegou",
    text: "Consulte a sua fatura.",
    documentText: [
      "VIVO / TELEFÔNICA BRASIL S.A.",
      "Competência: 08/2026",
      "Vencimento: 15/09/2026",
      "Valor total: R$ 249,90",
      "Conta: 00192837",
      "Número da linha: (98) 99999-1234",
    ].join("\n"),
    senderDomain: "vivo.com.br",
  });

  assert.equal(parsed.classification.documentType, "utility_bill");
  assert.equal(parsed.classification.amountCents, 24990);
  assert.equal(parsed.classification.dueDate, "2026-09-15");
  assert.equal(parsed.classification.competence, "2026-08");
  assert.equal(parsed.classification.billingIdentity?.serviceType, "mobile");
  assert.equal(parsed.classification.billingIdentity?.customerAccount, "00192837");
  assert.deepEqual(parsed.classification.billingIdentity?.serviceNumbers, ["+5598999991234"]);
});

test("não confunde telefone de atendimento nem linha digitável com linha cobrada", () => {
  const text = "Telefone de atendimento: (11) 4002-8922. Linha digitável: 34191.79001 01043.510047 91020.150008 8 95190000003999";
  assert.deepEqual(extractTelecomServiceNumbers(text), []);
  assert.equal(normalizeBrazilianServiceNumber("(98) 99999-1234"), "+5598999991234");
});

test("extrai telefone principal sem confundir a chave de acesso fiscal", () => {
  const parsed = classifyFinancialEmail({
    subject: "A fatura Vivo Móvel da sua empresa chegou",
    senderDomain: "vivo.com.br",
    documentText: [
      "Acesse aqui a Nota Fiscal",
      "Chave de acesso: 21260902558157000405620040003464881003350381",
      "Nº da Conta: 0461855379",
      "Mês de referência: 09/2026",
      "TELEFONE PRINCIPAL: 98-99907-2739",
      "Vencimento: 25/09/2026",
      "Total a Pagar - R$ 39,99",
    ].join("\n"),
  });

  assert.equal(parsed.classification.billingIdentity?.customerAccount, "0461855379");
  assert.deepEqual(parsed.classification.billingIdentity?.serviceNumbers, ["+5598999072739"]);
  assert.equal(parsed.classification.barcode, null);
});

test("ignora ocorrência textual de conta e continua até o identificador numérico", () => {
  const parsed = classifyFinancialEmail({
    subject: "Sua Conta Digital chegou",
    senderDomain: "vivo.com.br",
    documentText: "Conta Digital\nNúmero da conta: 0461855379\nFatura Vivo",
  });
  assert.equal(parsed.classification.billingIdentity?.customerAccount, "0461855379");
});

test("separa campanha comercial da Vivo de uma cobrança", () => {
  const promotion = classifyFinancialEmail({
    subject: "Internet Fibra de 700 MEGA + WIFI 6 por apenas R$ 99,99/mês",
    text: "Contrate agora e tenha a melhor internet do Brasil.",
    senderDomain: "vivo.com.br",
  });
  const billing = classifyFinancialEmail({
    subject: "A fatura Vivo Móvel da sua empresa chegou",
    text: "Vencimento: 25/09/2026. Total a pagar: R$ 39,99.",
    senderDomain: "vivo.com.br",
  });

  assert.equal(promotion.classification.marketingLikely, true);
  assert.equal(promotion.classification.financeLikely, false);
  assert.equal(billing.classification.marketingLikely, false);
  assert.equal(billing.classification.financeLikely, true);
});
