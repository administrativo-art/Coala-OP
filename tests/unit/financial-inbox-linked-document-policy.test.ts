import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedFinancialDocumentUrl,
  isLikelyFinancialDocumentUrl,
  isPrivateNetworkAddress,
  safeFinancialDocumentSourceUrl,
} from "../../src/features/financial/inbox/linked-document-policy";

test("aceita documento HTTPS do mesmo domínio-base do remetente", () => {
  assert.equal(isAllowedFinancialDocumentUrl("https://documentos.vivo.com.br/faturas/123.pdf?token=secret", "vivo.com.br", []), true);
  assert.equal(isLikelyFinancialDocumentUrl("https://documentos.vivo.com.br/faturas/123.pdf?token=secret"), true);
  assert.equal(safeFinancialDocumentSourceUrl("https://documentos.vivo.com.br/faturas/123.pdf?token=secret"), "https://documentos.vivo.com.br/faturas/123.pdf");
});

test("bloqueia protocolo, credencial, domínio e redes privadas não autorizados", () => {
  assert.equal(isAllowedFinancialDocumentUrl("http://documentos.vivo.com.br/fatura.pdf", "vivo.com.br", []), false);
  assert.equal(isAllowedFinancialDocumentUrl("https://user:pass@vivo.com.br/fatura.pdf", "vivo.com.br", []), false);
  assert.equal(isAllowedFinancialDocumentUrl("https://evil.example/fatura.pdf", "vivo.com.br", []), false);
  assert.equal(isAllowedFinancialDocumentUrl("https://127.0.0.1/fatura.pdf", "vivo.com.br", []), false);
  assert.equal(isPrivateNetworkAddress("10.1.2.3"), true);
  assert.equal(isPrivateNetworkAddress("8.8.8.8"), false);
});

test("ignora links de marketing mesmo no domínio permitido", () => {
  assert.equal(isLikelyFinancialDocumentUrl("https://vivo.com.br/unsubscribe?campaign=conta"), false);
});

test("reconhece rotas públicas de provedores documentais independentemente do remetente", () => {
  assert.equal(isAllowedFinancialDocumentUrl(
    "https://cliente.superlogica.net/clients/areadocliente/publico/cobranca/c/documento",
    "bizneo.com",
    [],
  ), true);
  assert.equal(isAllowedFinancialDocumentUrl(
    "https://cliente.superlogica.net/clients/areadocliente/publico/espelhonfsepdf?id=123",
    "bizneo.com",
    [],
  ), true);
  assert.equal(isAllowedFinancialDocumentUrl(
    "https://cliente.superlogica.net/clients/areadocliente",
    "bizneo.com",
    [],
  ), false);
  assert.equal(isAllowedFinancialDocumentUrl(
    "https://cliente.superlogica.net/financeiro/atual/publico/confirmarleituraemail/hash/123",
    "bizneo.com",
    [],
  ), false);
});

test("permite somente as rotas documentais da Acessórias", () => {
  assert.equal(isAllowedFinancialDocumentUrl(
    "https://app.acessorias.com/getguia.php?documento=123",
    "example.com",
    [],
  ), true);
  assert.equal(isAllowedFinancialDocumentUrl(
    "https://acessorias.s3.us-east-2.amazonaws.com/eContinuo/empresa/guia.pdf",
    "example.com",
    [],
  ), true);
  assert.equal(isAllowedFinancialDocumentUrl(
    "https://acessorias.s3.us-east-2.amazonaws.com/anexos/assinatura.png",
    "example.com",
    [],
  ), false);
});
