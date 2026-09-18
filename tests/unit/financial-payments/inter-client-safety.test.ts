import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import test from "node:test";
import { rootCertificates } from "node:tls";
import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from "axios";

import {
  clearInterTokenCache,
  createInterClient,
  inspectInterCertificateHealth,
} from "../../../src/lib/integrations/inter/client.server";
import { InterApiError } from "../../../src/lib/integrations/inter/error";

const ENVIRONMENT_KEYS = [
  "INTER_ENVIRONMENT",
  "INTER_CLIENT_ID",
  "INTER_CLIENT_SECRET",
  "INTER_CERTIFICATE_BASE64",
  "INTER_PRIVATE_KEY_BASE64",
] as const;

function usablePublicCertificate() {
  const minimumValidity = Date.now() + 90 * 24 * 60 * 60 * 1_000;
  const certificate = rootCertificates.find((candidate) => {
    try {
      return Date.parse(new X509Certificate(candidate).validTo) > minimumValidity;
    } catch {
      return false;
    }
  });
  assert.ok(certificate, "A runtime precisa fornecer ao menos um certificado raiz válido para o teste.");
  return certificate;
}

async function withInterFixture(adapter: AxiosAdapter, operation: () => Promise<void>) {
  const originalAdapter = axios.defaults.adapter;
  const originalEnvironment = Object.fromEntries(
    ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof ENVIRONMENT_KEYS)[number], string | undefined>;
  axios.defaults.adapter = adapter;
  process.env.INTER_ENVIRONMENT = "production";
  process.env.INTER_CLIENT_ID = "fixture-client-id";
  process.env.INTER_CLIENT_SECRET = "CLIENT_SECRET_MUST_NOT_ESCAPE";
  process.env.INTER_CERTIFICATE_BASE64 = Buffer.from(usablePublicCertificate()).toString("base64");
  process.env.INTER_PRIVATE_KEY_BASE64 = Buffer.from("PRIVATE_KEY_MUST_NOT_ESCAPE").toString("base64");
  clearInterTokenCache();
  try {
    await operation();
  } finally {
    clearInterTokenCache();
    axios.defaults.adapter = originalAdapter;
    for (const key of ENVIRONMENT_KEYS) {
      const value = originalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function success(config: InternalAxiosRequestConfig, data: unknown) {
  return Promise.resolve({
    config,
    data,
    headers: new AxiosHeaders(),
    status: 200,
    statusText: "OK",
  });
}

function httpFailure(config: InternalAxiosRequestConfig, status: number, data: unknown = {}) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    undefined,
    {
      config,
      data,
      headers: new AxiosHeaders({ "retry-after": "0" }),
      status,
      statusText: "Error",
    },
  );
}

test("compartilha uma única solicitação OAuth entre chamadas simultâneas", async () => {
  let tokenCalls = 0;
  let releaseToken!: () => void;
  const tokenGate = new Promise<void>((resolve) => { releaseToken = resolve; });
  const adapter: AxiosAdapter = async (config) => {
    assert.match(config.url ?? "", /\/oauth\/v2\/token$/);
    tokenCalls += 1;
    await tokenGate;
    return success(config, { access_token: "fixture-token", expires_in: 3600 });
  };

  await withInterFixture(adapter, async () => {
    const clients = Promise.all([
      createInterClient("extrato.read"),
      createInterClient("extrato.read"),
      createInterClient("extrato.read"),
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(tokenCalls, 1);
    releaseToken();
    await clients;
    assert.equal(tokenCalls, 1);
  });
});

test("calcula vencimento do certificado sem acessar chave privada", () => {
  const certificate = usablePublicCertificate();
  const expiresAt = Date.parse(new X509Certificate(certificate).validTo);
  const health = inspectInterCertificateHealth(
    Buffer.from(certificate),
    expiresAt - 10 * 24 * 60 * 60 * 1_000,
  );
  assert.equal(health.expired, false);
  assert.equal(health.daysRemaining, 10);
  assert.equal(health.expiresAt, expiresAt);

  const expired = inspectInterCertificateHealth(Buffer.from(certificate), expiresAt + 1);
  assert.equal(expired.expired, true);
});

test("repete autenticação transitória respeitando Retry-After", async () => {
  let tokenCalls = 0;
  const adapter: AxiosAdapter = async (config) => {
    tokenCalls += 1;
    if (tokenCalls === 1) throw httpFailure(config, 429);
    return success(config, { access_token: "fixture-token", expires_in: 3600 });
  };

  await withInterFixture(adapter, async () => {
    await createInterClient("extrato.read");
    assert.equal(tokenCalls, 2);
  });
});

test("repete somente leitura e nunca repete inclusão de pagamento", async () => {
  let readCalls = 0;
  let paymentCalls = 0;
  const adapter: AxiosAdapter = async (config) => {
    if (config.url?.endsWith("/oauth/v2/token")) {
      return success(config, { access_token: "AUTHORIZATION_MUST_NOT_ESCAPE", expires_in: 3600 });
    }
    if (config.method?.toUpperCase() === "GET") {
      readCalls += 1;
      if (readCalls === 1) throw httpFailure(config, 429);
      return success(config, { ok: true });
    }
    paymentCalls += 1;
    throw httpFailure(config, 503, {
      body: "REQUEST_BODY_MUST_NOT_ESCAPE",
      client_secret: "CLIENT_SECRET_MUST_NOT_ESCAPE",
    });
  };

  await withInterFixture(adapter, async () => {
    const client = await createInterClient("pagamento-boleto.write");
    const response = await client.get("/banking/v2/pagamento");
    assert.deepEqual(response.data, { ok: true });
    assert.equal(readCalls, 2);

    await assert.rejects(
      client.post("/banking/v2/pagamento", { payment: "REQUEST_BODY_MUST_NOT_ESCAPE" }),
      (error: unknown) => {
        assert.ok(error instanceof InterApiError);
        assert.equal(error.retryable, true);
        const serialized = JSON.stringify(error);
        assert.doesNotMatch(serialized, /CLIENT_SECRET_MUST_NOT_ESCAPE/);
        assert.doesNotMatch(serialized, /PRIVATE_KEY_MUST_NOT_ESCAPE/);
        assert.doesNotMatch(serialized, /AUTHORIZATION_MUST_NOT_ESCAPE/);
        assert.doesNotMatch(serialized, /REQUEST_BODY_MUST_NOT_ESCAPE/);
        assert.equal("config" in error, false);
        assert.equal("request" in error, false);
        assert.equal("response" in error, false);
        return true;
      },
    );
    assert.equal(paymentCalls, 1);
  });
});

test("erro OAuth sai da fronteira sem credenciais, certificado, chave ou agente HTTPS", async () => {
  const adapter: AxiosAdapter = async (config) => {
    throw httpFailure(config, 401, { client_secret: "CLIENT_SECRET_MUST_NOT_ESCAPE" });
  };

  await withInterFixture(adapter, async () => {
    await assert.rejects(createInterClient("extrato.read"), (error: unknown) => {
      assert.ok(error instanceof InterApiError);
      const serialized = JSON.stringify(error);
      assert.doesNotMatch(serialized, /CLIENT_SECRET_MUST_NOT_ESCAPE/);
      assert.doesNotMatch(serialized, /PRIVATE_KEY_MUST_NOT_ESCAPE/);
      assert.doesNotMatch(serialized, /AUTHORIZATION_MUST_NOT_ESCAPE/);
      assert.doesNotMatch(serialized, /BEGIN CERTIFICATE/);
      assert.doesNotMatch(serialized, /httpsAgent|certificate|privateKey|config|response|request/i);
      return true;
    });
  });
});
