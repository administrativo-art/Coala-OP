import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createSecurityContractBaseline,
  evaluateSecurityContracts,
  parseRouteMethods,
  scanApiRoutes,
  validateSecurityContractExceptions,
} from "../../../scripts/check-security-contracts.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "coala-security-contract-"));
  const apiRoot = join(root, "src", "app", "api");
  mkdirSync(join(apiRoot, "legacy"), { recursive: true });
  writeFileSync(join(apiRoot, "legacy", "route.ts"), "export async function GET() { return new Response('ok'); }\n");
  return { root, apiRoot };
}

function evaluate(root: string, baseline: ReturnType<typeof createSecurityContractBaseline>, exceptions: unknown = {
  schemaVersion: 1,
  exceptions: [],
}) {
  return evaluateSecurityContracts({
    routes: scanApiRoutes(root),
    baseline,
    exceptionDocument: exceptions,
    now: new Date("2026-10-08T12:00:00.000Z"),
  });
}

test("parser reconhece somente métodos exportados diretamente por secureRoute", () => {
  assert.deepEqual(parseRouteMethods(`
    import { secureRoute as protect } from "@/lib/security/secure-route.server";
    export const GET = protect(options, handler);
    export const POST = withOtherWrapper(secureRoute(options, handler));
    async function DELETE() {}
  `), [
    { method: "GET", contracted: true },
    { method: "POST", contracted: false },
  ]);
});

test("parser não aceita função homônima fora do módulo canônico", () => {
  assert.deepEqual(parseRouteMethods(`
    const secureRoute = (options, handler) => handler;
    export const GET = secureRoute(options, handler);
  `), [{ method: "GET", contracted: false }]);
});

test("baseline congela o legado intacto sem aprová-lo", () => {
  const { root } = fixture();
  const baseline = createSecurityContractBaseline(root, "base-sha");

  const { results } = evaluate(root, baseline);
  assert.equal(results[0]?.route, "/api/legacy");
  assert.equal(results[0]?.status, "LEGACY_BASELINE");
  assert.deepEqual(results[0]?.unsecuredMethods, ["GET"]);
});

test("alterar rota legada sem contrato rompe o ratchet", () => {
  const { root, apiRoot } = fixture();
  const baseline = createSecurityContractBaseline(root, "base-sha");
  writeFileSync(join(apiRoot, "legacy", "route.ts"), "export async function GET() { return new Response('changed'); }\n");

  const { results } = evaluate(root, baseline);
  assert.equal(results[0]?.status, "VIOLATION");
  assert.deepEqual(results[0]?.uncoveredMethods, ["GET"]);
});

test("rota nova passa somente quando todos os métodos usam secureRoute", () => {
  const { root, apiRoot } = fixture();
  const baseline = createSecurityContractBaseline(root, "base-sha");
  mkdirSync(join(apiRoot, "new"), { recursive: true });
  writeFileSync(join(apiRoot, "new", "route.ts"), `
    import { secureRoute } from "@/lib/security/secure-route.server";
    export const GET = secureRoute(readOptions, readHandler);
    export const POST = secureRoute(writeOptions, writeHandler);
  `);

  const result = evaluate(root, baseline).results.find((route) => route.route === "/api/new");
  assert.equal(result?.status, "CONTRACTED");
});

test("rota nova sem contrato falha e exceção válida é temporária", () => {
  const { root, apiRoot } = fixture();
  const baseline = createSecurityContractBaseline(root, "base-sha");
  mkdirSync(join(apiRoot, "temporary"), { recursive: true });
  writeFileSync(join(apiRoot, "temporary", "route.ts"), "export const POST = async () => new Response('ok');\n");

  let result = evaluate(root, baseline).results.find((route) => route.route === "/api/temporary");
  assert.equal(result?.status, "VIOLATION");

  const exceptionDocument = {
    schemaVersion: 1,
    exceptions: [{
      source: "src/app/api/temporary/route.ts",
      methods: ["POST"],
      owner: "security-platform",
      reason: "Migração bloqueada por dependência legada.",
      expiresAt: "2026-10-31",
    }],
  };
  result = evaluate(root, baseline, exceptionDocument).results.find((route) => route.route === "/api/temporary");
  assert.equal(result?.status, "EXCEPTION");
  assert.throws(
    () => validateSecurityContractExceptions(exceptionDocument, new Date("2026-11-01T00:00:00.000Z")),
    /Exceção expirada/,
  );
});

test("exceção sobreposta ou aplicada a método já contratado falha", () => {
  const overlapping = {
    schemaVersion: 1,
    exceptions: [
      {
        source: "src/app/api/temporary/route.ts",
        methods: ["POST"],
        owner: "security-platform",
        reason: "Primeira janela de migração controlada.",
        expiresAt: "2026-10-31",
      },
      {
        source: "src/app/api/temporary/route.ts",
        methods: ["POST"],
        owner: "security-platform",
        reason: "Segunda janela indevidamente sobreposta.",
        expiresAt: "2026-10-31",
      },
    ],
  };
  assert.throws(
    () => validateSecurityContractExceptions(overlapping, new Date("2026-10-08T12:00:00.000Z")),
    /duplicada ou sobreposta/,
  );

  const { root, apiRoot } = fixture();
  const baseline = createSecurityContractBaseline(root, "base-sha");
  mkdirSync(join(apiRoot, "contracted"), { recursive: true });
  writeFileSync(join(apiRoot, "contracted", "route.ts"), `
    import { secureRoute } from "@/lib/security/secure-route.server";
    export const GET = secureRoute(options, handler);
  `);
  assert.throws(() => evaluate(root, baseline, {
    schemaVersion: 1,
    exceptions: [{
      source: "src/app/api/contracted/route.ts",
      methods: ["GET"],
      owner: "security-platform",
      reason: "Exceção não deveria cobrir método contratado.",
      expiresAt: "2026-10-31",
    }],
  }), /Exceção obsoleta/);
});
