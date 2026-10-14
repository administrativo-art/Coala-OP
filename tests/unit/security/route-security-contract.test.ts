import assert from "node:assert/strict";
import test from "node:test";

import {
  assertEnforcerSatisfiesContract,
  createStandardSecurityEnforcer,
  defineSecurityEnforcer,
  missingSecurityGuarantees,
} from "../../../src/lib/security/enforcer";
import {
  declaredSecurityGuarantees,
  defineSecurityContract,
  matchesSecurityContractPath,
} from "../../../src/lib/security/route-contract";

function buildContract() {
  return defineSecurityContract({
    schemaVersion: 1,
    id: "stock.reposition.update",
    version: 1,
    surface: {
      method: "PATCH",
      path: "/api/stock/reposition-requests/[requestId]",
    },
    exposure: "authenticated",
    identity: { kind: "active-user" },
    authorization: { kind: "permission", action: "stock.reposition.update" },
    resourceScope: { kind: "unit" },
    input: {
      kind: "schema",
      schema: "stock.reposition.update-input",
      unknownFields: "reject",
    },
    effects: { mode: "write", audit: "server-authoritative" },
    errorExposure: "sanitized",
  });
}

test("contrato deriva garantias verificáveis e fica imutável", () => {
  const contract = buildContract();

  assert.deepEqual(declaredSecurityGuarantees(contract), [
    "active-user",
    "authenticated-user",
    "errors-sanitized",
    "fields-allowlisted",
    "input-validated",
    "permission-checked",
    "server-authoritative-audit",
    "unit-scoped",
  ]);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.surface), true);
});

test("contrato rejeita identidade incompatível com a exposição", () => {
  assert.throws(() => defineSecurityContract({
    ...buildContract(),
    id: "stock.reposition.public-mismatch",
    exposure: "public",
  }), /incompatível com exposição public/);
});

test("binding de superfície confere caminhos estáticos, dinâmicos e catch-all", () => {
  assert.equal(matchesSecurityContractPath("/api/users/[userId]", "/api/users/user-1"), true);
  assert.equal(matchesSecurityContractPath("/api/users/[userId]", "/api/users/user-1/roles"), false);
  assert.equal(matchesSecurityContractPath("/api/files/[...path]", "/api/files/folder/report.pdf"), true);
  assert.equal(matchesSecurityContractPath("/api/files/[...path]", "/api/files"), false);
  assert.equal(matchesSecurityContractPath("/api/files/[[...path]]", "/api/files"), true);
  assert.equal(matchesSecurityContractPath("/api/files/[[...path]]", "/api/files/folder/report.pdf"), true);
});

test("enforcer padrão exige todas as etapas declaradas", () => {
  assert.throws(() => createStandardSecurityEnforcer(buildContract(), {
    authenticate: async () => ({ uid: "user-1" }),
  }), /exige a etapa parseInput/);
});

test("enforcer padrão executa identidade, entrada, recurso, autorização e escopo em ordem", async () => {
  const contract = buildContract();
  const calls: string[] = [];
  const enforcer = createStandardSecurityEnforcer(contract, {
    authenticate: async () => {
      calls.push("authenticate");
      return { uid: "user-1" };
    },
    parseInput: ({ actor }) => {
      calls.push(`parse:${actor.uid}`);
      return { quantity: 3 };
    },
    loadResource: ({ input }) => {
      calls.push(`load:${input.quantity}`);
      return { unitId: "unit-1" };
    },
    authorize: ({ resource }) => {
      calls.push(`authorize:${resource.unitId}`);
    },
    assertScope: ({ resource }) => {
      calls.push(`scope:${resource.unitId}`);
    },
  });

  assert.deepEqual(await enforcer.enforce({
    request: { body: true },
    routeContext: { params: { requestId: "request-1" } },
    observation: { eventId: "event-1" },
    contract,
  }), {
    actor: { uid: "user-1" },
    input: { quantity: 3 },
    resource: { unitId: "unit-1" },
  });
  assert.deepEqual(calls, [
    "authenticate",
    "parse:user-1",
    "load:3",
    "authorize:unit-1",
    "scope:unit-1",
  ]);
  assert.doesNotThrow(() => assertEnforcerSatisfiesContract(contract, enforcer));
});

test("enforcer customizado pode superar o padrão, mas não omitir garantias do contrato", () => {
  const contract = buildContract();
  const incomplete = defineSecurityEnforcer({
    id: "custom:stock.reposition.v2",
    guarantees: ["authenticated-user", "active-user", "errors-sanitized"] as const,
    async enforce() {
      return { actor: undefined, input: undefined, resource: undefined };
    },
  });

  assert.deepEqual(missingSecurityGuarantees(contract, incomplete), [
    "fields-allowlisted",
    "input-validated",
    "permission-checked",
    "unit-scoped",
  ]);
  assert.throws(
    () => assertEnforcerSatisfiesContract(contract, incomplete),
    /não satisfaz stock\.reposition\.update/,
  );
});
