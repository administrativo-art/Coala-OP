import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { assertCronSecret } from "../../../src/features/forms/analytics/admin-operations";

const SECRET = "segredo-do-agendador";
const URL_BASE = "https://app.coala.test/api/forms/analytics/jobs/recompute-daily";

function request(init: { header?: string; query?: string }) {
  const url = new URL(URL_BASE);
  if (init.query !== undefined) url.searchParams.set("secret", init.query);
  const headers = new Headers();
  if (init.header !== undefined) headers.set("x-cron-secret", init.header);
  return new Request(url, { headers });
}

/** Executa e devolve o erro lançado (assert.throws do node:test não o retorna). */
function catchError(run: () => void) {
  try {
    run();
  } catch (error) {
    return error as Error & { status?: number };
  }
  throw new Error("Esperava que a chamada lançasse um erro, mas ela passou.");
}

describe("assertCronSecret", () => {
  let originalSecret: string | undefined;
  let warnings: unknown[][];
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    originalSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    console.warn = originalWarn;
  });

  test("aceita o segredo correto via header, sem alerta", () => {
    assert.doesNotThrow(() => assertCronSecret(request({ header: SECRET })));
    assert.equal(warnings.length, 0);
  });

  test("rejeita segredo errado com 401", () => {
    const error = catchError(() => assertCronSecret(request({ header: "errado" })));
    assert.equal(error.status, 401);
  });

  test("rejeita requisição sem segredo nenhum com 401", () => {
    const error = catchError(() => assertCronSecret(request({})));
    assert.equal(error.status, 401);
  });

  test("rejeita prefixo correto do segredo (guarda contra timing attack)", () => {
    const error = catchError(() =>
      assertCronSecret(request({ header: SECRET.slice(0, -1) }))
    );
    assert.equal(error.status, 401);
  });

  // Comportamento DEPRECADO, coberto para que a remoção seja uma decisão explícita
  // e não uma quebra acidental do agendador.
  test("ainda aceita o segredo na query string, mas registra alerta de segurança", () => {
    assert.doesNotThrow(() => assertCronSecret(request({ query: SECRET })));
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /SEGURANÇA/);
  });

  test("o header tem precedência e não dispara o alerta da query string", () => {
    assert.doesNotThrow(() =>
      assertCronSecret(request({ header: SECRET, query: SECRET }))
    );
    assert.equal(warnings.length, 0);
  });

  test("falha quando o segredo não está configurado no ambiente", () => {
    delete process.env.CRON_SECRET;
    delete process.env.FORMS_ANALYTICS_JOB_SECRET;
    delete process.env.FORMS_SCHEDULER_SECRET;
    assert.throws(() => assertCronSecret(request({ header: SECRET })));
  });
});
