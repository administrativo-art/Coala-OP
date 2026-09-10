import assert from "node:assert/strict";
import test from "node:test";

import { resolveInterBankingStatusProxyUrl } from "../../src/lib/integrations/inter/config.server";

test("desenvolvimento só consulta a aplicação canônica com opt-in explícito", () => {
  assert.equal(resolveInterBankingStatusProxyUrl({
    nodeEnvironment: "development",
    credentialsConfigured: false,
  }), null);
  assert.equal(resolveInterBankingStatusProxyUrl({
    nodeEnvironment: "development",
    credentialsConfigured: false,
    configuredUrl: "https://op.coalashakes.com",
  }), "https://op.coalashakes.com");
});

test("produção e ambiente local configurado nunca usam proxy", () => {
  assert.equal(resolveInterBankingStatusProxyUrl({
    nodeEnvironment: "production",
    credentialsConfigured: false,
  }), null);
  assert.equal(resolveInterBankingStatusProxyUrl({
    nodeEnvironment: "development",
    credentialsConfigured: true,
  }), null);
});

test("proxy rejeita protocolo inseguro e remove caminhos da origem configurada", () => {
  assert.throws(() => resolveInterBankingStatusProxyUrl({
    nodeEnvironment: "development",
    credentialsConfigured: false,
    configuredUrl: "http://localhost:3000",
  }), /HTTPS/);
  assert.equal(resolveInterBankingStatusProxyUrl({
    nodeEnvironment: "development",
    credentialsConfigured: false,
    configuredUrl: "https://finance.example.com/internal",
  }), "https://finance.example.com");
});
